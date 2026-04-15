import { Step } from '../stateEngine/types';

export const rebootSteps: Step[] = [
  {
    message: 'Please unplug the power cable from both your router and modem.',
    waitForUser: false,
  },
  {
    message: 'Wait about 10 seconds.',
    waitForUser: true,
  },
  {
    message: 'Now plug your modem back in and wait about 2 minutes until it is fully online.',
    waitForUser: true,
  },
  {
    message: 'Next, plug your router back in.',
    waitForUser: true,
  },
  {
    message: "Wait until the router's power light stops blinking (about 2 minutes).",
    waitForUser: false,
  },
  {
    message: 'Try connecting to the internet again. Let me know if it works.',
    waitForUser: true,
  },
];
