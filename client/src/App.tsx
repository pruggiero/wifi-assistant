import { Chat } from './components/Chat';
import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
  return (
    <div style={{ maxWidth: 600, margin: '60px auto', padding: '0 16px', fontFamily: 'sans-serif' }}>
      <h1>WiFi Assistant</h1>
      <ErrorBoundary>
        <Chat />
      </ErrorBoundary>
    </div>
  );
}

export default App;

