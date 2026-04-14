import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';

// Mock the OpenAI module so route tests that reach the completion call don't need an API key.
// Tests that mock classifyQualifying / classifyStepResponse at the transitions level
// return before the completion call and are not affected by this mock.
vi.mock('openai', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [{ message: { role: 'assistant', content: 'mock assistant response' } }],
  });
  return {
    default: class MockOpenAI {
      chat = { completions: { create: mockCreate } };
    },
  };
});

describe('POST /api/chat - closed phase (no OpenAI call)', () => {
  it('returns a static message and keeps state closed', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({
        messages: [{ role: 'user', content: 'hello?' }],
        state: { phase: 'closed', issueType: null, stepIndex: 0 },
      });

    expect(res.status).toBe(200);
    expect(res.body.message.role).toBe('assistant');
    expect(res.body.message.content).toContain('ended');
    expect(res.body.nextState).toEqual({ phase: 'closed', issueType: null, stepIndex: 0 });
  });

  it('returns 400 when messages are missing', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ state: { phase: 'closed', issueType: null, stepIndex: 0 } });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/chat - unclear classifier response', () => {
  afterEach(() => vi.restoreAllMocks());

  it('closes conversation when qualifying classifier returns unclear', async () => {
    const transitions = await import('../stateEngine/transitions');
    vi.spyOn(transitions, 'classifyQualifying').mockResolvedValue('unclear');

    const res = await request(app)
      .post('/api/chat')
      .send({
        messages: [{ role: 'user', content: 'asdfghjkl' }],
        state: { phase: 'qualifying', issueType: null, stepIndex: 0 },
      });

    expect(res.status).toBe(200);
    expect(res.body.nextState).toEqual({ phase: 'closed', issueType: null, stepIndex: 0 });
    expect(res.body.message.content).toContain('trouble understanding');
  });

  it('closes conversation when reboot classifier returns unclear', async () => {
    const transitions = await import('../stateEngine/transitions');
    vi.spyOn(transitions, 'classifyStepResponse').mockResolvedValue('unclear');

    const res = await request(app)
      .post('/api/chat')
      .send({
        messages: [{ role: 'user', content: 'asdfghjkl' }],
        state: { phase: 'guided-steps', issueType: 'reboot', stepIndex: 0 },
      });

    expect(res.status).toBe(200);
    expect(res.body.nextState).toEqual({ phase: 'closed', issueType: null, stepIndex: 0 });
    expect(res.body.message.content).toContain('trouble understanding');
  });
});

// Guards the bug where confirming the last step jumped straight to closed instead of resolution.
// stepIndex 3 is the last group for the reboot flow (4 groups, 0-indexed).
describe('POST /api/chat - step confirm transitions', () => {
  afterEach(() => vi.restoreAllMocks());

  it('transitions to resolution (not closed) when the last step is confirmed', async () => {
    const transitions = await import('../stateEngine/transitions');
    vi.spyOn(transitions, 'classifyStepResponse').mockResolvedValue('confirm');

    const res = await request(app)
      .post('/api/chat')
      .send({
        messages: [{ role: 'user', content: 'done' }],
        state: { phase: 'guided-steps', issueType: 'reboot', stepIndex: 3 },
      });

    expect(res.status).toBe(200);
    expect(res.body.nextState.phase).toBe('resolution');
  });

  it('advances step index when a mid-flow step is confirmed', async () => {
    const transitions = await import('../stateEngine/transitions');
    vi.spyOn(transitions, 'classifyStepResponse').mockResolvedValue('confirm');

    const res = await request(app)
      .post('/api/chat')
      .send({
        messages: [{ role: 'user', content: 'done' }],
        state: { phase: 'guided-steps', issueType: 'reboot', stepIndex: 0 },
      });

    expect(res.status).toBe(200);
    expect(res.body.nextState).toEqual({ phase: 'guided-steps', issueType: 'reboot', stepIndex: 1 });
  });
});

// Guards the bug where the qualifying conversation said "unplugged" and flow-start skipped step 1.
// The fix is that flow-start strips conversation history before calling the LLM.
describe('POST /api/chat - flow-start state transition', () => {
  afterEach(() => vi.restoreAllMocks());

  it('transitions to guided-steps when qualifying resolves to an issue type', async () => {
    const transitions = await import('../stateEngine/transitions');
    vi.spyOn(transitions, 'classifyQualifying').mockResolvedValue('reboot');

    const res = await request(app)
      .post('/api/chat')
      .send({
        messages: [
          { role: 'assistant', content: 'Is the issue affecting all your devices?' },
          { role: 'user', content: 'yes both my laptop and phone. I already unplugged the router.' },
        ],
        state: { phase: 'qualifying', issueType: null, stepIndex: 0 },
      });

    expect(res.status).toBe(200);
    expect(res.body.nextState).toEqual({ phase: 'guided-steps', issueType: 'reboot', stepIndex: 0 });
  });
});
