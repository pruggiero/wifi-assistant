import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';

// Mock OpenAI so unit tests don't need an API key for the generation call.
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

// Mock the service so unit tests control what processTurn returns without hitting classifiers.
vi.mock('../services/chatService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/chatService')>();
  return { ...actual, processTurn: vi.fn() };
});

import * as chatService from '../services/chatService';

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

// Guards the bug where confirming the last step jumped straight to closed instead of resolution.
// stepIndex 3 is the last group for the reboot flow (4 groups, 0-indexed).
describe('POST /api/chat - step confirm transitions', () => {
  afterEach(() => vi.clearAllMocks());

  it('transitions to resolution (not closed) when the last step is confirmed', async () => {
    vi.mocked(chatService.processTurn).mockResolvedValue({
      instruction: 'ask if resolved',
      nextState: { phase: 'resolution', issueType: 'reboot', stepIndex: 0 },
      stripHistory: false,
    });

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
    vi.mocked(chatService.processTurn).mockResolvedValue({
      instruction: 'present next step',
      nextState: { phase: 'guided-steps', issueType: 'reboot', stepIndex: 1 },
      stripHistory: false,
    });

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
// The fix: processTurn sets stripHistory: true when qualifying resolves so the LLM starts clean.
describe('POST /api/chat - flow-start state transition', () => {
  afterEach(() => vi.clearAllMocks());

  it('transitions to guided-steps when qualifying resolves to an issue type', async () => {
    vi.mocked(chatService.processTurn).mockResolvedValue({
      instruction: 'announce reboot and present step 1',
      nextState: { phase: 'guided-steps', issueType: 'reboot', stepIndex: 0 },
      stripHistory: true,
    });

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
