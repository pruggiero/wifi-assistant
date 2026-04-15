import OpenAI from 'openai';
import { IssueType, Message } from './types';
import { issueRegistry } from './stepGroups';
import { extractQualifyingFacts } from './qualifyingFacts';

async function classifyQualifying(
  messages: Message[],
  openai: OpenAI
): Promise<IssueType | 'exit' | 'continue'> {
  const facts = await extractQualifyingFacts(messages, openai);
  for (const [, config] of Object.entries(issueRegistry)) {
    const decision = config.qualifying.route(facts);
    if (decision !== 'continue') return decision;
  }
  return 'continue';
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
- confirm: they completed the step they were asked to perform and are ready to continue — this includes responses where they confirm completion AND also complain or mention a side effect (e.g. "done, it crashed my game", "ok I did it but it was annoying", "finished, my internet is still slow") — a complaint alongside a completion is still a confirm
- question: they are asking for clarification, made a mistake, or need help with the current step — only use this if they have NOT indicated they completed the step
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

- resolved: user confirms their issue is fixed — including implicit confirmations where their actions show the internet is working (e.g. "I can browse now", "I see cats now", "it loaded"). Short affirmative replies immediately following a direct resolution question (e.g. "yes", "yep", "done", "looks good") should be treated as resolved.
- partial: the issue is better but not fully resolved — use this for degraded-but-working states too (e.g. some devices work while others don't, some things work but not everything, connected but slow, working but intermittent). If ANYTHING is working (even just one device), classify as partial rather than unresolved.
- unresolved: user confirms the issue is still not fixed
- pending: user explicitly says they are still checking (e.g. "hold on", "let me try", "checking now"), or has clearly not yet confirmed either way
- question: user is asking a follow-up question without confirming the outcome at all (e.g. "why did this happen?", "what should I do if it happens again?"). Do NOT use this if the user has already described whether it is working or not.

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
