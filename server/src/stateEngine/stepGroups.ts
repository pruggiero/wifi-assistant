import { rebootSteps } from '../constants/rebootSteps';
import { IssueType, Step } from './types';

export interface StepGroup {
  presentSteps: Step[];
  confirmStep: Step;
}

export interface IssuePrompts {
  start: string;
  /** Short phrase inserted into: "guided through {questionContext}". E.g. "a router reboot". */
  questionContext: string;
  abort: string;
  stepsComplete: string;
  /** Falls back to a generic close if omitted. */
  resolution?: string;
}

export interface IssueQualifying {
  /** Used verbatim in the classifier prompt. One sentence: when should this type be chosen? */
  classifierDescription: string;
  /** Written as a fragment; joined with other issues' criteria in the qualifying prompt. */
  exitCriteria?: string;
  /** Suggestion pool - the LLM picks the most relevant 1-2 per turn, not the full list. */
  suggestedQuestions: string[];
}

export interface IssueConfig {
  qualifying: IssueQualifying;
  steps: StepGroup[];
  prompts: IssuePrompts;
}

/**
 * Groups reboot steps so that consecutive non-waiting steps are bundled with
 * the next waiting step. The user only needs to confirm once per group.
 *
 * Example for steps [1T, 2F, 3T, 4T, 5F, 6T]:
 *   Group 0: present [1],    confirm on 1
 *   Group 1: present [2, 3], confirm on 3
 *   Group 2: present [4],    confirm on 4
 *   Group 3: present [5, 6], confirm on 6
 */
function buildStepGroups(steps: Step[]): StepGroup[] {
  const groups: StepGroup[] = [];
  let i = 0;

  while (i < steps.length) {
    const group: Step[] = [];

    // Collect any non-waiting steps that precede the next waiting step
    while (i < steps.length && !steps[i].waitForUser) {
      group.push(steps[i]);
      i++;
    }

    // Add the waiting step that closes this group
    if (i < steps.length && steps[i].waitForUser) {
      group.push(steps[i]);
      groups.push({ presentSteps: group, confirmStep: steps[i] });
      i++;
    }
  }

  return groups;
}

// To add a new issue type: extend IssueType in types.ts, create a steps file, add an entry here.
// Routing, classifiers, and prompt builder all read from this registry.
export const issueRegistry: Record<IssueType, IssueConfig> = {
  reboot: {
    qualifying: {
      classifierDescription: `The user's issue affects ALL devices on the network and a router reboot is appropriate`,
      exitCriteria: 'only one device is affected, a specific website is down, an ISP outage is suspected, or there is physical hardware damage',
      suggestedQuestions: [
        'Is the issue affecting all devices, or just one?',
        'Have you made any recent changes - like moving the router, adding a new device, or changing any settings?',
        'Are any lights on your router showing red, or are any lights off that are usually on?',
      ],
    },
    steps: buildStepGroups(rebootSteps),
    prompts: {
      start: `The qualifying questions are complete and a router reboot is the right next step. Briefly tell the user you are going to walk them through a reboot, framing it as the first step in resolving their issue, not a generic "next step".`,
      questionContext: 'a router reboot',
      abort: `The user has indicated their issue is resolved or they no longer need to continue the reboot. Acknowledge this warmly and close the conversation. Do NOT continue the reboot steps. Do NOT ask any follow-up questions.`,
      stepsComplete: 'The reboot steps are complete. Ask the user if their issue is resolved.',
      resolution: `This is your final message. The router reboot is complete.
- If the user says their issue is resolved: congratulate them warmly and say goodbye.
- If the issue is not resolved: apologize sincerely, suggest they contact their ISP or a technician, and say goodbye.
Do NOT ask any follow-up questions. Do NOT offer further troubleshooting. Close the conversation.`,
    },
  },
};
