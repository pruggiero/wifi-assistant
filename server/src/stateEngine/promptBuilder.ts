import { ConversationState } from './types';
import { stepGroups } from './stepGroups';

type InstructionState = ConversationState | { phase: 'exit-qualifying' | 'reboot-start' | 'reboot-question' | 'reboot-abort'; rebootGroupIndex: number };

export function buildInstruction(state: InstructionState): string {
  switch (state.phase) {
    case 'exit-qualifying':
      return `The user's message is not something this WiFi support tool can help with. Respond briefly and politely: acknowledge what they said in one short sentence, let them know this tool is specifically for WiFi connectivity issues, and close the conversation. Do NOT give advice, tips, or information about the off-topic subject. Do NOT ask any follow-up questions.`;

    case 'reboot-start':
      return `The qualifying questions are complete and a router reboot is the right next step. Tell the user you are going to walk them through a reboot and ask them to confirm they are ready before you begin.`;

    case 'reboot-question': {
      const group = stepGroups[state.rebootGroupIndex];
      const stepDesc = group ? group.confirmStep.message : 'the current step';
      return `The user has asked a question while being guided through a router reboot. Answer their question clearly and helpfully. After answering, remind them where they left off - they still need to complete this step: "${stepDesc}". Ask them to confirm when they have done so.`;
    }

    case 'reboot-abort':
      return `The user has indicated their issue is resolved or they no longer need to continue the reboot. Acknowledge this warmly and close the conversation. Do NOT continue the reboot steps. Do NOT ask any follow-up questions.`;

    case 'qualifying':
      return `Ask the user these qualifying questions to determine if a router reboot is appropriate:
1. Is the issue affecting all devices, or just one?
2. Have you made any recent changes - like moving the router, adding a new device, or changing any settings?
3. Are any lights on your router showing red, or are any lights off that are usually on?

If this appears to be the start of the conversation, greet the user warmly before asking.
Gather their answers - do not make any decision yet.`;

    case 'reboot': {
      const group = stepGroups[state.rebootGroupIndex];
      if (!group) return 'The reboot steps are complete. Ask the user if their issue is resolved.';

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
      return `This is your final message. The reboot is complete.
- If the user says their issue is resolved: congratulate them warmly and say goodbye.
- If the issue is not resolved: apologize sincerely, suggest they contact their ISP or a technician, and say goodbye.
Do NOT ask any follow-up questions. Do NOT offer further troubleshooting. Close the conversation.`;

    case 'closed':
      return `The conversation has concluded. Offer a brief warm closing if needed.`;
  }
}
