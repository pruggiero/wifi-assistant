import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// vi.mock is hoisted, so this runs before the app import below
vi.mock('../routes/chat', () => {
  const { Router } = require('express');
  const router = Router();
  router.post('/', (req: { body: { messages?: unknown[] } }, res: { status: (code: number) => { json: (b: unknown) => void }; json: (b: unknown) => void }) => {
    if (!req.body.messages || !Array.isArray(req.body.messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }
    res.json({ message: { role: 'assistant', content: 'mocked response' } });
  });
  return { default: router };
});

import { app } from '../app';

describe('GET /api/health', () => {
  it('returns status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('POST /api/chat', () => {
  it('returns a message object', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ messages: [{ role: 'user', content: 'test' }] });
    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  it('returns 400 when messages are missing', async () => {
    const res = await request(app).post('/api/chat').send({});
    expect(res.status).toBe(400);
  });
});
