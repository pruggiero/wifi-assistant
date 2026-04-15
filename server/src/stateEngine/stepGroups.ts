import { rebootConfig } from '../constants/rebootConfig';
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
  /** If omitted, falls back to a generic close message. */
  resolution?: string;
}

export interface IssueQualifying {
  /** One sentence used in the classifier prompt: when should this issue type be chosen? */
  classifierDescription: string;
  /** Extra conditions that should route to this issue type regardless of device count.
   *  Each entry is a short fragment, e.g. "router shows abnormal lights".
   *  Rendered as "Also choose <issueType> when: <signal>" in the classifier prompt. */
  routingSignals?: string[];
  /** Conditions under which guided troubleshooting should be skipped. Each is a standalone condition. */
  exitCriteria?: string[];
  /** Optional extra instruction appended to the exit classifier prompt. Use for issue-specific overrides
   *  that clarify when exit criteria should or should not apply. */
  exitClassifierNote?: string;

  /** Questions the LLM can draw from. It picks the 1-2 most relevant per turn, not all of them. */
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
export function buildStepGroups(steps: Step[]): StepGroup[] {
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

// To add a new issue type: extend IssueType in types.ts, add a steps file and config file under
// constants/, then add an entry below. Routing, classifiers, and prompt builder all pull from this registry.
export const issueRegistry: Record<IssueType, IssueConfig> = {
  reboot: rebootConfig,
};
