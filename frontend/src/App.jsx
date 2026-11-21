import React, { useState, useEffect, useRef } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function generateSessionId() {
  return `s-${Math.random().toString(36).substring(2, 10)}`;
}

export default function App() {
  const [sessionId, setSessionId] = useState(generateSessionId);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [inputMessage, setInputMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [simulateFailure, setSimulateFailure] = useState('');
  const [healthInfo, setHealthInfo] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/health`)
      .then((res) => res.json())
      .then((data) => setHealthInfo(data))
      .catch(() => setHealthInfo({ status: 'offline' }));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleNewChat = () => {
    setSessionId(generateSessionId());
    setMessages([]);
  };

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const trimmed = inputMessage.trim();
    if (!trimmed || isLoading) return;

    setInputMessage('');
    const userMsg = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (simulateFailure) {
        headers['X-Simulate-Failure'] = simulateFailure;
      }

      const res = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          session_id: sessionId,
          message: trimmed,
          ...(systemPrompt.trim() ? { system_prompt: systemPrompt.trim() } : {})
        })
      });

      const data = await res.json();

      if (!res.ok) {
        let errorDetail = 'Unknown error';
        if (typeof data.detail === 'string') {
          errorDetail = data.detail;
        } else if (Array.isArray(data.detail)) {
          errorDetail = data.detail.map((d) => d.msg || JSON.stringify(d)).join(', ');
        } else if (data.detail) {
          errorDetail = JSON.stringify(data.detail);
        }
        setMessages((prev) => [
          ...prev,
          {
            role: 'error',
            content: `Error ${res.status}: ${errorDetail}`
          }
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.reply,
            metadata: data.metadata
          }
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'error',
          content: `Network Error: ${err.message || 'Failed to connect to backend'}`
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-brand">
          <h1>Full-Stack AI Chat</h1>
          <span className="session-tag">Session: {sessionId}</span>
        </div>
        <div className="header-actions">
          {healthInfo && (
            <span className={`health-pill ${healthInfo.status === 'ok' ? 'ok' : 'err'}`}>
              API: {healthInfo.status === 'ok' ? `${healthInfo.keys_configured} keys | Cache ON` : 'offline'}
            </span>
          )}
          <select
            className="sim-select"
            value={simulateFailure}
            onChange={(e) => setSimulateFailure(e.target.value)}
            title="Simulate upstream failure via X-Simulate-Failure"
          >
            <option value="">No Failure Simulation</option>
            <option value="key_1=429">Simulate key_1=429</option>
            <option value="key_1=500">Simulate key_1=500</option>
            <option value="key_1=503">Simulate key_1=503</option>
            <option value="*=429">Simulate *=429 (Total 503)</option>
          </select>
          <button className="new-chat-btn" onClick={handleNewChat}>
            New Chat
          </button>
        </div>
      </header>

      <div className="prompt-bar">
        <label htmlFor="system-prompt">System Prompt:</label>
        <input
          id="system-prompt"
          data-testid="system-prompt-input"
          type="text"
          placeholder="You are a helpful assistant..."
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
      </div>

      <main className="chat-thread">
        {messages.length === 0 && (
          <div className="empty-state">
            <h3>Start a conversation</h3>
            <p>Type a message below to test live inference, caching, and failover.</p>
          </div>
        )}

        {messages.map((msg, index) => {
          if (msg.role === 'user') {
            return (
              <div key={index} className="message-row user-row">
                <div className="message-bubble user-bubble">
                  {msg.content}
                </div>
              </div>
            );
          }

          if (msg.role === 'error') {
            return (
              <div key={index} className="message-row error-row">
                <div className="message-bubble error-bubble">
                  ⚠️ {msg.content}
                </div>
              </div>
            );
          }

          const meta = msg.metadata || {};
          return (
            <div key={index} className="message-row assistant-row">
              <div className="message-bubble assistant-bubble" data-testid="assistant-message">
                <div className="reply-text">{msg.content}</div>
                <div className="metadata-bar">
                  <span
                    className={`meta-badge source-badge ${meta.resolution_source === 'LLM_CACHE' ? 'cache-hit' : 'live'}`}
                    data-testid="meta-source"
                  >
                    {meta.resolution_source}
                  </span>
                  <span className="meta-badge" data-testid="meta-model">
                    {meta.model}
                  </span>
                  <span className="meta-badge" data-testid="meta-latency">
                    {meta.latency_ms} ms
                  </span>
                  <span className="meta-badge" title="Input Tokens">
                    In: <strong data-testid="meta-input-tokens">{meta.input_tokens}</strong>
                  </span>
                  <span className="meta-badge" title="Output Tokens">
                    Out: <strong data-testid="meta-output-tokens">{meta.output_tokens}</strong>
                  </span>
                  {meta.key_id && (
                    <span className="meta-badge key-badge">
                      {meta.key_id} (fallback: {meta.fallback_attempts})
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="message-row assistant-row">
            <div className="message-bubble assistant-bubble loading-bubble">
              <span className="dot-flashing">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      <form className="input-form" onSubmit={handleSendMessage}>
        <textarea
          data-testid="chat-input"
          placeholder="Type your message... (Enter to send, Shift+Enter for newline)"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={isLoading}
        />
        <button
          type="submit"
          data-testid="send-button"
          disabled={isLoading || !inputMessage.trim()}
          className="send-btn"
        >
          {isLoading ? '...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
