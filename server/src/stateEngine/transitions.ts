import OpenAI from 'openai';
import { IssueType, Message } from './types';
import { issueRegistry } from './stepGroups';

async function classifyQualifying(
  messages: Message[],
  openai: OpenAI
): Promise<IssueType | 'exit' | 'continue'> {
  const shouldExit = await classifyExit(messages, openai);
  if (shouldExit) return 'exit';
  return classifyIssueType(messages, openai);
}

async function classifyExit(messages: Message[], openai: OpenAI): Promise<boolean> {
  const exitConditions = Object.values(issueRegistry).flatMap(c => c.qualifying.exitCriteria ?? []);
  if (!exitConditions.length) return false;

  const conditionList = exitConditions.map(c => `- ${c}`).join('\n');
  const notes = Object.values(issueRegistry).map(c => c.qualifying.exitClassifierNote).filter(Boolean) as string[];
  const classifierNotes = notes.length ? `\nIMPORTANT — ${notes.join(' ')}\n\n` : '\n';
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You are a classifier for a WiFi support system. Respond with JSON only.',
      },
      ...messages,
      {
        role: 'user',
        content: `Should guided WiFi troubleshooting be skipped for this user?

Reply YES only if any of the following are clearly true:
${conditionList}
${classifierNotes}Reply NO if none of the above exit criteria clearly apply, or if the situation is ambiguous.

Respond with JSON: { "skip": true } or { "skip": false }`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(completion.choices[0].message.content ?? '{}') as { skip?: boolean };
    return parsed.skip === true;
  } catch {
    return false;
  }
}

async function classifyIssueType(
  messages: Message[],
  openai: OpenAI
): Promise<IssueType | 'continue'> {
  const issueKeys = Object.keys(issueRegistry) as IssueType[];
  const issueDescriptions = (Object.entries(issueRegistry) as [IssueType, (typeof issueRegistry)[IssueType]][])
    .map(([key, config]) => {
      const signals = config.qualifying.routingSignals;
      const signalLines = signals?.length
        ? `\n  Also choose ${key} when:\n${signals.map(s => `  - ${s}`).join('\n')}`
        : '';
      return `- ${key}: ${config.qualifying.classifierDescription}${signalLines}`;
    })
    .join('\n');
  const validDecisions = [...issueKeys, 'continue'].join(' | ');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You are a classifier for a WiFi support system. Respond with JSON only.',
      },
      ...messages,
      {
        role: 'user',
        content: `Based on the conversation so far, which guided troubleshooting flow should the user be routed to?

${issueDescriptions}
- continue: Not enough information yet. Choose this when the scope of the issue or likely cause is still unclear. When in doubt, choose continue.

Respond with JSON: { "decision": "${validDecisions}" }`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(completion.choices[0].message.content ?? '{}') as { decision?: string };
    const matched = issueKeys.find(k => k === parsed.decision);
    return matched ?? 'continue';
  } catch {
    return 'continue';
  }
}

async function classifyStepResponse(
  messages: Message[],
  currentStepMessage: string,
  openai: OpenAI,
  issueType?: IssueType | null
): Promise<'confirm' | 'question' | 'abort'> {
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
  const flowContext = issueType ? issueRegistry[issueType].prompts.questionContext : 'the guided steps';

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You are a classifier for a WiFi support chatbot. Respond with JSON only.',
      },
      {
        role: 'user',
        content: `A user is being guided through ${flowContext}. They were asked to complete this step: "${currentStepMessage}"
Their response was: "${lastUserMessage}"

Classify their response:
- confirm: they completed the step they were asked to perform and are ready to continue
- question: they are asking for clarification, made a mistake, or need help with the current step
- abort: they want to exit the flow — including explicitly saying stop/cancel/nevermind, OR saying the issue has resolved on its own without them completing the step (e.g. "oh it's working now", "nevermind it's all working again")

Respond with JSON: { "decision": "confirm" | "question" | "abort" }`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(completion.choices[0].message.content ?? '{}') as { decision?: string };
    if (parsed.decision === 'question') return 'question';
    if (parsed.decision === 'abort') return 'abort';
    return 'confirm';
  } catch {
    return 'confirm';
  }
}

async function classifyResolution(
  messages: Message[],
  openai: OpenAI
): Promise<'resolved' | 'unresolved' | 'pending'> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You are a classifier for a WiFi support system. Respond with JSON only.',
      },
      ...messages,
      {
        role: 'user',
        content: `Based on the user's most recent message, have they confirmed whether their WiFi issue is resolved?

- resolved: user confirms the issue is fixed or working
- unresolved: user confirms the issue is still not working
- pending: user is still checking, gave an ambiguous response, or has not yet confirmed either way

Respond with JSON: { "decision": "resolved" | "unresolved" | "pending" }`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(completion.choices[0].message.content ?? '{}') as { decision?: string };
    if (parsed.decision === 'resolved') return 'resolved';
    if (parsed.decision === 'unresolved') return 'unresolved';
    return 'pending';
  } catch {
    return 'pending';
  }
}

export { classifyQualifying, classifyStepResponse, classifyResolution };
