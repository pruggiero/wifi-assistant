import { describe, it, expect } from 'vitest';

// Eval tests for the resolution classifier.
// Run with: OPENAI_API_KEY=sk-... npx vitest run "src/test/classifyResolution"

const hasKey = !!process.env.OPENAI_API_KEY;
const itLive = hasKey ? it : it.skip;

async function getClassifier() {
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { classifyResolution } = await import('../stateEngine/transitions');
  return (messages: { role: 'user' | 'assistant'; content: string }[]) =>
    classifyResolution(messages, openai);
}

describe('classifyResolution (integration)', () => {
  itLive('returns resolved when user confirms internet is working', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Please try connecting to the internet. Is your issue resolved?' },
      { role: 'user', content: 'yes its working now, thank you!' },
    ]);
    expect(result).toBe('resolved');
  });

  itLive('returns resolved for short affirmative after direct resolution question', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is your issue now resolved?' },
      { role: 'user', content: 'yes' },
    ]);
    expect(result).toBe('resolved');
  });

  itLive('returns unresolved when user confirms issue is still not fixed', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is your issue now resolved?' },
      { role: 'user', content: 'no still not working' },
    ]);
    expect(result).toBe('unresolved');
  });

  // Guards the bug where "slow" was classified as question instead of partial.
  // "connected but slow" is a degraded-but-working state and should close via partial path.
  itLive('returns partial when internet is connected but slow', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Please try connecting to the internet. Let me know if it works!' },
      { role: 'user', content: 'i reconnected, but everything is really slow' },
    ]);
    expect(result).toBe('partial');
  });

  itLive('returns partial when some devices work but not all', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is your issue resolved?' },
      { role: 'user', content: 'my laptop is working now but my phone still cannot connect' },
    ]);
    expect(result).toBe('partial');
  });

  itLive('returns pending when user is still checking', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is your issue resolved?' },
      { role: 'user', content: 'uhh let me check' },
    ]);
    expect(result).toBe('pending');
  });

  itLive('returns question when user asks a follow-up without confirming outcome', async () => {
    const classify = await getClassifier();
    const result = await classify([
      { role: 'assistant', content: 'Is your issue resolved?' },
      { role: 'user', content: 'how do i contact my isp?' },
    ]);
    expect(result).toBe('question');
  });
});
