import { rebootSteps } from './rebootSteps';
import { IssueConfig } from '../stateEngine/stepGroups';
import { buildStepGroups } from '../stateEngine/stepGroups';

export const rebootConfig: IssueConfig = {
  qualifying: {
    classifierDescription: `WiFi is not working across multiple (or all) devices - choose reboot. This is the strongest signal; if the user confirms multiple devices are affected, do not choose continue.`,
    routingSignals: [
      'router shows abnormal lights (red, or lights off that are usually on) - choose reboot even if only one device is affected',
      'user made recent network changes (moved the router, added a new device, changed settings) - choose reboot even if only one device is affected',
      'user has already attempted a reboot at home but the issue persists - still choose reboot to guide them through the proper procedure',
    ],
    exitCriteria: [
      'the user has directly confirmed other named devices are working AND only one device is affected - e.g. "just my laptop, phone and tablet are fine", "my phone works fine, only the laptop is broken". This applies even if a routing signal is present (recent changes, abnormal lights), because confirmed working other devices outweigh routing signals.',
      'only one device is affected AND no routing signals are present (no abnormal router lights, no recent network changes made by the user) - even if the user has not named other working devices',
      'a specific website is down but general internet access is fine',
      'an ISP outage is suspected',
      'the router has visible physical damage (e.g. cracked, dropped, burnt, flooded)',
    ],
    exitClassifierNote: 'For the physical damage criterion only: abnormal router lights (red lights, or lights off that are usually on) do NOT count as physical hardware damage - they indicate a software/connection issue that warrants guided troubleshooting, not an exit. For the single-device-no-signals criterion: router lights that are off or red ARE routing signals and prevent this criterion from applying.',
    suggestedQuestions: [
      'Is the issue affecting all devices, or just one?',
      'Have you made any recent changes - like moving the router, adding a new device, or changing any settings?',
      'Are any lights on your router showing red, or are any lights off that are usually on?',
    ],
  },
  steps: buildStepGroups(rebootSteps),
  prompts: {
    start: `The qualifying questions are complete and a router reboot is the right next step. Briefly tell the user you are going to walk them through a reboot to resolve their issue. Do NOT use phrases like "let's start" or "first step" - the conversation has already been going; frame it as the solution, not the beginning.`,
    questionContext: 'a router reboot',
    abort: `The user has indicated they want to stop and no longer need to continue the reboot. Acknowledge this warmly and close the conversation. Do NOT continue the reboot steps. Do NOT ask any follow-up questions.`,
    stepsComplete: `The reboot steps are complete. Look at the user's last message to determine the outcome:
- If they have already indicated the issue is fully resolved: congratulate them warmly and say goodbye.
- If they have already indicated the issue is only partially resolved (e.g. one device works but not another): acknowledge the partial progress, suggest they contact their ISP or a technician for the remaining issue, and say goodbye. Do NOT offer further troubleshooting.
- If they have already indicated the issue is not resolved: apologize sincerely, suggest they contact their ISP or a technician, and say goodbye.
- If the outcome is not yet clear: ask them if their issue is resolved.
Do NOT offer troubleshooting steps. Do NOT ask any follow-up questions beyond asking about the outcome.`,
    resolution: `This is your final message.
- Fully resolved (everything is working normally): congratulate warmly and say goodbye. Do NOT mention ISP contact or suggest further steps.
- Working but slow or intermittent: congratulate, but mention they should contact their ISP if it continues — and suggest they check their ISP's website or the contact number on their billing statement or the back of their router. Say goodbye.
- Partially resolved (some devices work, others don't): acknowledge the partial progress, suggest contacting their ISP or a technician, and include the same brief guidance on how to reach their ISP (website, billing statement, or back of router). Say goodbye.
- Not resolved: apologize sincerely, tell them to contact their ISP or a technician, and include the same brief guidance on how to reach their ISP. Say goodbye.
Do NOT offer further troubleshooting steps or suggest any other procedures (no factory reset, no additional reboots). Do NOT ask follow-up questions. Close the conversation.`,
  },
};
