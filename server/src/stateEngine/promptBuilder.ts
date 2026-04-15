import { ConversationState, IssueType } from './types';
import { issueRegistry } from './stepGroups';

type InstructionState = ConversationState | { phase: 'exit-qualifying' | 'flow-start' | 'flow-question' | 'flow-abort'; issueType: IssueType | null; stepIndex: number };

export function buildInstruction(state: InstructionState): string {
  switch (state.phase) {
    case 'exit-qualifying':
      return `The user's message is not something this WiFi support tool can help with. Respond briefly and politely: acknowledge what they said in one short sentence, let them know this tool is specifically for WiFi connectivity issues, and close the conversation. Do NOT give advice, tips, or information about the off-topic subject. Do NOT ask any follow-up questions.`;

    case 'flow-start': {
      const config = state.issueType ? issueRegistry[state.issueType] : null;
      const firstGroup = config?.steps[0];
      const startPrompt = config?.prompts.start ?? `The qualifying questions are complete. Tell the user you are going to walk them through the next steps.`;
      if (firstGroup) {
        if (firstGroup.presentSteps.length > 1) {
          const stepLines = firstGroup.presentSteps.map((s, i) => `${i + 1}. ${s.message}`).join('\n');
          return `${startPrompt}\n\nPresent these first steps verbatim as a numbered list:\n${stepLines}\nAsk the user to confirm when they have completed all of these steps.`;
        }
        return `${startPrompt}\n\nPresent this first step verbatim: "${firstGroup.confirmStep.message}". Ask the user to confirm when they have completed it.`;
      }
      return startPrompt;
    }

    case 'flow-question': {
      const config = state.issueType ? issueRegistry[state.issueType] : null;
      const groups = config?.steps ?? [];
      const group = groups[state.stepIndex];
      const stepDesc = group ? group.confirmStep.message : 'the current step';
      const context = config?.prompts.questionContext ?? 'the guided steps';
      return `The user has asked a question while being guided through ${context}. Answer their question clearly and helpfully. After answering, remind them where they left off - they still need to complete this step: "${stepDesc}". Ask them to confirm when they have done so.`;
    }

    case 'flow-abort': {
      const prompts = state.issueType ? issueRegistry[state.issueType].prompts : null;
      return prompts?.abort ?? `The user has indicated they no longer need to continue. Acknowledge this warmly and close the conversation. Do NOT ask any follow-up questions.`;
    }

    case 'qualifying': {
      const issueContext = Object.values(issueRegistry)
        .map(c => `- ${c.qualifying.classifierDescription}\n  Useful questions: ${c.qualifying.suggestedQuestions.join(' | ')}`)
        .join('\n');
      const exitConditions = Object.values(issueRegistry)
        .flatMap(c => c.qualifying.exitCriteria ?? []);
      const exitLine = exitConditions.length
        ? `- exit: guided troubleshooting won't help. Applies when:\n${exitConditions.map(c => `  - ${c}`).join('\n')}`
        : `- exit: issue is out of scope for guided troubleshooting`;
      return `You are gathering information to diagnose a WiFi issue. Your goal is to determine which of these applies:\n${issueContext}\n${exitLine}\n\nBased on what the user has already said, ask the 1-2 most relevant follow-up questions. Do not ask questions they have already answered. Do not list all questions at once.\n\nIf this is the start of the conversation, greet the user warmly and ask one opening question.\nDo not make a decision yet - just gather information.`;
    }

    case 'guided-steps': {
      const config = state.issueType ? issueRegistry[state.issueType] : null;
      const groups = config?.steps ?? [];
      const group = groups[state.stepIndex];
      if (!group) return config?.prompts.stepsComplete ?? 'The guided steps are complete. Ask the user if their issue is resolved.';

      if (group.presentSteps.length > 1) {
        const stepLines = group.presentSteps.map((s, i) => `${i + 1}. ${s.message}`).join('\n');
        return `The user has completed the previous step. Present ONLY these steps verbatim as a numbered list:\n${stepLines}\nAsk the user to confirm when they have completed all of these steps before continuing.`;
      }

      return `The user has completed the previous step. Present ONLY this step verbatim: "${group.confirmStep.message}". Ask the user to confirm when they have completed it before continuing.`;
    }

    case 'resolution': {
      const resolution = state.issueType ? issueRegistry[state.issueType].prompts.resolution : undefined;
      return resolution ?? `This is your final message. The troubleshooting steps are complete.
- If the user says their issue is resolved: congratulate them warmly and say goodbye.
- If the issue is not resolved: apologize sincerely, suggest they contact their ISP or a technician, and say goodbye.
Do NOT ask any follow-up questions. Do NOT offer further troubleshooting. Close the conversation.`;
    }
    default:
      throw new Error(`Unhandled phase in buildInstruction: ${(state as { phase: string }).phase}`);
  }
}
