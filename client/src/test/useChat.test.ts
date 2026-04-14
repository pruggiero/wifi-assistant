import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChat } from '../hooks/useChat';

describe('useChat', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('starts with empty messages', () => {
    const { result } = renderHook(() => useChat());
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('adds user message and assistant reply on successful send', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'Hello! How can I help?' } }),
    }));

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.sendMessage('My WiFi is down');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toEqual({ role: 'user', content: 'My WiFi is down' });
    expect(result.current.messages[1]).toEqual({ role: 'assistant', content: 'Hello! How can I help?' });
  });

  it('sets error when request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
    }));

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.sendMessage('My WiFi is down');
    });

    expect(result.current.error).toBe('Server error. Please try again.');
    expect(result.current.messages).toHaveLength(1); // user message still added
  });
});
