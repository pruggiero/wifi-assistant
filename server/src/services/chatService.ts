import OpenAI from 'openai';
import { ConversationState, Message } from '../stateEngine/types';
import { buildInstruction } from '../stateEngine/promptBuilder';
import { classifyQualifying, classifyStepResponse, classifyResolution } from '../stateEngine/transitions';
import { issueRegistry } from '../stateEngine/stepGroups';

interface TurnResult {
  instruction: string;
  nextState: ConversationState;
  stripHistory: boolean;
}

const CLASSIFIER_MESSAGES = 8;
const MAX_QUALIFYING_TURNS = 7;

export async function processTurn(
  state: Exclude<ConversationState, { phase: 'closed' }>,
  messages: Message[],
  openai: OpenAI
): Promise<TurnResult> {
  switch (state.phase) {
    case 'qualifying':
      return processQualifying(state, messages, openai);
    case 'guided-steps':
      return processGuidedSteps(state, messages, openai);
    case 'resolution':
      return processResolution(state, messages, openai);
    default:
      throw new Error(`Unhandled phase in processTurn: ${(state as ConversationState).phase}`);
  }
}

async function processQualifying(
  state: ConversationState,
  messages: Message[],
  openai: OpenAI
): Promise<TurnResult> {
  const userTurns = messages.filter(m => m.role === 'user').length;
  if (userTurns >= MAX_QUALIFYING_TURNS) {
    return {
      instruction: `You have asked several qualifying questions but could not identify the issue type. Apologize warmly and let the user know you're unable to continue - suggest they contact their ISP or a technician.`,
      nextState: { phase: 'closed', issueType: null, stepIndex: 0 },
      stripHistory: false,
    };
  }

  const decision = await classifyQualifying(messages.slice(-CLASSIFIER_MESSAGES), openai);

  if (decision === 'exit') {
    return {
      instruction: buildInstruction({ phase: 'exit-qualifying', issueType: null, stepIndex: 0 }),
      nextState: { phase: 'closed', issueType: null, stepIndex: 0 },
      stripHistory: false,
    };
  }

  if (decision !== 'continue') {
    return {
      instruction: buildInstruction({ phase: 'flow-start', issueType: decision, stepIndex: 0 }),
      nextState: { phase: 'guided-steps', issueType: decision, stepIndex: 0 },
      stripHistory: true, // strip qualifying history so the flow-start LLM call starts clean
    };
  }

  return {
    instruction: buildInstruction(state),
    nextState: state,
    stripHistory: false,
  };
}

async function processGuidedSteps(
  state: ConversationState,
  messages: Message[],
  openai: OpenAI
): Promise<TurnResult> {
  const config = issueRegistry[state.issueType!];
  const group = config.steps[state.stepIndex];

  const lastUserMessage = messages.filter((m: Message) => m.role === 'user').pop()?.content ?? '';
  const decision = await classifyStepResponse(
    lastUserMessage,
    group.confirmStep.message,
    openai,
    state.issueType
  );

  if (decision === 'question') {
    return {
      instruction: buildInstruction({ phase: 'flow-question', issueType: state.issueType!, stepIndex: state.stepIndex }),
      nextState: state,
      stripHistory: false,
    };
  }

  if (decision === 'abort') {
    return {
      instruction: buildInstruction({ phase: 'flow-abort', issueType: state.issueType!, stepIndex: state.stepIndex }),
      nextState: { phase: 'closed', issueType: null, stepIndex: 0 },
      stripHistory: false,
    };
  }

  if (decision === 'resolved') {
    return {
      instruction: config.prompts.stepsComplete,
      nextState: { phase: 'closed', issueType: null, stepIndex: 0 },
      stripHistory: false,
    };
  }

  const nextStepIndex = state.stepIndex + 1;
  const isLastStep = nextStepIndex >= config.steps.length;
  const nextState: ConversationState = isLastStep
    ? { phase: 'resolution', issueType: state.issueType, stepIndex: 0 }
    : { phase: 'guided-steps', issueType: state.issueType, stepIndex: nextStepIndex };

  if (isLastStep) {
    // Use a simple ask-only prompt here — stepsComplete may generate a goodbye,
    // but the next state is `resolution`, not `closed`. The resolution phase handles closing.
    // Explicitly tell the model not to declare resolution — the user completing a step is not
    // the same as confirming their issue is resolved.
    return { instruction: `The user has just completed the final step. Do NOT declare the issue resolved based on this alone — completing the steps is not the same as confirming the issue is fixed. Always ask them directly: "Is your WiFi issue now resolved?" Do NOT say goodbye. Do NOT offer further troubleshooting steps.`, nextState, stripHistory: false };
  }

  return {
    instruction: buildInstruction(nextState),
    nextState,
    stripHistory: false,
  };
}

async function processResolution(
  state: ConversationState,
  messages: Message[],
  openai: OpenAI
): Promise<TurnResult> {
  const decision = await classifyResolution(messages.slice(-CLASSIFIER_MESSAGES), openai);

  if (decision === 'pending') {
    return {
      instruction: `The user is still checking whether their issue is resolved. Respond warmly and let them know you will be here when they are ready. Do NOT offer troubleshooting steps or technical advice. Do NOT say goodbye. Do NOT close the conversation.`,
      nextState: state,
      stripHistory: false,
    };
  }

  if (decision === 'question') {
    return {
      instruction: `The user has asked a follow-up question. If it is related to their WiFi issue or ISP, answer it briefly and helpfully. If it is off-topic (unrelated to WiFi or internet), do not engage — politely redirect and ask if their issue is now resolved. Do NOT say goodbye. Do NOT close the conversation. Do NOT offer further troubleshooting steps.`,
      nextState: state,
      stripHistory: false,
    };
  }

  const config = issueRegistry[state.issueType!];
  const outcomeContext = decision === 'resolved'
    ? 'The user has confirmed their issue is fully resolved. '
    : decision === 'partial'
    ? 'The issue is partially resolved - things are better but not fully fixed. Close the conversation positively. '
    : 'The user has confirmed their issue is NOT resolved. ';
  const fallbackResolution = decision === 'resolved'
    ? 'Congratulate the user warmly and say goodbye. Do NOT ask follow-up questions.'
    : decision === 'partial'
    ? 'Acknowledge the partial progress positively. Suggest they contact their ISP or a technician for what remains. Say goodbye. Do NOT ask follow-up questions.'
    : 'Apologize sincerely and suggest they contact their ISP or a technician. Say goodbye. Do NOT ask follow-up questions.';

  return {
    instruction: outcomeContext + (config.prompts.resolution ?? fallbackResolution),
    nextState: { phase: 'closed', issueType: null, stepIndex: 0 },
    stripHistory: false,
  };
}
