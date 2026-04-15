import { rebootConfig } from '../constants/rebootConfig';
import { IssueType, Step } from './types';
import { QualifyingFacts } from './qualifyingFacts';

export interface StepGroup {
  presentSteps: Step[];
  confirmStep: Step;
}

export interface ResolutionPrompts {
  /** User confirmed the issue is fully resolved. */
  resolved: string;
  /** Some devices or symptoms remain but it's better than before. */
  partial: string;
  /** User confirmed the issue is not resolved. */
  unresolved: string;
}

export interface IssuePrompts {
  start: string;
  /** Short phrase inserted into: "guided through {questionContext}". E.g. "a router reboot". */
  questionContext: string;
  abort: string;
  /** Used when the user self-resolves during guided steps (classifyStepResponse returns 'resolved'). Always a success case. */
  stepsComplete: string;
  resolution: ResolutionPrompts;
}

export interface IssueQualifying {
  /** Routing logic: given extracted facts, return the issue type to route to, 'exit', or 'continue'. */
  route: (facts: QualifyingFacts) => IssueType | 'exit' | 'continue';
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
