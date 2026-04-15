import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';
import { SYSTEM_PROMPT } from '../constants/systemPrompt';
import { buildInstruction } from '../stateEngine/promptBuilder';

// Eval tests for guided-step response correctness.
// Guards against step skipping, wrong step content, and paraphrased timing values.
//
// Run with: OPENAI_API_KEY=sk-... npx vitest run "src/test/stepProgression"

const hasKey = !!process.env.OPENAI_API_KEY;
const itLive = hasKey ? it : it.skip;

async function getResponse(
  stepIndex: number,
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const instruction = buildInstruction({ phase: 'guided-steps', issueType: 'reboot', stepIndex });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
      ...messages,
    ],
  });
  return completion.choices[0].message.content ?? '';
}

async function judge(question: string, response: string): Promise<'yes' | 'no'> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: `You are evaluating a customer support chatbot response. Answer only "yes" or "no".\n\nResponse to evaluate:\n"${response}"\n\nQuestion: ${question}`,
      },
    ],
    max_tokens: 5,
  });
  const text = completion.choices[0].message.content?.toLowerCase().trim() ?? 'no';
  return text.startsWith('yes') ? 'yes' : 'no';
}

// Step index map (0-based groups after buildStepGroups):
// Group 0: step 1 (unplug both) - confirm
// Group 1: step 2 (wait 10s auto) + step 3 (plug modem back in) - confirm
// Group 2: step 4 (plug router back in) - confirm
// Group 3: step 5 (wait for power light auto) + step 6 (try connecting) - confirm

describe('step progression (LLM-as-judge)', () => {

  // Step 0 - group 0: unplug both
  itLive('step 0: asks user to unplug both router and modem', async () => {
    const response = await getResponse(0, [
      { role: 'user', content: 'ok lets do it' },
    ]);
    expect(await judge('Does this response ask the user to unplug the power cable from both the router and modem?', response)).toBe('yes');
    expect(await judge('Does this response ask the user to plug anything back in?', response)).toBe('no');
  });

  // Step 0 stays on correct step after a digression (the skip bug)
  itLive('step 0: does not skip to a later step after a mid-conversation digression', async () => {
    const response = await getResponse(0, [
      { role: 'assistant', content: "I'll walk you through a reboot. First, unplug the power cable from both your router and modem. Let me know when done." },
      { role: 'user', content: 'one sec, need to let my dog out' },
      { role: 'assistant', content: 'Of course, take your time! Let me know when you are back.' },
      { role: 'user', content: 'ok back' },
    ]);
    expect(await judge('Does this response ask the user to unplug the power cable from both the router and modem?', response)).toBe('yes');
    expect(await judge('Does this response ask the user to plug anything back in?', response)).toBe('no');
  });

  // Step 1 - group 1: wait 10s then plug modem back in
  itLive('step 1: tells user to wait 10 seconds before plugging modem back in', async () => {
    const response = await getResponse(1, [
      { role: 'user', content: 'unplugged both' },
    ]);
    expect(await judge(`Does this response tell the user to wait 10 seconds (not 30 seconds or any other duration)?`, response)).toBe('yes');
    expect(await judge('Does this response ask the user to plug the modem back in?', response)).toBe('yes');
  });

  // Step 2 - group 2: plug router back in
  itLive('step 2: asks user to plug router back in', async () => {
    const response = await getResponse(2, [
      { role: 'user', content: 'modem is back on and online' },
    ]);
    expect(await judge('Does this response ask the user to plug the router back in?', response)).toBe('yes');
    expect(await judge('Does this response tell the user to try connecting to the internet yet?', response)).toBe('no');
  });

  // Step 3 - group 3: wait for power light + try connecting
  itLive('step 3: tells user to wait until power light stops blinking before trying to connect', async () => {
    const response = await getResponse(3, [
      { role: 'user', content: 'router is back in' },
    ]);
    expect(await judge("Does this response tell the user to wait until the router's power light stops blinking?", response)).toBe('yes');
    expect(await judge('Does this response ask the user to try connecting to the internet?', response)).toBe('yes');
  });

  // Timing verbatim check: 10s not paraphrased to 30s
  itLive('step 1: relays 10 second wait verbatim, not paraphrased', async () => {
    const response = await getResponse(1, [
      { role: 'assistant', content: "Great! Please unplug the power cable from both your router and modem. Let me know when you've done that." },
      { role: 'user', content: 'done, both unplugged' },
    ]);
    expect(await judge('Does this response mention a wait time of 10 seconds (not 30 seconds or any other amount)?', response)).toBe('yes');
    expect(await judge('Does this response mention waiting 30 seconds?', response)).toBe('no');
  });

  // Correction handling: user says they misread, roll back
  itLive('step 0: handles user correction gracefully and stays on unplug step', async () => {
    const response = await getResponse(0, [
      { role: 'assistant', content: 'Please unplug the power cable from both your router and modem. Let me know when done.' },
      { role: 'user', content: 'plugged it in' },
      { role: 'assistant', content: 'No worries! Please go ahead and unplug the power cable from both your router and modem.' },
      { role: 'user', content: 'meant to say its still plugged in' },
    ]);
    expect(await judge('Does this response ask the user to unplug the power cable?', response)).toBe('yes');
    expect(await judge('Does this response ask the user to plug anything in?', response)).toBe('no');
  });

});

// Guards the bug where qualifying conversation containing "unplugged" caused flow-start to skip step 1.
// The route fix (stripping history for flow-start) is the primary safeguard;
// these evals verify the prompt behaviour holds even if history is present.
describe('flow-start step 1 integrity (LLM-as-judge)', () => {
  async function getFlowStartResponse(
    messages: { role: 'user' | 'assistant'; content: string }[]
  ): Promise<string> {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const instruction = buildInstruction({ phase: 'flow-start', issueType: 'reboot', stepIndex: 0 });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        ...messages,
      ],
    });
    return completion.choices[0].message.content ?? '';
  }

  // User mentioned unplugging during qualifying - LLM must still present step 1
  itLive('flow-start: presents unplug step even when user mentioned unplugging in qualifying', async () => {
    const response = await getFlowStartResponse([
      { role: 'assistant', content: "I can help with that. Is the issue affecting all your devices?" },
      { role: 'user', content: "yes both my laptop and phone lost WiFi. I already tried unplugging the router." },
    ]);
    expect(await judge('Does this response ask the user to unplug the power cable from both the router and modem?', response)).toBe('yes');
    expect(await judge('Does this response ask the user to wait 10 seconds or plug anything back in?', response)).toBe('no');
  });

  // No prior context - clean start
  itLive('flow-start: presents unplug step with no prior context', async () => {
    const response = await getFlowStartResponse([
      { role: 'user', content: "ok let's do it" },
    ]);
    expect(await judge('Does this response ask the user to unplug the power cable from both the router and modem?', response)).toBe('yes');
    expect(await judge('Does this response ask the user to wait 10 seconds or plug anything back in?', response)).toBe('no');
  });
});
