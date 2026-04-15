import OpenAI from 'openai';
import { Router, Request, Response } from 'express';
import { SYSTEM_PROMPT } from '../constants/systemPrompt';
import { INITIAL_CONVERSATION_STATE, ConversationState, IssueType, Message } from '../stateEngine/types';
import { processTurn } from '../services/chatService';
import { issueRegistry } from '../stateEngine/stepGroups';

const router = Router();

const VALID_PHASES = new Set(['qualifying', 'guided-steps', 'resolution', 'closed']);
const VALID_ROLES = new Set(['user', 'assistant']);
const MAX_MESSAGES = 25;        // full flow is ~16-22 messages; 25 gives a buffer
const MAX_MESSAGE_LENGTH = 500; // user replies are short; blocks prompt injection

const LLM_CONFIG = {
  model: 'gpt-4o-mini' as const,
  temperature: 0.3,
};

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

let openai: OpenAI;
function getOpenAI(): OpenAI {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

router.post('/', async (req: Request, res: Response) => {
  const { messages, state: rawState } = req.body as { messages: Message[]; state?: unknown };

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  const sanitizedMessages: Message[] = messages
    .filter(m => VALID_ROLES.has(m?.role) && typeof m?.content === 'string')
    .slice(-MAX_MESSAGES)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }));

  const state: ConversationState = isValidState(rawState) ? rawState : INITIAL_CONVERSATION_STATE;

  console.log(`[chat] phase=${state.phase}${state.issueType ? ` issueType=${state.issueType}` : ''} messages=${sanitizedMessages.length}`);

  if (state.phase === 'closed') {
    res.json({
      message: { role: 'assistant', content: 'This conversation has ended. Feel free to refresh the page to start a new session.' },
      nextState: state,
    });
    return;
  }

  try {
    const { instruction, nextState, stripHistory } = await processTurn(state, sanitizedMessages, getOpenAI());

    const completion = await getOpenAI().chat.completions.create({
      ...LLM_CONFIG,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        ...(stripHistory ? [] : sanitizedMessages),
      ],
    });

    res.json({ message: completion.choices[0].message, nextState });
  } catch (error) {
    console.error('[chat] error:', error);
    res.status(500).json({ error: 'Failed to get a response. Please try again.' });
  }
});

export default router;
