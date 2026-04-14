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

const CONFIDENCE_THRESHOLD = 0.4; // if top-token probability < 40%, classifier is too uncertain to trust

async function classifyQualifying(
  messages: Message[],
  openai: OpenAI
): Promise<'reboot' | 'exit' | 'continue' | 'unclear'> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    logprobs: true,
    top_logprobs: 1,
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
- exit: A reboot won't help. Choose exit when the user has explicitly named other devices (e.g. phone, tablet, another laptop) that are working fine on the same network and only one device is affected. Also exit for: specific website is down, ISP outage suspected, physical hardware damage.
- continue: Not enough information yet. Use this when: it is ambiguous whether other devices are affected, the user says "just my laptop" without mentioning whether other devices exist or work, or the user only has one device. When in doubt, choose continue.

IMPORTANT: A user saying only "just my laptop" or "only my laptop" without mentioning other working devices is NOT enough to choose exit. Choose continue and ask if other devices are affected.

Reply with exactly one word: reboot, exit, or continue`,
      },
    ],
    max_tokens: 10,
  });

  const logprob = completion.choices[0].logprobs?.content?.[0]?.logprob ?? 0;
  if (Math.exp(logprob) < CONFIDENCE_THRESHOLD) return 'unclear';

  const text = completion.choices[0].message.content?.toLowerCase().trim() ?? 'continue';
  if (text.startsWith('reboot')) return 'reboot';
  if (text.startsWith('exit')) return 'exit';
  return 'continue';
}

async function classifyRebootResponse(
  messages: Message[],
  currentStepMessage: string,
  openai: OpenAI
): Promise<'confirm' | 'question' | 'abort' | 'unclear'> {
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    logprobs: true,
    top_logprobs: 1,
    messages: [
      {
        role: 'system',
        content: 'You are a classifier for a WiFi support chatbot. Reply with exactly one word.',
      },
      {
        role: 'user',
        content: `A user is being guided through a router reboot. They were asked to complete this step: "${currentStepMessage}"
Their response was: "${lastUserMessage}"

Classify their response:
- confirm: they completed the step, are ready to continue, or said something like "done", "ok", "ready"
- question: they are asking for clarification, made a mistake, or need help with the current step
- abort: their issue is resolved or they no longer need the reboot (e.g. "it's working now", "nevermind", "never mind")

Reply with exactly one word: confirm, question, or abort`,
      },
    ],
    max_tokens: 10,
  });

  const logprob = completion.choices[0].logprobs?.content?.[0]?.logprob ?? 0;
  if (Math.exp(logprob) < CONFIDENCE_THRESHOLD) return 'unclear';

  const text = completion.choices[0].message.content?.toLowerCase().trim() ?? 'confirm';
  if (text.startsWith('question')) return 'question';
  if (text.startsWith('abort')) return 'abort';
  return 'confirm';
}

// Exported for eval tests only
export { classifyQualifying as classifyQualifyingForTest, classifyRebootResponse as classifyRebootResponseForTest };
