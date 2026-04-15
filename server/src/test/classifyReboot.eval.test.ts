import { describe, it, expect } from 'vitest';

// Eval tests for the reboot step response classifier.
// Run with: OPENAI_API_KEY=sk-... npx vitest run "src/test/classifyReboot"

const hasKey = !!process.env.OPENAI_API_KEY;
const itLive = hasKey ? it : it.skip;

async function getClassifier() {
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { classifyStepResponse } = await import('../stateEngine/transitions');
  return (messages: { role: 'user' | 'assistant'; content: string }[], stepMsg: string) => {
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content ?? '';
    return classifyStepResponse(lastUserMessage, stepMsg, openai, 'reboot');
  };
}

const UNPLUG_STEP = 'Please unplug the power cable from both your router and modem.';
const MODEM_STEP = 'Now plug your modem back in and wait about 2 minutes until it is fully online.';

describe('classifyStepResponse (integration)', () => {
  itLive('returns question when user asks how long to wait', async () => {
    const classify = await getClassifier();
    const result = await classify(
      [{ role: 'user', content: 'how do I know when the modem is fully online?' }],
      MODEM_STEP
    );
    expect(result).toBe('question');
  });

  itLive('returns confirm when user says it is plugged in', async () => {
    const classify = await getClassifier();
    const result = await classify(
      [{ role: 'user', content: 'ok its plugged back in' }],
      MODEM_STEP
    );
    expect(result).toBe('confirm');
  });

  itLive('returns resolved when user says their internet is working again', async () => {
    const classify = await getClassifier();
    const result = await classify(
      [{ role: 'user', content: 'oh wait nevermind its all working again' }],
      UNPLUG_STEP
    );
    expect(result).toBe('resolved');
  });

  itLive('returns abort when user says nevermind mid-reboot', async () => {
    const classify = await getClassifier();
    const result = await classify(
      [{ role: 'user', content: 'actually nevermind I don\'t want to do this anymore' }],
      MODEM_STEP
    );
    expect(result).toBe('abort');
  });

  // Combined confirm + question should not swallow the question by returning confirm
  itLive('returns question when user confirms step but also asks a question', async () => {
    const classify = await getClassifier();
    const result = await classify(
      [{ role: 'user', content: 'ok just unplugged both of them - but do I need to unplug the cable going into the wall socket too?' }],
      UNPLUG_STEP
    );
    expect(result).toBe('question');
  });

  // Temporary pause should not be classified as abort
  itLive('returns question when user says they need to step away briefly', async () => {
    const classify = await getClassifier();
    const result = await classify(
      [{ role: 'user', content: 'hold on, ill be right back need to use the washroom' }],
      MODEM_STEP
    );
    expect(result).toBe('question');
  });

  // Confirm followed by a complaint — the complaint is a side-effect, not a question or abort.
  // The user completed the step; the bot should move on, not re-ask.
  itLive('returns confirm when user completes step but complains about a side effect', async () => {
    const classify = await getClassifier();

    const result1 = await classify(
      [{ role: 'user', content: 'ok done, it made my wow crash' }],
      UNPLUG_STEP
    );
    expect(result1).toBe('confirm');

    const result2 = await classify(
      [{ role: 'user', content: 'i did it but it was really annoying' }],
      UNPLUG_STEP
    );
    expect(result2).toBe('confirm');
  });
});
