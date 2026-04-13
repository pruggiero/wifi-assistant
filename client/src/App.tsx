import { useState } from 'react';

function App() {
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(input);
    setInput('');
  };

  return (
    <div style={{ maxWidth: 600, margin: '60px auto', padding: '0 16px', fontFamily: 'sans-serif' }}>
      <h1>WiFi Assistant</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, marginTop: 24 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe your WiFi issue..."
          style={{ flex: 1, padding: '10px 12px', fontSize: 15, borderRadius: 6, border: '1px solid #ccc' }}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          style={{ padding: '10px 20px', fontSize: 15, borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer' }}
        >
          Send
        </button>
      </form>
      {submitted && (
        <p style={{ marginTop: 20, color: '#374151' }}>
          <strong>You said:</strong> {submitted}
        </p>
      )}
    </div>
  );
}

export default App;
