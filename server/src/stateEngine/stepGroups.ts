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

// To add a new issue type: extend IssueType in types.ts, add a steps file, then add an entry below.
// Routing, classifiers, and prompt builder all pull from this registry.
export const issueRegistry: Record<IssueType, IssueConfig> = {
  reboot: {
    qualifying: {
      classifierDescription: `WiFi is down or slow across all (or most) devices on the network, suggesting a router or modem issue`,
      routingSignals: [
        'router shows abnormal lights (red, or lights off that are usually on) - choose reboot even if only one device is affected',
        'user made recent network changes (moved the router, added a new device, changed settings) - choose reboot even if only one device is affected',
        'user has already attempted a reboot at home but the issue persists - still choose reboot to guide them through the proper procedure',
      ],
      exitCriteria: [
        'the user has directly confirmed other named devices are working (e.g. "my phone works fine", "tablet connects normally") AND only one device is affected — stating only one device is affected without also confirming others work does NOT meet this criterion; this applies even if the user recently moved the router or made other network changes',
        'a specific website is down but general internet access is fine',
        'an ISP outage is suspected',
        'the router has visible physical damage (e.g. cracked, dropped, burnt, flooded)',
      ],
      exitClassifierNote: 'For the physical damage criterion only: abnormal router lights (red lights, or lights off that are usually on) do NOT count as physical hardware damage — they indicate a software/connection issue that warrants guided troubleshooting, not an exit.',
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
      abort: `The user has indicated they want to stop and no longer need to continue the reboot. Acknowledge this warmly and close the conversation. Do NOT continue the reboot steps. Do NOT ask any follow-up questions.`,
      stepsComplete: `The reboot steps are complete. Look at the user's last message to determine the outcome:
- If they have already indicated the issue is fully resolved: congratulate them warmly and say goodbye.
- If they have already indicated the issue is only partially resolved (e.g. one device works but not another): acknowledge the partial progress, suggest they contact their ISP or a technician for the remaining issue, and say goodbye. Do NOT offer further troubleshooting.
- If they have already indicated the issue is not resolved: apologize sincerely, suggest they contact their ISP or a technician, and say goodbye.
- If the outcome is not yet clear: ask them if their issue is resolved.
Do NOT offer troubleshooting steps. Do NOT ask any follow-up questions beyond asking about the outcome.`,
      resolution: `This is your final message. The router reboot is complete.
- If the user says their issue is fully resolved: congratulate them warmly and say goodbye.
- If the issue is working but degraded (e.g. slow, intermittent, not as fast as before): acknowledge the improvement, let them know that if it continues they should contact their ISP, and say goodbye. Do NOT offer further troubleshooting.
- If the issue is not resolved: apologize sincerely, suggest they contact their ISP or a technician, and say goodbye.
- If the issue is only partially resolved (e.g. some devices work but not others): acknowledge the partial progress, suggest they contact their ISP or a technician for the remaining issue, and say goodbye. Do NOT offer further troubleshooting steps.
Do NOT ask any follow-up questions. Do NOT offer further troubleshooting. Close the conversation.`,
    },
  },
};
