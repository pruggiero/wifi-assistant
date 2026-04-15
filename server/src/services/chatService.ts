import OpenAI from 'openai';
import { ConversationState, Message } from '../stateEngine/types';
import { buildInstruction } from '../stateEngine/promptBuilder';
import { classifyQualifying, classifyStepResponse } from '../stateEngine/transitions';
import { issueRegistry } from '../stateEngine/stepGroups';

export interface TurnResult {
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
      return {
        instruction: buildInstruction(state),
        nextState: { phase: 'closed', issueType: null, stepIndex: 0 },
        stripHistory: false,
      };
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
      instruction: `You have asked several qualifying questions but could not identify the issue type. Apologize warmly and let the user know you're unable to continue — suggest they contact their ISP or a technician.`,
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
  const groups = state.issueType ? issueRegistry[state.issueType].steps : [];
  const group = groups[state.stepIndex];

  if (!group) {
    return {
      instruction: buildInstruction(state),
      nextState: { phase: 'resolution', issueType: state.issueType, stepIndex: 0 },
      stripHistory: false,
    };
  }

  const decision = await classifyStepResponse(
    messages.slice(-CLASSIFIER_MESSAGES),
    group.confirmStep.message,
    openai,
    state.issueType
  );

  if (decision === 'question') {
    return {
      instruction: buildInstruction({ phase: 'flow-question', issueType: state.issueType, stepIndex: state.stepIndex }),
      nextState: state,
      stripHistory: false,
    };
  }

  if (decision === 'abort') {
    return {
      instruction: buildInstruction({ phase: 'flow-abort', issueType: state.issueType, stepIndex: state.stepIndex }),
      nextState: { phase: 'closed', issueType: null, stepIndex: 0 },
      stripHistory: false,
    };
  }

  // confirm — advance to next step
  const nextStepIndex = state.stepIndex + 1;
  const isLastStep = nextStepIndex >= groups.length;
  const nextState: ConversationState = isLastStep
    ? { phase: 'resolution', issueType: state.issueType, stepIndex: 0 }
    : { phase: 'guided-steps', issueType: state.issueType, stepIndex: nextStepIndex };

  if (isLastStep) {
    const stepsComplete = state.issueType
      ? issueRegistry[state.issueType].prompts.stepsComplete
      : 'The guided steps are complete. Ask the user if their issue is resolved.';
    return { instruction: stepsComplete, nextState, stripHistory: false };
  }

  return {
    instruction: buildInstruction(nextState),
    nextState,
    stripHistory: false,
  };
}
