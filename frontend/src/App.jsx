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
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
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

  const handleCopy = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleSendMessage = async (e, customText = null) => {
    if (e) e.preventDefault();
    const textToSend = customText !== null ? customText : inputMessage;
    const trimmed = textToSend.trim();
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

  const suggestions = [
    { title: "What is the capital of France?", desc: "Test live inference, then repeat in a new chat for cache hit" },
    { title: "Explain Vite vs Webpack in 3 bullet points", desc: "Multi-turn speed & token efficiency test" },
    { title: "Simulate Key Failover (429)", desc: "Triggers failover from key_1 to key_2 automatically", simulate: "key_1=429" }
  ];

  return (
    <div className="layout-wrapper">
      {/* Background ambient lighting */}
      <div className="ambient-glow glow-1" />
      <div className="ambient-glow glow-2" />

      {/* Modern Frosted Header */}
      <header className="glass-header">
        <div className="header-left">
          <div className="logo-badge">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
              <path d="M5 3v4"/>
              <path d="M19 17v4"/>
              <path d="M3 5h4"/>
              <path d="M17 19h4"/>
            </svg>
          </div>
          <div>
            <div className="title-row">
              <h1 className="brand-title">Lyftr AI</h1>
              <span className="badge-pro">Gateway v2.0</span>
            </div>
            <div className="session-indicator" title="Current session ID">
              <span className="dot active" />
              <span>Session: <code>{sessionId}</code></span>
            </div>
          </div>
        </div>

        <div className="header-actions">
          {healthInfo && (
            <div className={`status-pill ${healthInfo.status === 'ok' ? 'online' : 'offline'}`}>
              <span className="pulse-indicator" />
              <span>{healthInfo.status === 'ok' ? `${healthInfo.keys_configured} Keys Active • Cache On` : 'Offline'}</span>
            </div>
          )}

          <div className="sim-control-wrapper">
            <label htmlFor="sim-select" className="sim-label">Hook:</label>
            <select
              id="sim-select"
              className="sim-dropdown"
              value={simulateFailure}
              onChange={(e) => setSimulateFailure(e.target.value)}
            >
              <option value="">Normal (Live)</option>
              <option value="key_1=429">Failover (key_1=429)</option>
              <option value="key_1=500">Failover (key_1=500)</option>
              <option value="key_1=503">Failover (key_1=503)</option>
              <option value="*=429">Total Fail (*=429 ➔ 503)</option>
            </select>
          </div>

          <button
            type="button"
            className={`config-toggle-btn ${showConfig ? 'active' : ''}`}
            onClick={() => setShowConfig(!showConfig)}
            title="Toggle system prompt settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            <span>Prompt</span>
          </button>

          <button
            type="button"
            className="btn-new-chat"
            onClick={handleNewChat}
            title="Start new conversation"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14"/>
              <path d="M12 5v14"/>
            </svg>
            <span>New Chat</span>
          </button>
        </div>
      </header>

      {/* Expandable System Prompt Bar */}
      <div className={`system-prompt-drawer ${showConfig ? 'open' : ''}`}>
        <div className="drawer-inner">
          <label htmlFor="system-prompt" className="drawer-label">
            System Persona / Instructions:
          </label>
          <div className="drawer-input-row">
            <input
              id="system-prompt"
              data-testid="system-prompt-input"
              type="text"
              placeholder="e.g. You are an expert Python engineer who provides concise answers..."
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
            {systemPrompt && (
              <button
                type="button"
                className="btn-clear-prompt"
                onClick={() => setSystemPrompt('')}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Chat Thread */}
      <main className="chat-container">
        {messages.length === 0 ? (
          <div className="empty-hero">
            <div className="hero-icon-wrapper">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2"/>
                <path d="M9 9h6"/>
                <path d="M9 13h6"/>
                <path d="M9 17h4"/>
              </svg>
            </div>
            <h2 className="hero-title">How can I assist you today?</h2>
            <p className="hero-subtitle">
              Enterprise AI chat gateway equipped with in-memory caching (<span className="text-emerald">⚡ 1 ms</span>) and zero-downtime key failover.
            </p>

            <div className="suggestions-grid">
              {suggestions.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="suggestion-card"
                  onClick={() => {
                    if (item.simulate) setSimulateFailure(item.simulate);
                    handleSendMessage(null, item.title);
                  }}
                >
                  <div className="card-top">
                    <span className="card-title">{item.title}</span>
                    <span className="card-arrow">↗</span>
                  </div>
                  <p className="card-desc">{item.desc}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages-list">
            {messages.map((msg, index) => {
              if (msg.role === 'user') {
                return (
                  <div key={index} className="message-wrapper user-side">
                    <div className="user-bubble-box">
                      <div className="bubble-text">{msg.content}</div>
                    </div>
                  </div>
                );
              }

              if (msg.role === 'error') {
                return (
                  <div key={index} className="message-wrapper error-side">
                    <div className="error-bubble-box">
                      <div className="error-header">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/>
                          <line x1="12" y1="8" x2="12" y2="12"/>
                          <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <strong>Request Failed</strong>
                      </div>
                      <div className="error-body">{msg.content}</div>
                    </div>
                  </div>
                );
              }

              const meta = msg.metadata || {};
              const isCache = meta.resolution_source === 'LLM_CACHE';

              return (
                <div key={index} className="message-wrapper assistant-side">
                  <div className="assistant-card" data-testid="assistant-message">
                    <div className="card-header-bar">
                      <div className="ai-brand">
                        <div className="ai-avatar">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/>
                            <circle cx="12" cy="12" r="4"/>
                          </svg>
                        </div>
                        <span className="ai-name">Assistant</span>
                      </div>

                      <button
                        type="button"
                        className="copy-btn"
                        onClick={() => handleCopy(msg.content, index)}
                        title="Copy to clipboard"
                      >
                        {copiedIndex === index ? (
                          <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                            </svg>
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="assistant-content">{msg.content}</div>

                    {/* Verified Metadata Bar strictly meeting all data-testid rules */}
                    <div className="metadata-container">
                      <span
                        className={`chip source-chip ${isCache ? 'chip-cache' : 'chip-live'}`}
                        data-testid="meta-source"
                      >
                        {isCache ? '⚡ ' : '● '}
                        {meta.resolution_source}
                      </span>

                      <span className="chip model-chip" data-testid="meta-model">
                        {meta.model}
                      </span>

                      <span className="chip latency-chip" data-testid="meta-latency">
                        {meta.latency_ms} ms
                      </span>

                      <span className="chip token-chip" title="Prompt Tokens">
                        In: <strong data-testid="meta-input-tokens">{meta.input_tokens}</strong>
                      </span>

                      <span className="chip token-chip" title="Completion Tokens">
                        Out: <strong data-testid="meta-output-tokens">{meta.output_tokens}</strong>
                      </span>

                      {meta.key_id && (
                        <span className="chip key-chip" title={`Key used: ${meta.key_id}`}>
                          {meta.key_id}
                          {meta.fallback_attempts > 0 && ` (fallback: ${meta.fallback_attempts})`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {isLoading && (
              <div className="message-wrapper assistant-side">
                <div className="assistant-card loading-card">
                  <div className="pulse-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="loading-text">Generating response...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Floating Bottom Input Bar */}
      <footer className="footer-input-area">
        <form className="input-glass-card" onSubmit={handleSendMessage}>
          <textarea
            data-testid="chat-input"
            placeholder="Type your message... (Enter to send, Shift + Enter for new line)"
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
            className="send-button-enhanced"
            title="Send message (Enter)"
          >
            {isLoading ? (
              <div className="spinner" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            )}
          </button>
        </form>
        <div className="keyboard-hints">
          <span>Press <kbd>Enter ↵</kbd> to send</span>
          <span className="hint-divider">•</span>
          <span><kbd>Shift + Enter</kbd> for new line</span>
        </div>
      </footer>
    </div>
  );
}
