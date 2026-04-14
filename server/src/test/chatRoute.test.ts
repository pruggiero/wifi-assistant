import { describe, it, expect } from 'vitest';
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
        state: { phase: 'closed', rebootGroupIndex: 0 },
      });

    expect(res.status).toBe(200);
    expect(res.body.message.role).toBe('assistant');
    expect(res.body.message.content).toContain('ended');
    expect(res.body.nextState).toEqual({ phase: 'closed', rebootGroupIndex: 0 });
  });

  it('returns 400 when messages are missing', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ state: { phase: 'closed', rebootGroupIndex: 0 } });

    expect(res.status).toBe(400);
  });
});
