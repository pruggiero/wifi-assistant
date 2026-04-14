import { rebootSteps, RebootStep } from '../constants/rebootSteps';
import { IssueType } from './types';

export interface StepGroup {
  presentSteps: RebootStep[];
  confirmStep: RebootStep;
}

export interface IssuePrompts {
  /** Instruction when starting the guided flow (after qualifying). */
  start: string;
  /** Short description of the flow used mid-step, e.g. "a router reboot". */
  questionContext: string;
  /** Instruction when the user aborts mid-flow. */
  abort: string;
  /** Instruction shown when all steps are done, transitioning to resolution. */
  stepsComplete: string;
}

export interface IssueConfig {
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
function buildStepGroups(steps: RebootStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  let i = 0;

  while (i < steps.length) {
    const group: RebootStep[] = [];

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

// Registry of issue configs keyed by issue type — add an entry here to support a new issue type
export const issueRegistry: Record<IssueType, IssueConfig> = {
  reboot: {
    steps: buildStepGroups(rebootSteps),
    prompts: {
      start: `The qualifying questions are complete and a router reboot is the right next step. Tell the user you are going to walk them through a reboot and ask them to confirm they are ready before you begin.`,
      questionContext: 'a router reboot',
      abort: `The user has indicated their issue is resolved or they no longer need to continue the reboot. Acknowledge this warmly and close the conversation. Do NOT continue the reboot steps. Do NOT ask any follow-up questions.`,
      stepsComplete: 'The reboot steps are complete. Ask the user if their issue is resolved.',
    },
  },
};
