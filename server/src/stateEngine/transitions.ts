import OpenAI from 'openai';
import { ConversationState, IssueType, Message } from './types';
import { issueRegistry } from './stepGroups';

export async function getNextState(
  current: ConversationState,
  messages: Message[],
  openai: OpenAI
): Promise<ConversationState> {
  switch (current.phase) {
    case 'qualifying': {
      const decision = await classifyQualifying(messages, openai);
      if (decision === 'exit') return { phase: 'closed', issueType: null, stepIndex: 0 };
      if (decision !== 'continue' && decision !== 'unclear') {
        return { phase: 'guided-steps', issueType: decision, stepIndex: 0 };
      }
      return current; // stay in qualifying until enough info
    }

    case 'guided-steps': {
      if (!current.issueType) return current;
      const groups = issueRegistry[current.issueType].steps;
      const nextStepIndex = current.stepIndex + 1;
      if (nextStepIndex >= groups.length) {
        return { phase: 'resolution', issueType: current.issueType, stepIndex: 0 };
      }
      return { phase: 'guided-steps', issueType: current.issueType, stepIndex: nextStepIndex };
    }

    case 'resolution':
      return { phase: 'closed', issueType: null, stepIndex: 0 };

    case 'closed':
      return current;
  }
}

const CONFIDENCE_THRESHOLD = 0.4; // if top-token probability < 40%, classifier is too uncertain to trust

async function classifyQualifying(
  messages: Message[],
  openai: OpenAI
): Promise<IssueType | 'exit' | 'continue' | 'unclear'> {
  const issueDescriptions = (Object.entries(issueRegistry) as [IssueType, (typeof issueRegistry)[IssueType]][])
    .map(([key, config]) => {
      const signals = config.qualifying.routingSignals;
      const signalLines = signals?.length
        ? `\n  Also choose ${key} when:\n${signals.map(s => `  - ${s}`).join('\n')}`
        : '';
      return `- ${key}: ${config.qualifying.classifierDescription}${signalLines}`;
    })
    .join('\n');
  const issueKeys = Object.keys(issueRegistry) as IssueType[];
  const labelList = [...issueKeys, 'exit', 'continue'].join(', ');

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
${issueDescriptions}
- exit: Guided troubleshooting won't help. Choose exit when the user has explicitly named other devices (e.g. phone, tablet, another laptop) that are working fine and only one device is affected. Also exit for: specific website is down, ISP outage suspected, physical hardware damage.
- continue: Not enough information yet. Use this when: it is ambiguous whether other devices are affected, the user says "just my laptop" without mentioning whether other devices exist or work, or the user only has one device with no other routing signals present. When in doubt, choose continue.

IMPORTANT: A user saying only "just my laptop" or "only my laptop" without mentioning other working devices is NOT enough to choose exit. Choose continue and ask if other devices are affected.

Reply with exactly one word: ${labelList}`,
      },
    ],
    max_tokens: 10,
  });

  const logprob = completion.choices[0].logprobs?.content?.[0]?.logprob ?? 0;
  if (Math.exp(logprob) < CONFIDENCE_THRESHOLD) return 'unclear';

  const text = completion.choices[0].message.content?.toLowerCase().trim() ?? 'continue';
  const matched = issueKeys.find(k => text.startsWith(k));
  if (matched) return matched;
  if (text.startsWith('exit')) return 'exit';
  return 'continue';
}

async function classifyStepResponse(
  messages: Message[],
  currentStepMessage: string,
  openai: OpenAI,
  issueType?: IssueType | null
): Promise<'confirm' | 'question' | 'abort' | 'unclear'> {
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
  const flowContext = issueType ? issueRegistry[issueType].prompts.questionContext : 'the guided steps';

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
        content: `A user is being guided through ${flowContext}. They were asked to complete this step: "${currentStepMessage}"
Their response was: "${lastUserMessage}"

Classify their response:
- confirm: they completed the step, are ready to continue, or said something like "done", "ok", "ready"
- question: they are asking for clarification, made a mistake, or need help with the current step
- abort: their issue is resolved or they no longer need the flow (e.g. "it's working now", "nevermind", "never mind")

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

export { classifyQualifying, classifyStepResponse };
