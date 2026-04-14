import OpenAI from 'openai';
import { Router, Request, Response } from 'express';
import { SYSTEM_PROMPT } from '../constants/systemPrompt';
import { INITIAL_STATE, ConversationState } from '../stateEngine/types';
import { buildInstruction } from '../stateEngine/promptBuilder';
import { getNextState, classifyQualifyingForTest as classifyQualifying, classifyRebootResponseForTest as classifyRebootResponse } from '../stateEngine/transitions';
import { stepGroups } from '../stateEngine/stepGroups';

const router = Router();

const VALID_PHASES = new Set(['qualifying', 'reboot', 'resolution', 'closed']);
const VALID_ROLES = new Set(['user', 'assistant']);
const MAX_MESSAGES = 20;          // full flow is ~16-22 messages
const MAX_MESSAGE_LENGTH = 500;   // user replies are short; blocks prompt injection
const CLASSIFIER_MESSAGES = 8;    // classifiers need recent context only

function isValidState(state: unknown): state is ConversationState {
  if (!state || typeof state !== 'object') return false;
  const s = state as Record<string, unknown>;
  return (
    VALID_PHASES.has(s.phase as string) &&
    typeof s.rebootGroupIndex === 'number' &&
    Number.isInteger(s.rebootGroupIndex) &&
    s.rebootGroupIndex >= 0 &&
    s.rebootGroupIndex < stepGroups.length
  );
}

const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

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

  const openai = getOpenAI();

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
      if (decision === 'exit') {
        instruction = buildInstruction({ phase: 'exit-qualifying', rebootGroupIndex: 0 });
        nextState = { phase: 'closed', rebootGroupIndex: 0 };
      } else if (decision === 'reboot') {
        instruction = buildInstruction({ phase: 'reboot-start', rebootGroupIndex: 0 });
        nextState = { phase: 'reboot', rebootGroupIndex: 0 };
      } else {
        instruction = buildInstruction(state);
        nextState = state;
      }
    } catch {
      instruction = buildInstruction(state);
      nextState = state;
    }
  } else if (state.phase === 'reboot') {
    const group = stepGroups[state.rebootGroupIndex];
    if (!group) {
      // All groups done, transition to resolution
      instruction = buildInstruction(state);
      nextState = await getNextState(state, sanitizedMessages, openai);
    } else {
      try {
        const rebootDecision = await classifyRebootResponse(sanitizedMessages.slice(-CLASSIFIER_MESSAGES), group.confirmStep.message, openai);
        if (rebootDecision === 'question') {
          instruction = buildInstruction({ phase: 'reboot-question', rebootGroupIndex: state.rebootGroupIndex });
          nextState = state; // stay on current step
        } else if (rebootDecision === 'abort') {
          instruction = buildInstruction({ phase: 'reboot-abort', rebootGroupIndex: state.rebootGroupIndex });
          nextState = { phase: 'closed', rebootGroupIndex: 0 };
        } else {
          // User confirmed - advance state and build instruction for what comes next
          const nextGroupIndex = state.rebootGroupIndex + 1;
          nextState = nextGroupIndex >= stepGroups.length
            ? { phase: 'resolution', rebootGroupIndex: 0 }
            : { phase: 'reboot', rebootGroupIndex: nextGroupIndex };
          instruction = buildInstruction(nextState);
        }
      } catch {
        instruction = buildInstruction(state);
        nextState = await getNextState(state, sanitizedMessages, openai);
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
