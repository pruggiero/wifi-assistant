import OpenAI from 'openai';
import { Router, Request, Response } from 'express';
import { SYSTEM_PROMPT } from '../constants/systemPrompt';
import { INITIAL_STATE, ConversationState } from '../stateEngine/types';
import { buildInstruction } from '../stateEngine/promptBuilder';
import { getNextState, classifyQualifyingForTest as classifyQualifying } from '../stateEngine/transitions';

const router = Router();

const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

router.post('/', async (req: Request, res: Response) => {
  const { messages, state = INITIAL_STATE } = req.body as {
    messages: Message[];
    state?: ConversationState;
  };

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

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
      const decision = await classifyQualifying(messages, openai);
      if (decision === 'exit') {
        instruction = buildInstruction({ phase: 'exit-qualifying', rebootGroupIndex: 0 } as never);
        nextState = { phase: 'closed', rebootGroupIndex: 0 };
      } else if (decision === 'reboot') {
        instruction = buildInstruction({ phase: 'reboot-start', rebootGroupIndex: 0 } as never);
        nextState = { phase: 'reboot', rebootGroupIndex: 0 };
      } else {
        instruction = buildInstruction(state);
        nextState = state;
      }
    } catch {
      instruction = buildInstruction(state);
      nextState = state;
    }
  } else {
    instruction = buildInstruction(state);
    nextState = await getNextState(state, messages, openai);
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        ...messages,
      ],
    });

    res.json({ message: completion.choices[0].message, nextState });
  } catch (error) {
    console.error('OpenAI error:', error);
    res.status(500).json({ error: 'Failed to get a response. Please try again.' });
  }
});

export default router;
