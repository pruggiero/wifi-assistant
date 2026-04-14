import OpenAI from 'openai';
import { Router, Request, Response } from 'express';
import { SYSTEM_PROMPT } from '../constants/systemPrompt';
import { INITIAL_STATE, ConversationState, IssueType, Message } from '../stateEngine/types';
import { buildInstruction } from '../stateEngine/promptBuilder';
import { getNextState, classifyQualifying, classifyRebootResponse } from '../stateEngine/transitions';
import { issueRegistry } from '../stateEngine/stepGroups';

const router = Router();

const VALID_PHASES = new Set(['qualifying', 'guided-steps', 'resolution', 'closed']);
const VALID_ROLES = new Set(['user', 'assistant']);
const MAX_MESSAGES = 25;          // full flow is ~16-22 messages; 25 gives a buffer without being unbounded
const MAX_MESSAGE_LENGTH = 500;   // user replies are short; blocks prompt injection
const CLASSIFIER_MESSAGES = 8;    // classifiers need recent context only

function isValidState(state: unknown): state is ConversationState {
  if (!state || typeof state !== 'object') return false;
  const s = state as Record<string, unknown>;
  if (!VALID_PHASES.has(s.phase as string)) return false;
  if (typeof s.stepIndex !== 'number' || !Number.isInteger(s.stepIndex) || s.stepIndex < 0) return false;
  const issueType = s.issueType ?? null;
  if (issueType !== null && !((issueType as string) in issueRegistry)) return false;
  if (s.phase === 'guided-steps') {
    if (!issueType) return false;
    if (s.stepIndex >= issueRegistry[issueType as IssueType].steps.length) return false;
  }
  return true;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post('/', async (req: Request, res: Response) => {
  const { messages, state: rawState } = req.body as { messages: Message[]; state?: unknown };

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  const sanitizedMessages: Message[] = messages
    .filter((m) => VALID_ROLES.has(m?.role) && typeof m?.content === 'string')
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }));

  const state: ConversationState = isValidState(rawState) ? rawState : INITIAL_STATE;

  if (state.phase === 'closed') {
    res.json({
      message: { role: 'assistant', content: 'This conversation has ended. Feel free to refresh the page to start a new session.' },
      nextState: state,
    });
    return;
  }

  // For qualifying, classify first so the response instruction matches the transition
  let instruction: string;
  let nextState: ConversationState;

  if (state.phase === 'qualifying') {
    try {
      const decision = await classifyQualifying(sanitizedMessages.slice(-CLASSIFIER_MESSAGES), openai);
      if (decision === 'unclear') {
        res.json({
          message: { role: 'assistant', content: "I'm having trouble understanding your situation. Please try rephrasing, or refresh the page to start a new session." },
          nextState: { phase: 'closed', issueType: null, stepIndex: 0 },
        });
        return;
      }
      if (decision === 'exit') {
        instruction = buildInstruction({ phase: 'exit-qualifying', issueType: null, stepIndex: 0 });
        nextState = { phase: 'closed', issueType: null, stepIndex: 0 };
      } else if (decision !== 'continue') {
        // decision is an IssueType - start the guided flow for that issue
        instruction = buildInstruction({ phase: 'flow-start', issueType: decision, stepIndex: 0 });
        nextState = { phase: 'guided-steps', issueType: decision, stepIndex: 0 };
      } else {
        instruction = buildInstruction(state);
        nextState = state;
      }
    } catch {
      instruction = buildInstruction(state);
      nextState = state;
    }
  } else if (state.phase === 'guided-steps') {
    const groups = state.issueType ? issueRegistry[state.issueType].steps : [];
    const group = groups[state.stepIndex];
    if (!group) {
      // All steps done, transition to resolution
      instruction = buildInstruction(state);
      nextState = { phase: 'resolution', issueType: null, stepIndex: 0 };
    } else {
      try {
        const rebootDecision = await classifyRebootResponse(sanitizedMessages.slice(-CLASSIFIER_MESSAGES), group.confirmStep.message, openai);
        if (rebootDecision === 'unclear') {
          res.json({
            message: { role: 'assistant', content: "I'm having trouble understanding your response. Please try rephrasing, or refresh the page to start a new session." },
            nextState: { phase: 'closed', issueType: null, stepIndex: 0 },
          });
          return;
        }
        if (rebootDecision === 'question') {
          instruction = buildInstruction({ phase: 'flow-question', issueType: state.issueType, stepIndex: state.stepIndex });
          nextState = state; // stay on current step
        } else if (rebootDecision === 'abort') {
          instruction = buildInstruction({ phase: 'flow-abort', issueType: state.issueType, stepIndex: state.stepIndex });
          nextState = { phase: 'closed', issueType: null, stepIndex: 0 };
        } else {
          // User confirmed - advance to next step
          const nextStepIndex = state.stepIndex + 1;
          nextState = nextStepIndex >= groups.length
            ? { phase: 'resolution', issueType: null, stepIndex: 0 }
            : { phase: 'guided-steps', issueType: state.issueType, stepIndex: nextStepIndex };
          instruction = buildInstruction(nextState);
        }
      } catch {
        instruction = buildInstruction(state);
        nextState = state; // safe fallback - don't advance state on error
      }
    }
  } else {
    instruction = buildInstruction(state);
    nextState = await getNextState(state, sanitizedMessages, openai);
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        ...sanitizedMessages,
      ],
    });

    res.json({ message: completion.choices[0].message, nextState });
  } catch (error) {
    console.error('OpenAI error:', error);
    res.status(500).json({ error: 'Failed to get a response. Please try again.' });
  }
});

export default router;
