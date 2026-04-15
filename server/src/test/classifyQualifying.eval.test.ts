import { describe, it, expect } from 'vitest';

// Integration tests for classifyQualifying.
// These use the real OpenAI API and are skipped unless OPENAI_API_KEY is set.
// They capture the actual message sequences from manual testing (see screenshots).
//
// Run with: OPENAI_API_KEY=sk-... npx vitest run "src/test/classifyQualifying"

const hasKey = !!process.env.OPENAI_API_KEY;
const itLive = hasKey ? it : it.skip;

// Lazy import to avoid instantiating OpenAI without a key
async function getClassifier() {
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { classifyQualifying } = await import('../stateEngine/transitions');
  return (messages: { role: 'user' | 'assistant'; content: string }[]) =>
    classifyQualifying(messages, openai);
}

describe('classifyQualifying (integration)', () => {
  // From screenshot: user says all devices affected, no changes, no lights
  // Expected: enough info to proceed with reboot
  itLive('returns reboot when all devices affected, no changes, no lights', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one? Have you made any recent changes? Are any lights on your router red or off?' },
      { role: 'user', content: 'all devices, no changes' },
      { role: 'assistant', content: 'Can you check your router lights?' },
      { role: 'user', content: 'no lights' },
    ]);
    expect(result).toBe('reboot');
  });

  // Single device affected - reboot won't help
  itLive('returns exit when only one device is affected', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one? Have you made any recent changes? Are any lights on your router red or off?' },
      { role: 'user', content: 'just my laptop, phone and tablet are working fine, no changes, lights look normal' },
    ]);
    expect(result).toBe('exit');
  });

  // Suspected ISP outage - reboot won't help
  itLive('returns exit for suspected ISP outage', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one? Have you made any recent changes?' },
      { role: 'user', content: 'all devices, my neighbour has the same issue, I think the ISP is down' },
    ]);
    expect(result).toBe('exit');
  });

  // WiFi broken on all devices but ethernet works - still a router-level issue worth rebooting
  itLive('returns reboot when WiFi is down but ethernet works', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one? Have you made any recent changes? Are any lights on your router red or off?' },
      { role: 'user', content: 'all my wifi devices are affected but my desktop on ethernet is fine, no changes, lights look normal' },
    ]);
    expect(result).toBe('reboot');
  });

  // User already tried rebooting themselves - guide them through the proper steps anyway
  itLive('returns reboot when user already tried rebooting but issue persists', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one? Have you made any recent changes? Are any lights on your router red or off?' },
      { role: 'user', content: 'all devices are affected, I already tried turning the router off and on but it didn\'t help, no changes, lights look normal' },
    ]);
    expect(result).toBe('reboot');
  });

  // Completely ambiguous opening - no useful qualifying info
  itLive('returns continue for a vague complaint with no qualifying info', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Hi! I can help with your WiFi. Is the issue affecting all devices, or just one? Have you made any recent changes?' },
      { role: 'user', content: 'my internet is being weird' },
    ]);
    expect(result).toBe('continue');
  });

  // User only has one device - can't confirm if others are affected, need more info
  itLive('returns continue when user only has one device and cannot compare', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one? Have you made any recent changes? Are any lights on your router red or off?' },
      { role: 'user', content: 'I only have one device, my laptop, no changes, lights look normal' },
    ]);
    expect(result).toBe('continue');
  });

  // User only has one device but router lights are red - router symptom is enough to route to reboot
  itLive('returns reboot when user has one device but router shows red lights', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one? Have you made any recent changes? Are any lights on your router red or off?' },
      { role: 'user', content: 'I only have one device, my laptop, no changes' },
      { role: 'assistant', content: 'Can you check your router lights?' },
      { role: 'user', content: 'red' },
    ]);
    expect(result).toBe('reboot');
  });

  // User only has one device and lights are off that are usually on
  itLive('returns reboot when user has one device and router lights are off', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one? Have you made any recent changes? Are any lights on your router red or off?' },
      { role: 'user', content: 'I only have one device, my laptop, no changes, some lights on my router that are usually on are now off' },
    ]);
    expect(result).toBe('reboot');
  });

  // Single device but user moved the router recently
  itLive('returns reboot when user has one device but recently moved the router', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one? Have you made any recent changes?' },
      { role: 'user', content: 'just my laptop but I moved my router to a different room yesterday' },
    ]);
    expect(result).toBe('reboot');
  });

  // Single device but user added a new device to the network
  itLive('returns reboot when user has one device but recently added a new device to the network', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one? Have you made any recent changes?' },
      { role: 'user', content: 'only my laptop is having issues, I added a new smart TV to the network yesterday' },
    ]);
    expect(result).toBe('reboot');
  });

  // Routing signal present (recent change) but other devices confirmed working - exit should win
  itLive('returns exit when other devices confirmed working even with a recent network change', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one? Have you made any recent changes?' },
      { role: 'user', content: 'just my laptop, my phone and tablet are both working fine, I moved the router yesterday' },
    ]);
    expect(result).toBe('exit');
  });

  // Multiple devices affected + router lights off — should route to reboot, not exit as hardware damage
  itLive('returns reboot when multiple devices affected and router lights are off', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue happening on all devices or just one? Are there any lights on your router that look unusual?' },
      { role: 'user', content: 'my laptop and phone both have no internet, and the lights on my router are off' },
    ]);
    expect(result).toBe('reboot');
  });
});
