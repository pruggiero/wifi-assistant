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
  const classifierNotes = notes.length ? `\nIMPORTANT - ${notes.join(' ')}\n\n` : '\n';
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
- continue: Not enough information yet. Only choose this when it is genuinely unclear which flow applies - for example, if the number of affected devices has not been established. Do NOT choose continue when a routing signal is clearly present.

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
  lastUserMessage: string,
  currentStepMessage: string,
  openai: OpenAI,
  issueType?: IssueType | null
): Promise<'confirm' | 'question' | 'abort' | 'resolved'> {
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
- abort: they want to explicitly quit or cancel the process entirely (e.g. "stop", "cancel", "nevermind", "I don't want to do this anymore"). Do NOT choose abort for temporary pauses or distractions — ANY message where the user is stepping away briefly, going to do something else, or just needs a moment (e.g. "hold on", "brb", "one sec", "be right back", "need to use the washroom", "going to let my dog out", "just a minute") must be classified as question, never abort. Only choose abort if the user is clearly ending the session permanently.
- resolved: the issue has resolved on its own without them completing the step (e.g. "oh it's working now", "nevermind it's all working again")

Respond with JSON: { "decision": "confirm" | "question" | "abort" | "resolved" }`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(completion.choices[0].message.content ?? '{}') as { decision?: string };
    if (parsed.decision === 'question') return 'question';
    if (parsed.decision === 'abort') return 'abort';
    if (parsed.decision === 'resolved') return 'resolved';
    return 'confirm';
  } catch {
    return 'question';
  }
}

async function classifyResolution(
  messages: Message[],
  openai: OpenAI
): Promise<'resolved' | 'unresolved' | 'partial' | 'pending' | 'question'> {
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

- resolved: user confirms their issue is fixed. Short affirmative replies immediately following a direct resolution question (e.g. "yes", "yep", "done", "looks good") should be treated as resolved.
- partial: the issue is better but not fully resolved (e.g. some things work but not everything)
- unresolved: user confirms the issue is still not fixed
- pending: user explicitly says they are still checking (e.g. "hold on", "let me try", "checking now"), or has clearly not yet confirmed either way
- question: user is asking a follow-up question without confirming the outcome (e.g. "why did this happen?", "what should I do if it happens again?")

Respond with JSON: { "decision": "resolved" | "partial" | "unresolved" | "pending" | "question" }`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(completion.choices[0].message.content ?? '{}') as { decision?: string };
    if (parsed.decision === 'resolved') return 'resolved';
    if (parsed.decision === 'partial') return 'partial';
    if (parsed.decision === 'unresolved') return 'unresolved';
    if (parsed.decision === 'question') return 'question';
    return 'pending';
  } catch {
    return 'pending';
  }
}

export { classifyQualifying, classifyStepResponse, classifyResolution };
