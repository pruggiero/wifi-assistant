import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';
import { SYSTEM_PROMPT } from '../constants/systemPrompt';
import { buildInstruction } from '../stateEngine/promptBuilder';

// LLM-as-judge evals: use a second LLM call to score the quality of the first.
// These guard response behaviour that is hard to assert with string matching.
//
// Run with: OPENAI_API_KEY=sk-... npx vitest run "src/test/responseQuality"

const hasKey = !!process.env.OPENAI_API_KEY;
const itLive = hasKey ? it : it.skip;

async function getResponse(
  state: Parameters<typeof buildInstruction>[0],
  userMessage: string
): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const instruction = buildInstruction(state);
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
      { role: 'user', content: userMessage },
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

describe('response quality (LLM-as-judge)', () => {
  // Guards the bug where resolution phase kept asking follow-up questions
  itLive('resolution phase closes conversation when issue is resolved', async () => {
    const response = await getResponse(
      { phase: 'resolution', issueType: 'reboot', stepIndex: 0 },
      'Yes! My internet is working again, thank you!'
    );
    expect(await judge('Does this response close the conversation without asking any follow-up questions?', response)).toBe('yes');
    expect(await judge('Does this response congratulate or express happiness that the issue is resolved?', response)).toBe('yes');
  });

  itLive('resolution phase suggests ISP or technician when issue is unresolved', async () => {
    const response = await getResponse(
      { phase: 'resolution', issueType: 'reboot', stepIndex: 0 },
      'No, still not working after the reboot.'
    );
    expect(await judge('Does this response suggest contacting an ISP or technician?', response)).toBe('yes');
    expect(await judge('Does this response ask the user to try more troubleshooting steps?', response)).toBe('no');
  });

  itLive('qualifying phase asks at least one qualifying question', async () => {
    const response = await getResponse(
      { phase: 'qualifying', issueType: null, stepIndex: 0 },
      'Hello, my internet stopped working.'
    );
    expect(await judge('Does this response ask whether the issue is affecting all devices or just one?', response)).toBe('yes');
  });

  itLive('reboot phase does not skip ahead to next step unprompted', async () => {
    const response = await getResponse(
      { phase: 'guided-steps', issueType: 'reboot', stepIndex: 0 },
      'ok im ready to start'
    );
    expect(await judge('Does this response ask the user to unplug the power cable from the router or modem?', response)).toBe('yes');
    expect(await judge('Does this response ask the user to plug anything back in?', response)).toBe('no');
  });

  // Guards the bug where partial success caused the LLM to improvise further troubleshooting
  itLive('resolution phase closes conversation on partial success without further troubleshooting', async () => {
    const response = await getResponse(
      { phase: 'resolution', issueType: 'reboot', stepIndex: 0 },
      'The internet is working on my laptop now but my phone still cannot connect.'
    );
    expect(await judge('Does this response suggest contacting an ISP or technician for the remaining issue?', response)).toBe('yes');
    expect(await judge('Does this response offer further troubleshooting steps such as toggling WiFi or forgetting the network?', response)).toBe('no');
    expect(await judge('Does this response ask a follow-up question?', response)).toBe('no');
  });

  // Guards the resolution-pending bug where "let me check" closed the conversation immediately
  itLive('resolution phase does not close conversation when user is still checking', async () => {
    const pendingInstruction = `The user is still checking whether their issue is resolved. Respond warmly and let them know you will be here when they are ready. Do NOT say goodbye. Do NOT close the conversation.`;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${pendingInstruction}` },
        { role: 'user', content: 'uhh let me check' },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response close the conversation or say goodbye?', response)).toBe('no');
    expect(await judge('Does this response tell the user to take their time or that you will be here when ready?', response)).toBe('yes');
  });

  // Guards the bug where "working but slow" triggered further troubleshooting instead of closing
  itLive('resolution phase closes conversation when issue is working but degraded', async () => {
    const response = await getResponse(
      { phase: 'resolution', issueType: 'reboot', stepIndex: 0 },
      'ya its working now but is a bit slow'
    );
    expect(await judge('Does this response close the conversation or say goodbye?', response)).toBe('yes');
    expect(await judge('Does this response offer further troubleshooting steps or ask the user to try anything else?', response)).toBe('no');
  });
});
