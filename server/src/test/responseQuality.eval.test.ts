import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';
import { SYSTEM_PROMPT } from '../constants/systemPrompt';
import { buildInstruction } from '../stateEngine/promptBuilder';
import { issueRegistry } from '../stateEngine/stepGroups';

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
    temperature: 0.3,
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
    temperature: 0,
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
    const instruction = 'The user has confirmed their issue is resolved or improved. ' + issueRegistry['reboot'].prompts.resolution;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        { role: 'user', content: 'Yes! My internet is working again, thank you!' },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response close the conversation without asking any follow-up questions?', response)).toBe('yes');
    expect(await judge('Does this response congratulate or express happiness that the issue is resolved?', response)).toBe('yes');
  });

  itLive('resolution phase suggests ISP or technician when issue is unresolved', async () => {
    const instruction = 'The user has confirmed their issue is NOT resolved. ' + issueRegistry['reboot'].prompts.resolution;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        { role: 'user', content: 'No, still not working after the reboot.' },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response suggest contacting an ISP or technician?', response)).toBe('yes');
    expect(await judge('Does this response ask the user to try more troubleshooting steps?', response)).toBe('no');
  });

  itLive('qualifying phase does not offer troubleshooting advice', async () => {
    // Guards the bug where the qualifying phase told the user to restart their laptop
    const response = await getResponse(
      { phase: 'qualifying', issueType: null, stepIndex: 0 },
      'my laptop cannot stream netflix but I have not checked other devices'
    );
    expect(await judge('Does this response suggest the user restart their device, clear their cache, or try any other troubleshooting action?', response)).toBe('no');
    expect(await judge('Does this response ask at least one diagnostic question?', response)).toBe('yes');
  });

  // Guards the bug where partial success caused the LLM to improvise further troubleshooting
  itLive('resolution phase closes conversation on partial success without further troubleshooting', async () => {
    const instruction = 'The user has confirmed their issue is NOT resolved. ' + issueRegistry['reboot'].prompts.resolution;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        { role: 'user', content: 'The internet is working on my laptop now but my phone still cannot connect.' },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response suggest contacting an ISP or technician for the remaining issue?', response)).toBe('yes');
    expect(await judge('Does this response offer further troubleshooting steps such as toggling WiFi or forgetting the network?', response)).toBe('no');
    expect(await judge('Does this response ask a follow-up question?', response)).toBe('no');
  });

  // Guards the resolution-pending bug where "let me check" closed the conversation immediately
  itLive('resolution phase does not close conversation when user is still checking', async () => {
    const pendingInstruction = `The user is still checking whether their issue is resolved. Respond warmly and let them know you will be here when they are ready. Do NOT offer troubleshooting steps or technical advice. Do NOT say goodbye. Do NOT close the conversation.`;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${pendingInstruction}` },
        { role: 'user', content: 'uhh let me check' },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response close the conversation or say goodbye?', response)).toBe('no');
    expect(await judge('Does this response tell the user to take their time or that you will be here when ready?', response)).toBe('yes');
    expect(await judge('Does this response offer troubleshooting steps or suggest the user try something technical?', response)).toBe('no');
  });

  // Guards the bug where "working but slow" triggered further troubleshooting instead of closing
  itLive('resolution phase closes conversation when issue is working but degraded', async () => {
    const instruction = 'The user has confirmed their issue is resolved or improved. ' + issueRegistry['reboot'].prompts.resolution;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        { role: 'user', content: 'ya its working now but is a bit slow' },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response close the conversation or say goodbye?', response)).toBe('yes');
    expect(await judge('Does this response offer further troubleshooting steps or ask the user to try anything else?', response)).toBe('no');
  });

  // Guards the bug where self-resolved mid-flow routed to abort (cold exit) instead of stepsComplete (warm close)
  itLive('self-resolved mid-flow gets a warm close, not a cold exit', async () => {
    const instruction = issueRegistry['reboot'].prompts.stepsComplete;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        { role: 'user', content: "oh wait it's all working again!" },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response congratulate the user or express happiness that the issue resolved?', response)).toBe('yes');
    expect(await judge('Does this response say goodbye or close the conversation?', response)).toBe('yes');
  });

  // Guards the bug where exit-qualifying said "this tool is specifically for WiFi connectivity issues"
  // even when the problem clearly was a WiFi/connectivity issue (e.g. ISP outage)
  itLive('exit-qualifying suggests a next step rather than dismissing the user', async () => {
    const response = await getResponse(
      { phase: 'exit-qualifying', issueType: null, stepIndex: 0 },
      "I think there might be an outage in my area, my neighbour has the same issue"
    );
    expect(await judge('Does this response suggest the user contact their ISP or check for a service outage?', response)).toBe('yes');
    expect(await judge('Does this response tell the user their problem is not a WiFi issue or is off-topic?', response)).toBe('no');
  });

  // Guards against the qualifying phase giving exit advice directly instead of via exit-qualifying
  itLive('qualifying phase does not give exit advice when ISP outage is suspected', async () => {
    const response = await getResponse(
      { phase: 'qualifying', issueType: null, stepIndex: 0 },
      "both my laptop and phone are down, and my neighbour's WiFi is also out - sounds like the ISP might be having issues"
    );
    expect(await judge('Does this response suggest the user contact their ISP or check for an outage?', response)).toBe('no');
    expect(await judge('Does this response ask at least one follow-up question?', response)).toBe('yes');
  });

  // Partial resolution should close positively, not apologize
  itLive('partial resolution closes conversation positively and suggests ISP for remaining device', async () => {
    const instruction = 'The issue is partially resolved - things are better but not fully fixed. Close the conversation positively. ' + issueRegistry['reboot'].prompts.resolution;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        { role: 'user', content: 'my laptop is working now but my phone still cannot connect' },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response acknowledge progress or partial success?', response)).toBe('yes');
    expect(await judge('Does this response suggest contacting an ISP or technician for the remaining device?', response)).toBe('yes');
    expect(await judge('Does this response describe the reboot as a complete failure or say the troubleshooting did not help at all?', response)).toBe('no');
    expect(await judge('Does this response offer further troubleshooting steps?', response)).toBe('no');
  });

  // Opening turn: bot should greet and ask one general question
  itLive('opening message includes a greeting before asking a question', async () => {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const instruction = buildInstruction({ phase: 'qualifying', issueType: null, stepIndex: 0 });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response include a greeting or welcoming phrase before asking a question?', response)).toBe('yes');
    expect(await judge('Does this response ask only one question?', response)).toBe('yes');
    expect(await judge('Does this response mention rebooting, restarting, router lights, or any specific troubleshooting step?', response)).toBe('no');
  });

  // Guards the case where resolution tells user to contact ISP without saying how,
  // leaving an obvious follow-up question that the closed conversation can't answer.
  itLive('resolution includes ISP contact guidance when issue is not fully resolved', async () => {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const instruction = 'The user has confirmed their issue is fully resolved. ' + issueRegistry['reboot'].prompts.resolution;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        { role: 'user', content: 'looks like its working but netflix is a bit slow' },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response suggest contacting the ISP if the speed issue continues?', response)).toBe('yes');
    expect(await judge('Does this response include guidance on how to contact their ISP, such as mentioning their website, billing statement, or the back of the router?', response)).toBe('yes');
    expect(await judge('Does this response ask a follow-up question?', response)).toBe('no');
  });

  // Guards the bug where stepsComplete was used for the last-step-confirm path (nextState=resolution)
  // and sometimes generated a premature goodbye. That path now uses a simple ask-only prompt.
  itLive('last step confirmed with apparent resolution asks rather than closing immediately', async () => {
    const instruction = `All steps are complete. Ask the user warmly if their WiFi issue is now resolved. Do NOT say goodbye. Do NOT offer further troubleshooting steps.`;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        { role: 'user', content: 'ok i waited, looks like its working now' },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response ask if the issue is resolved or if the WiFi is working?', response)).toBe('yes');
    expect(await judge('Does this response say goodbye or close the conversation?', response)).toBe('no');
  });

  // Guards the resolution question handler redirecting off-topic questions
  itLive('resolution question handler redirects off-topic questions back to the issue', async () => {
    const instruction = `The user has asked a follow-up question. If it is related to their WiFi issue or ISP, answer it briefly and helpfully. If it is off-topic (unrelated to WiFi or internet), do not engage — politely redirect and ask if their issue is now resolved. Do NOT say goodbye. Do NOT close the conversation. Do NOT offer further troubleshooting steps.`;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        { role: 'user', content: 'what are some good sites to look for cats?' },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response recommend pet adoption websites or give advice about finding cats?', response)).toBe('no');
    expect(await judge('Does this response ask if the WiFi issue is now resolved?', response)).toBe('yes');
  });

  // Guards the bug where the last-step instruction declared resolution instead of asking.
  // "its working" is a strong positive signal — the model must still ask, not declare.
  itLive('last step completion asks rather than declares when user says "its working"', async () => {
    const instruction = `The user has just completed the final step. Do NOT declare the issue resolved based on this alone — completing the steps is not the same as confirming the issue is fixed. Always ask them directly: "Is your WiFi issue now resolved?" Do NOT say goodbye. Do NOT offer further troubleshooting steps.`;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        { role: 'user', content: "its working" },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response ask the user if their WiFi issue is resolved?', response)).toBe('yes');
    expect(await judge('Does this response declare the issue resolved without asking (e.g. "I\'m glad it\'s resolved" as a statement rather than a question)?', response)).toBe('no');
    expect(await judge('Does this response say goodbye or close the conversation?', response)).toBe('no');
  });

  // Guards the bug where the resolution close mentioned ISP even for a fully resolved case.
  itLive('resolution close for fully resolved does not mention ISP contact', async () => {
    const issueConfig = issueRegistry['reboot'];
    const instruction = 'The user has confirmed their issue is fully resolved. ' + issueConfig.prompts.resolution;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        { role: 'user', content: "yes its all working great!" },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response say goodbye or close the conversation?', response)).toBe('yes');
    expect(await judge('Does this response mention contacting the ISP or an ISP phone number?', response)).toBe('no');
  });

  // Guards the MAX_QUALIFYING_TURNS close — after too many turns without identifying the issue,
  // the bot should close warmly and suggest the ISP, not cut off abruptly.
  itLive('qualifying turn limit close is warm and suggests ISP', async () => {
    const instruction = `You have asked several qualifying questions but could not identify the issue type. Apologize warmly and let the user know you're unable to continue - suggest they contact their ISP or a technician.`;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        { role: 'user', content: 'i just don\'t know, everything seems normal but nothing is working' },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response apologize or express that it was unable to help?', response)).toBe('yes');
    expect(await judge('Does this response suggest contacting an ISP or technician?', response)).toBe('yes');
    expect(await judge('Does this response ask another diagnostic question?', response)).toBe('no');
  });

  // Guards the abort response — user quits mid-reboot, should get a warm close not a cold one.
  itLive('abort mid-reboot closes warmly without continuing steps', async () => {
    const instruction = issueRegistry['reboot'].prompts.abort;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT INSTRUCTION:\n${instruction}` },
        { role: 'assistant', content: 'Now plug your modem back in and wait about 2 minutes until it is fully online.' },
        { role: 'user', content: 'actually forget it, I don\'t want to do this anymore' },
      ],
    });
    const response = completion.choices[0].message.content ?? '';
    expect(await judge('Does this response acknowledge the user\'s decision to stop?', response)).toBe('yes');
    expect(await judge('Does this response continue with reboot instructions or ask the user to complete any steps?', response)).toBe('no');
    expect(await judge('Does this response say goodbye or close the conversation?', response)).toBe('yes');
  });
});
