import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';

// These tests exercise real route logic that doesn't require an OpenAI call.
// The closed phase returns a static response, making it straightforward to test without mocking.

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
    vi.spyOn(transitions, 'classifyRebootResponse').mockResolvedValue('unclear');

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
