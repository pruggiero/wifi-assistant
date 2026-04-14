import { useState } from 'react';
import { Message } from '../types';

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const updated: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(updated);
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updated }),
      });

      if (!res.ok) throw new Error('Server error. Please try again.');

      const data = await res.json() as { message: { content: string } };
      setMessages([...updated, { role: 'assistant', content: data.message.content }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsLoading(false);
    }
  };

  return { messages, isLoading, error, sendMessage };
}
