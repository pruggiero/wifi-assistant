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
  // Check exit first. If it applies, skip issue-type routing entirely.
  const shouldExit = await classifyExit(messages, openai);
  if (shouldExit) return 'exit';
  return classifyIssueType(messages, openai);
}

// Should we skip guided troubleshooting for this user?
async function classifyExit(messages: Message[], openai: OpenAI): Promise<boolean> {
  const exitConditions = Object.values(issueRegistry).flatMap(c => c.qualifying.exitCriteria ?? []);
  if (!exitConditions.length) return false;

  const conditionList = exitConditions.map(c => `- ${c}`).join('\n');
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: 'You are a classifier for a WiFi support system. Reply with exactly one word: yes or no.',
      },
      ...messages,
      {
        role: 'user',
        content: `Should guided WiFi troubleshooting be skipped for this user?

Reply YES only if any of the following are clearly true:
${conditionList}

Reply NO if none of the above clearly apply, or if the situation is ambiguous.

Reply with exactly one word: yes or no`,
      },
    ],
    max_tokens: 5,
  });

  const text = completion.choices[0].message.content?.toLowerCase().trim() ?? 'no';
  return text.startsWith('yes');
}

// Which issue type applies, or do we need more info?
async function classifyIssueType(
  messages: Message[],
  openai: OpenAI
): Promise<IssueType | 'continue' | 'unclear'> {
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
  const labelList = [...issueKeys, 'continue'].join(', ');

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
        content: `Based on the conversation so far, which guided troubleshooting flow should the user be routed to?

${issueDescriptions}
- continue: Not enough information yet to identify which issue type applies. Choose this when the scope of the issue (e.g. how many devices are affected) or the likely cause is still unclear. When in doubt, choose continue.

Reply with exactly one word: ${labelList}`,
      },
    ],
    max_tokens: 10,
  });

  const logprob = completion.choices[0].logprobs?.content?.[0]?.logprob ?? 0;
  if (Math.exp(logprob) < CONFIDENCE_THRESHOLD) return 'unclear';

  const text = completion.choices[0].message.content?.toLowerCase().trim() ?? 'continue';
  const matched = issueKeys.find(k => text.startsWith(k));
  return matched ?? 'continue';
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
- confirm: they completed the step or are ready to continue, including saying the step worked or resolved the issue
- question: they are asking for clarification, made a mistake, or need help with the current step
- abort: they explicitly want to stop the flow (e.g. "nevermind", "never mind", "stop", "cancel", "I want to quit")

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
