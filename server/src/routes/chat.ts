import OpenAI from 'openai';
import { Router, Request, Response } from 'express';
import { SYSTEM_PROMPT } from '../constants/systemPrompt';
import { INITIAL_STATE, ConversationState } from '../stateEngine/types';
import { buildInstruction } from '../stateEngine/promptBuilder';
import { getNextState, classifyQualifyingForTest as classifyQualifying, classifyRebootResponseForTest as classifyRebootResponse } from '../stateEngine/transitions';
import { stepGroups } from '../stateEngine/stepGroups';

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
  } else if (state.phase === 'reboot') {
    const group = stepGroups[state.rebootGroupIndex];
    if (!group) {
      // All groups done, transition to resolution
      instruction = buildInstruction(state);
      nextState = await getNextState(state, messages, openai);
    } else {
      try {
        const rebootDecision = await classifyRebootResponse(messages, group.confirmStep.message, openai);
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
        nextState = await getNextState(state, messages, openai);
      }
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
