import { useState } from 'react';
import { useChat } from '../hooks/useChat';
import './Chat.css';

export function Chat() {
  const { messages, isLoading, error, sendMessage } = useChat();
  const [input, setInput] = useState('');

  const handleSend = () => {
    void sendMessage(input);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSend();
  };

  return (
    <div>
      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message--${msg.role}`}>
            <span className={`chat-bubble chat-bubble--${msg.role}`}>
              {msg.content}
            </span>
          </div>
        ))}
        {isLoading && <p className="chat-status">Thinking...</p>}
        {error && <p className="chat-error">{error}</p>}
      </div>

      <div className="chat-input-row">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your WiFi issue..."
          disabled={isLoading}
          className="chat-input"
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          className="chat-send-button"
        >
          Send
        </button>
      </div>
    </div>
  );
}
