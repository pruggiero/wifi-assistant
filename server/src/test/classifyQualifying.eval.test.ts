import { describe, it, expect } from 'vitest';

// Integration tests for classifyQualifying.
// These use the real OpenAI API and are skipped unless OPENAI_API_KEY is set.
// They capture the actual message sequences from manual testing.
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
      { role: 'user', content: 'just my laptop - my phone and tablet connect fine. no changes, lights look normal' },
    ]);
    expect(result).toBe('exit');
  });

  // Single device + no routing signals, other devices not named - exit without requiring explicit confirmation
  itLive('returns exit when single device affected with no routing signals even without naming other devices', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one?' },
      { role: 'user', content: 'just one' },
      { role: 'assistant', content: 'Have you made any recent changes - like moving the router, adding a new device, or changing any settings?' },
      { role: 'user', content: 'no' },
      { role: 'assistant', content: 'Are any lights on your router showing red, or are any lights off that are usually on?' },
      { role: 'user', content: 'looks normal' },
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

  // Completely ambiguous opening, or a specific description with unknown device count — neither gives enough info to route.
  itLive('returns continue with no qualifying routing info', async () => {
    const classify = await getClassifier();

    const result1 = await classify([
      { role: 'assistant', content: 'Hi! I can help with your WiFi. Is the issue affecting all devices, or just one? Have you made any recent changes?' },
      { role: 'user', content: 'my internet is being weird' },
    ]);
    expect(result1).toBe('continue');

    const result2 = await classify([
      { role: 'assistant', content: 'Can you describe what\'s happening with your WiFi?' },
      { role: 'user', content: 'when i search where to buy a cat, it says i don\'t have internet' },
    ]);
    expect(result2).toBe('continue');
  });

  // User only has one device and router questions haven't been asked yet — still need that info.
  itLive('returns continue when user only has one device and cannot compare', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Can you describe what\'s happening with your WiFi?' },
      { role: 'user', content: 'my internet is really slow' },
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one?' },
      { role: 'user', content: 'I only have one device, my laptop' },
    ]);
    expect(result).toBe('continue');
  });

  // Router signals override single-device ambiguity — covers both red lights and lights that are off.
  itLive('returns reboot when user has one device and router lights are abnormal', async () => {
    const classify = await getClassifier();

    const result1 = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one? Have you made any recent changes? Are any lights on your router red or off?' },
      { role: 'user', content: 'I only have one device, my laptop, no changes' },
      { role: 'assistant', content: 'Can you check your router lights?' },
      { role: 'user', content: 'red' },
    ]);
    expect(result1).toBe('reboot');

    const result2 = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one? Have you made any recent changes? Are any lights on your router red or off?' },
      { role: 'user', content: 'I only have one device, my laptop, no changes, some lights on my router that are usually on are now off' },
    ]);
    expect(result2).toBe('reboot');
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

  // Routing signal present (recent change) but other devices confirmed working - exit should win
  itLive('returns exit when other devices confirmed working even with a recent network change', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one? Have you made any recent changes?' },
      { role: 'user', content: 'just my laptop, my phone and tablet are both working fine, I moved the router yesterday' },
    ]);
    expect(result).toBe('exit');
  });

  // Multiple devices affected + router lights off - should route to reboot, not exit as hardware damage
  itLive('returns reboot when multiple devices affected and router lights are off', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue happening on all devices or just one? Are there any lights on your router that look unusual?' },
      { role: 'user', content: 'my laptop and phone both have no internet, and the lights on my router are off' },
    ]);
    expect(result).toBe('reboot');
  });


  // Physical damage is an exit criterion — reboot won't help a broken router
  itLive('returns exit when router has visible physical damage', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one? Are there any lights on your router that look unusual?' },
      { role: 'user', content: 'all devices are affected, my router fell off the shelf and now it looks cracked and burnt' },
    ]);
    expect(result).toBe('exit');
  });

  // "Netflix on all devices" is an app-specific failure, not a general internet failure.
  // Multiple devices all failing the same app is a service issue, not a router issue — exit.
  itLive('returns exit when issue is limited to one specific app across all devices', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one?' },
      { role: 'user', content: "Netflix isn't loading on any of my devices but my internet is otherwise working fine" },
    ]);
    expect(result).toBe('exit');
  });

  // Same issue at a different physical location = service/ISP outage, not a local router problem.
  itLive('returns exit when same issue affects a user at a different location', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one?' },
      { role: 'user', content: "netflix isn't working on any of my devices or my friend's and they live 30 minutes away" },
    ]);
    expect(result).toBe('exit');
  });

  // Naming a service alone doesn't mean it's app-specific — covers service failures, login errors,
  // and disconnections, none of which confirm general internet is working.
  itLive('returns continue when user names a service without confirming general internet is working', async () => {
    const classify = await getClassifier();
    for (const msg of [
      'netflix is not working',
      'im trying to login in WoW, but its giving me an error',
      'keep disconnecting from WoW',
      'keep disconnecting from FFXIV',
    ]) {
      const result = await classify([
        { role: 'assistant', content: 'Hi! I\'m here to help. Can you describe what\'s happening with your WiFi?' },
        { role: 'user', content: msg },
      ]);
      expect(result).toBe('continue');
    }
  });

  // User explicitly said other internet is working — genuinely app-specific, exit.
  itLive('returns exit when user confirms general internet is fine but one app is not', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all of your internet, or just one app?' },
      { role: 'user', content: 'everything else is working fine, I can browse and use other apps, only Netflix is not loading' },
    ]);
    expect(result).toBe('exit');
  });

  // Two people in the same household both experiencing an issue = multiple devices on the same
  // network, not a cross-location report. Should stay in qualifying (multiple devices → reboot path).
  itLive('returns reboot when multiple household members have the same issue', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one?' },
      { role: 'user', content: 'me and my wife\'s computer both having the issue' },
    ]);
    expect(result).toBe('reboot');
  });

  // Router lights and recent changes haven't been asked yet — stay in qualifying.
  // Also covers the two-turn case: bot asks device count, user says "just my laptop" —
  // that names the affected device, not that other devices are working fine.
  itLive('returns continue when single device mentioned on first turn with no routing signal info', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Hi! I\'m here to help. Can you describe what\'s happening with your WiFi?' },
      { role: 'user', content: 'just my laptop has no internet' },
    ]);
    expect(result).toBe('continue');

    const result2 = await classify([
      { role: 'assistant', content: 'Hi! I\'m here to help. Can you describe what\'s happening with your WiFi?' },
      { role: 'user', content: 'keep disconnecting from WoW' },
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one?' },
      { role: 'user', content: 'just my laptop' },
    ]);
    expect(result2).toBe('continue');
  });

  // Only device, general slow internet, no router changes, lights look normal.
  // No other devices to confirm it's device-specific — should route to reboot, not loop forever.
  itLive('returns reboot when user has only one device and general connectivity is slow', async () => {
    const classify = await getClassifier();

    // Once user confirms general internet is affected (not just one app), skip straight to reboot.
    const result = await classify([
      { role: 'assistant', content: 'Can you describe what\'s happening with your WiFi?' },
      { role: 'user', content: 'Netflix is streaming super slow' },
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one?' },
      { role: 'user', content: 'i only have a laptop' },
      { role: 'assistant', content: 'Can you load other websites or use other apps, or is all internet access down?' },
      { role: 'user', content: 'everything seems slow, pages barely load, other apps are slow too' },
    ]);
    expect(result).toBe('reboot');

    // Longer path: only device, router questions all answered, no red flags — also reboot.
    const result2 = await classify([
      { role: 'assistant', content: 'Can you describe what\'s happening with your WiFi?' },
      { role: 'user', content: 'Netflix is streaming super slow' },
      { role: 'assistant', content: 'Is the issue affecting all devices, or just one?' },
      { role: 'user', content: 'i only have a laptop' },
      { role: 'assistant', content: 'Can you load other websites or use other apps, or is all internet access down?' },
      { role: 'user', content: 'everything seems slow' },
      { role: 'assistant', content: 'Have you made any recent changes - like moving the router, adding a new device, or changing any settings?' },
      { role: 'user', content: 'no' },
      { role: 'assistant', content: 'Are any lights on your router showing red, or are any lights off that are usually on?' },
      { role: 'user', content: 'looks normal' },
    ]);
    expect(result2).toBe('reboot');
  });
});
