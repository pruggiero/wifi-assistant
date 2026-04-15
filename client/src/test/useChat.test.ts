import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChat } from '../hooks/useChat';

const GREETING_RESPONSE = {
  ok: true,
  json: async () => ({
    message: { content: 'Hi there! Can you describe what\'s happening with your WiFi?' },
    nextState: { phase: 'qualifying', issueType: null, stepIndex: 0 },
  }),
};

describe('useChat', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('fetches bot greeting on mount and starts in qualifying state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(GREETING_RESPONSE));

    const { result } = renderHook(() => useChat());

    await act(async () => {});

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe('assistant');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.conversationState).toEqual({ phase: 'qualifying', issueType: null, stepIndex: 0 });
  });

  it('adds user message and assistant reply, and updates state on successful send', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(GREETING_RESPONSE)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'Hello! How can I help?' },
          nextState: { phase: 'guided-steps', issueType: 'reboot', stepIndex: 0 },
        }),
      })
    );

    const { result } = renderHook(() => useChat());

    await act(async () => {}); // wait for greeting

    await act(async () => {
      await result.current.sendMessage('My WiFi is down');
    });

    expect(result.current.messages).toHaveLength(3); // greeting + user + assistant
    expect(result.current.messages[1]).toMatchObject({ role: 'user', content: 'My WiFi is down' });
    expect(result.current.messages[2]).toMatchObject({ role: 'assistant', content: 'Hello! How can I help?' });
    expect(result.current.conversationState).toEqual({ phase: 'guided-steps', issueType: 'reboot', stepIndex: 0 });
  });

  it('sets error when request fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(GREETING_RESPONSE)
      .mockResolvedValueOnce({ ok: false })
    );

    const { result } = renderHook(() => useChat());

    await act(async () => {}); // wait for greeting

    await act(async () => {
      await result.current.sendMessage('My WiFi is down');
    });

    expect(result.current.error).toBe('Server error. Please try again.');
    expect(result.current.messages).toHaveLength(1); // user message reverted, greeting remains
  });
});
