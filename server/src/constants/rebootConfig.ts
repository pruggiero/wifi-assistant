import { rebootSteps } from './rebootSteps';
import { IssueConfig } from '../stateEngine/stepGroups';
import { buildStepGroups } from '../stateEngine/stepGroups';
import { QualifyingFacts } from '../stateEngine/qualifyingFacts';

export const rebootConfig: IssueConfig = {
  qualifying: {
    route(facts: QualifyingFacts) {
      // Hard exits - reboot won't help these
      if (facts.physicalDamage) return 'exit';
      if (facts.appSpecific) return 'exit';
      if (facts.ispOutageSuspected || facts.crossLocationAffected) return 'exit';

      // Other devices working fine - device-specific problem, not the router
      if (facts.devicesAffected === 'single' && facts.otherDevicesUnaffected) return 'exit';

      // Router signals - reboot regardless of device count
      if (facts.routerLightsStatus === 'abnormal' || facts.recentNetworkChanges === 'yes') return 'reboot';

      // Multiple devices affected, no exit signal - reboot
      if (facts.devicesAffected === 'multiple') return 'reboot';

      // Single device
      if (facts.devicesAffected === 'single') {
        if (facts.onlyDevice) {
          // Can't confirm it's device-specific with no other devices to compare.
          // Skip router questions if general connectivity is already confirmed broken.
          if (facts.generalConnectivityConfirmed) return 'reboot';
          if (facts.routerLightsStatus === 'unknown' || facts.recentNetworkChanges === 'unknown') return 'continue';
          return 'reboot';
        }
        if (facts.routerLightsStatus === 'unknown' || facts.recentNetworkChanges === 'unknown') return 'continue';
        return 'exit'; // single device, no router signals - likely a device problem
      }

      return 'continue';
    },
    suggestedQuestions: [
      'Is the issue affecting all devices, or just one?',
      'Is it only affecting one specific app or game, or is all internet access affected?',
      'Can you load other websites or use other apps, or is all internet access down?',
      'Have you made any recent changes - like moving the router, adding a new device, or changing any settings?',
      'Are any lights on your router showing red, or are any lights off that are usually on?',
    ],
  },
  steps: buildStepGroups(rebootSteps),
  prompts: {
    start: `The qualifying questions are complete and a router reboot is the right next step. Briefly tell the user you are going to walk them through a reboot to resolve their issue. Do NOT use phrases like "let's start" or "first step" - the conversation has already been going; frame it as the solution, not the beginning.`,
    questionContext: 'a router reboot',
    abort: `The user has indicated they want to stop and no longer need to continue the reboot. Acknowledge this warmly and close the conversation. Do NOT continue the reboot steps. Do NOT ask any follow-up questions.`,
    stepsComplete: `The user confirmed the issue is resolved. Congratulate them warmly and say goodbye. Do NOT offer troubleshooting steps. Do NOT ask follow-up questions.`,
    resolution: {
      resolved: `This is your final message. Everything is working normally. Congratulate the user warmly and say goodbye. Do NOT mention ISP contact or suggest further steps. Do NOT ask follow-up questions.`,
      partial: `This is your final message. The issue is partially resolved — things are better but not fully fixed. Acknowledge the progress positively. Tell the user to contact their ISP or a technician for what remains — suggest they check their ISP's website or the contact number on their billing statement or the back of their router. Say goodbye. Do NOT offer further troubleshooting steps or suggest any other procedures (no factory reset, no additional reboots). Do NOT ask follow-up questions.`,
      unresolved: `This is your final message. The issue is not resolved. Apologize sincerely. Tell the user to contact their ISP or a technician — suggest they check their ISP's website or the contact number on their billing statement or the back of their router. Say goodbye. Do NOT offer further troubleshooting steps or suggest any other procedures. Do NOT ask follow-up questions.`,
    },
  },
};
