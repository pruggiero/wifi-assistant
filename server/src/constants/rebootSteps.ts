import { Step } from '../stateEngine/types';

export const rebootSteps: Step[] = [
  {
    id: 1,
    message: 'Please unplug the power cable from both your router and modem.',
    waitForUser: true,
  },
  {
    id: 2,
    message: 'Wait about 10 seconds.',
    waitForUser: false,
  },
  {
    id: 3,
    message: 'Now plug your modem back in and wait about 2 minutes until it is fully online.',
    waitForUser: true,
  },
  {
    id: 4,
    message: 'Next, plug your router back in.',
    waitForUser: true,
  },
  {
    id: 5,
    message: "Wait until the router's power light stops blinking (about 2 minutes).",
    waitForUser: false,
  },
  {
    id: 6,
    message: 'Try connecting to the internet again. Let me know if it works.',
    waitForUser: true,
  },
];
