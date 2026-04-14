import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useChat } from '../hooks/useChat';
import './Chat.css';

export function Chat() {
  const { messages, isLoading, error, sendMessage, conversationState } = useChat();
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isClosed = conversationState.phase === 'closed';

  const handleSend = () => {
    void sendMessage(input);
    setInput('');
  };

  useEffect(() => {
    if (!isLoading && !isClosed) inputRef.current?.focus();
  }, [isLoading, isClosed]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSend();
  };

  return (
    <div>
      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={`${msg.role}-${i}`} className={`chat-message chat-message--${msg.role}`}>
            <span className={`chat-bubble chat-bubble--${msg.role}`}>
              {msg.role === 'assistant'
                ? <ReactMarkdown>{msg.content}</ReactMarkdown>
                : msg.content
              }
            </span>
          </div>
        ))}
        {isLoading && <p className="chat-status">Thinking...</p>}
        {error && <p className="chat-error">{error}</p>}
        {isClosed && <p className="chat-status chat-status--closed">This conversation has ended.</p>}
      </div>

      <div className="chat-input-row">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isClosed ? 'Conversation ended' : 'Type a message...'}
          disabled={isLoading || isClosed}
          className="chat-input"
        />
        <button
          onClick={handleSend}
          disabled={isLoading || isClosed || !input.trim()}
          className="chat-send-button"
        >
          Send
        </button>
      </div>
    </div>
  );
}
