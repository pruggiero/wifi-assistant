import { ConversationState, IssueType } from './types';
import { issueRegistry } from './stepGroups';

type InstructionState =
  | ConversationState
  | { phase: 'exit-qualifying'; issueType: null; stepIndex: number }
  | { phase: 'flow-start' | 'flow-question' | 'flow-abort'; issueType: IssueType; stepIndex: number };

export function buildInstruction(state: InstructionState): string {
  switch (state.phase) {
    case 'exit-qualifying':
      return `Guided troubleshooting will not resolve the user's specific situation. Respond briefly and politely: acknowledge what they said in one short sentence, explain that you are not able to help further with this particular situation, and suggest an appropriate next step - for example, contacting their ISP for outage or connection issues, getting the hardware inspected or replaced for physical damage, or checking the device's own network settings for a single-device issue. Do NOT provide detailed advice or instructions. Do NOT ask any follow-up questions.`;

    case 'flow-start': {
      const config = issueRegistry[state.issueType];
      const firstGroup = config.steps[0];
      const startPrompt = config.prompts.start;
      const opener = `Do NOT open with "Great!" or any similar affirmation - the user has a problem, not good news. `;
      if (firstGroup) {
        if (firstGroup.presentSteps.length > 1) {
          const stepLines = firstGroup.presentSteps.map((s, i) => `${i + 1}. ${s.message}`).join('\n');
          return `${opener}${startPrompt}\n\nPresent these first steps verbatim as a numbered list:\n${stepLines}\nAsk the user to confirm when they have completed all of these steps.`;
        }
        return `${opener}${startPrompt}\n\nPresent this first step verbatim: "${firstGroup.confirmStep.message}". Ask the user to confirm when they have completed it.`;
      }
      return `${opener}${startPrompt}`;
    }

    case 'flow-question': {
      const config = issueRegistry[state.issueType];
      const group = config.steps[state.stepIndex];
      const context = config.prompts.questionContext;
      let reminder: string;
      if (!group) {
        reminder = 'the current step';
      } else if (group.presentSteps.length > 1) {
        const stepLines = group.presentSteps.map((s, i) => `${i + 1}. ${s.message}`).join('\n');
        reminder = `these steps (in order):\n${stepLines}`;
      } else {
        reminder = `"${group.confirmStep.message}"`;
      }
      return `The user has asked a question or made a comment while being guided through ${context}. Respond warmly and briefly. Then explicitly restate that they still need to complete ${reminder} before you can continue — make it clear the step is not yet done. Ask them to confirm once they have completed it. Do NOT use vague phrases like "let me know when you're ready" or "take your time and let me know" — always name the specific action they still need to do. Do NOT mention or preview any future steps.`;
    }

    case 'flow-abort': {
      return issueRegistry[state.issueType].prompts.abort;
    }

    case 'qualifying': {
      const issueContext = Object.values(issueRegistry)
        .map(c => `- ${c.qualifying.classifierDescription}\n  Useful questions: ${c.qualifying.suggestedQuestions.join(' | ')}`)
        .join('\n');
      return `You are gathering information to diagnose a WiFi issue. Your goal is to determine which of these applies:\n${issueContext}\n\nBased on what the user has already said, ask the 1-2 most relevant follow-up questions. Do not ask questions they have already answered. Do not list all questions at once.\n\nIf this is the start of the conversation (no user messages yet), write a brief warm greeting followed by this single question and nothing else: "Can you describe what's happening with your WiFi?" Do NOT ask any additional questions. Do NOT add follow-up prompts. One question only.\nDo NOT offer troubleshooting steps, workarounds, or advice of any kind - only ask questions. Do NOT suggest contacting an ISP, checking for outages, or any other next steps - even if the issue sounds like it might not be fixable here.\nDo not make a decision yet - just gather information.`;
    }

    case 'guided-steps': {
      const config = issueRegistry[state.issueType!];
      const group = config.steps[state.stepIndex];

      const noAffirmation = `Do NOT open with "Great!", "Perfect!", or any similar affirmation. `;
      if (group.presentSteps.length > 1) {
        const stepLines = group.presentSteps.map((s, i) => `${i + 1}. ${s.message}`).join('\n');
        return `${noAffirmation}The user has completed the previous step. Present ONLY these steps verbatim as a numbered list:\n${stepLines}\nAsk the user to confirm when they have completed all of these steps before continuing.`;
      }

      return `${noAffirmation}The user has completed the previous step. Present ONLY this step verbatim: "${group.confirmStep.message}". Ask the user to confirm when they have completed it before continuing.`;
    }

    default:
      throw new Error(`Unhandled phase in buildInstruction: ${(state as { phase: string }).phase}`);
  }
}
