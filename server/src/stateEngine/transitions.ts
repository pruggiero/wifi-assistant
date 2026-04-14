import OpenAI from 'openai';
import { ConversationState } from './types';
import { stepGroups } from './stepGroups';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function getNextState(
  current: ConversationState,
  messages: Message[],
  openai: OpenAI
): Promise<ConversationState> {
  switch (current.phase) {
    case 'qualifying': {
      const decision = await classifyQualifying(messages, openai);
      if (decision === 'reboot') return { phase: 'reboot', rebootGroupIndex: 0 };
      if (decision === 'exit') return { phase: 'closed', rebootGroupIndex: 0 };
      return current; // stay in qualifying until enough info
    }

    case 'reboot': {
      const nextGroupIndex = current.rebootGroupIndex + 1;
      if (nextGroupIndex >= stepGroups.length) {
        return { phase: 'resolution', rebootGroupIndex: 0 };
      }
      return { phase: 'reboot', rebootGroupIndex: nextGroupIndex };
    }

    case 'resolution':
      // Both resolved and unresolved end the conversation; the LLM generates the appropriate close
      return { phase: 'closed', rebootGroupIndex: 0 };

    case 'closed':
      return current;
  }
}

async function classifyQualifying(
  messages: Message[],
  openai: OpenAI
): Promise<'reboot' | 'exit' | 'continue'> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a classifier for a WiFi support system. Reply with exactly one word.',
      },
      ...messages,
      {
        role: 'user',
        content: `Based on the conversation so far, what should happen next?
- reboot: The user's issue affects ALL devices on the network and a router reboot is appropriate
- exit: A reboot won't help - this includes: issue affects only ONE device (not the whole network), specific website is down, ISP outage suspected, physical hardware damage. IMPORTANT: if only one device is affected, always choose exit.
- continue: Not enough information has been gathered yet to decide

Reply with exactly one word: reboot, exit, or continue`,
      },
    ],
    max_tokens: 10,
  });

  const text = completion.choices[0].message.content?.toLowerCase().trim() ?? 'continue';
  if (text.startsWith('reboot')) return 'reboot';
  if (text.startsWith('exit')) return 'exit';
  return 'continue';
}

// Exported for eval tests only
export { classifyQualifying as classifyQualifyingForTest };
