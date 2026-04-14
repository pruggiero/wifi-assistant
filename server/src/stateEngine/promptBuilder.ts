import { ConversationState, IssueType } from './types';
import { issueRegistry } from './stepGroups';

export type InstructionState = ConversationState | { phase: 'exit-qualifying' | 'flow-start' | 'flow-question' | 'flow-abort'; issueType: IssueType | null; stepIndex: number };

export function buildInstruction(state: InstructionState): string {
  switch (state.phase) {
    case 'exit-qualifying':
      return `The user's message is not something this WiFi support tool can help with. Respond briefly and politely: acknowledge what they said in one short sentence, let them know this tool is specifically for WiFi connectivity issues, and close the conversation. Do NOT give advice, tips, or information about the off-topic subject. Do NOT ask any follow-up questions.`;

    case 'flow-start': {
      const prompts = state.issueType ? issueRegistry[state.issueType].prompts : null;
      return prompts?.start ?? `The qualifying questions are complete. Tell the user you are going to walk them through the next steps and ask them to confirm they are ready before you begin.`;
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
      // Questions are merged from all issue types so the LLM can gather enough info to classify
      const questions = Object.values(issueRegistry).flatMap(c => c.qualifying.questions);
      const unique = [...new Set(questions)];
      const numbered = unique.map((q, i) => `${i + 1}. ${q}`).join('\n');
      return `Ask the user these qualifying questions:\n${numbered}\n\nIf this appears to be the start of the conversation, greet the user warmly before asking.\nGather their answers - do not make any decision yet.`;
    }

    case 'guided-steps': {
      const config = state.issueType ? issueRegistry[state.issueType] : null;
      const groups = config?.steps ?? [];
      const group = groups[state.stepIndex];
      if (!group) return config?.prompts.stepsComplete ?? 'The guided steps are complete. Ask the user if their issue is resolved.';

      if (group.presentSteps.length > 1) {
        const autoSteps = group.presentSteps.slice(0, -1);
        const last = group.confirmStep;
        return `Guide the user through these steps:

${autoSteps.map(s => `Step ${s.id}: "${s.message}" - present this and immediately move on.`).join('\n')}
Step ${last.id}: "${last.message}" - ask the user to confirm when they have completed this step before continuing.`;
      }

      return `Guide the user through this step:
Step ${group.confirmStep.id}: "${group.confirmStep.message}"
Ask the user to confirm when they've completed it before continuing.`;
    }

    case 'resolution':
      return `This is your final message. The troubleshooting steps are complete.
- If the user says their issue is resolved: congratulate them warmly and say goodbye.
- If the issue is not resolved: apologize sincerely, suggest they contact their ISP or a technician, and say goodbye.
Do NOT ask any follow-up questions. Do NOT offer further troubleshooting. Close the conversation.`;

    case 'closed':
      return `The conversation has concluded. Offer a brief warm closing if needed.`;
  }
}
