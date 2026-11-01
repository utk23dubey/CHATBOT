import React, { useState, useRef, useEffect } from 'react';
import './WhatsAppChat.css';

type ContextMode = 'pdf' | 'document' | 'web' | 'llm';

interface Message {
  id: string;
  text: string;
  sender: 'me' | 'them';
  timestamp: string;
  contextMode?: ContextMode;
}

const CONTEXT_MODE_LABELS: Record<ContextMode, string> = {
  pdf: 'PDF',
  document: 'Uploaded document',
  web: 'Web search',
  llm: 'LLM',
};

function isFetchFailure(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    /failed to fetch|fetch failed|networkerror|load failed/i.test(error.message)
  );
}

const INITIAL_MESSAGES: Message[] = [
  { id: '1', text: 'Hey! Are we still meeting for lunch today?', sender: 'them', timestamp: '11:45 AM' },
  { id: '2', text: 'Yes, definitely. I was thinking about that new Italian place.', sender: 'me', timestamp: '11:47 AM' },
  { id: '3', text: 'Sounds perfect! What time works for you?', sender: 'them', timestamp: '11:48 AM' },
  { id: '4', text: 'Let\'s aim for 1:00 PM. See you there!', sender: 'me', timestamp: '11:50 AM' },
];

const WhatsAppChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [inputText, setInputText] = useState('');
  const [chatError, setChatError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentButtonRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll to the bottom when a new message is added
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!isAttachmentMenuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAttachmentMenuOpen(false);
        attachmentButtonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isAttachmentMenuOpen]);

  const consumeChatStream = async (response: Response, messageId: string) => {
    if (!response.body) {
      throw new Error('Chat response has no readable body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answer = '';

    const handleEvent = (event: string) => {
      const eventName = event.match(/^event:\s*(.+)$/m)?.[1];
      const dataLine = event.match(/^data:\s*(.+)$/m)?.[1];
      if (!dataLine) return;

      const data: unknown = JSON.parse(dataLine);
      if (typeof data !== 'object' || data === null) return;

      if (
        eventName === 'user_message' &&
        'messageId' in data &&
        typeof data.messageId === 'string' &&
        'text' in data &&
        typeof data.text === 'string'
      ) {
        const messageId = data.messageId;
        const sanitizedText = data.text;
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === messageId
              ? { ...message, text: sanitizedText }
              : message,
          ),
        );
      } else if (
        eventName === 'token' &&
        'token' in data &&
        typeof data.token === 'string'
      ) {
        answer += data.token;
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === messageId ? { ...message, text: answer } : message,
          ),
        );
      } else if (
        eventName === 'complete' &&
        'answer' in data &&
        typeof data.answer === 'string'
      ) {
        answer = data.answer;
        const contextMode =
          'contextMode' in data &&
          (data.contextMode === 'pdf' ||
            data.contextMode === 'document' ||
            data.contextMode === 'web' ||
            data.contextMode === 'llm')
            ? data.contextMode
            : undefined;
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === messageId
              ? { ...message, text: answer, contextMode }
              : message,
          ),
        );
      } else if (eventName === 'error' && 'error' in data) {
        throw new Error(
          typeof data.error === 'string' ? data.error : 'Chat request failed',
        );
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      events.forEach(handleEvent);

      if (done) {
        if (buffer.trim()) handleEvent(buffer);
        break;
      }
    }
  };

  const openFilePicker = (accept: string) => {
    if (!fileInputRef.current) return;
    fileInputRef.current.accept = accept;
    setIsAttachmentMenuOpen(false);
    fileInputRef.current.click();
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const uploadMessageId = `upload-${Date.now()}`;
    const updateUploadMessage = (text: string) => {
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === uploadMessageId ? { ...message, text } : message,
        ),
      );
    };

    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !['pdf', 'docx', 'csv', 'xls', 'xlsx'].includes(extension)) {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: uploadMessageId,
          text: 'Choose a PDF, DOCX, CSV, XLS, or XLSX file.',
          sender: 'them',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: uploadMessageId,
          text: 'Files must be 20 MB or smaller.',
          sender: 'them',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      return;
    }

    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: uploadMessageId,
        text: `Uploading ${file.name}...`,
        sender: 'them',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('http://localhost:3000/upload', {
        method: 'POST',
        body: formData,
      });
      const result: unknown = await response.json();

      if (!response.ok) {
        const errorMessage =
          typeof result === 'object' &&
          result !== null &&
          'error' in result &&
          typeof result.error === 'string'
            ? result.error
            : `File upload failed (${response.status})`;
        throw new Error(errorMessage);
      }

      const details =
        typeof result === 'object' && result !== null
          ? result
          : {};
      const pages =
        'pages' in details && typeof details.pages === 'number'
          ? ` (${details.pages} pages)`
          : '';
      updateUploadMessage(`Uploaded ${file.name}${pages}.`);
    } catch (error) {
      console.error('Failed to upload document:', error);
      updateUploadMessage(
        error instanceof Error ? error.message : 'Unable to upload file.',
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = inputText.trim();
    if (!query || isSending) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      text: query,
      sender: 'me',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const botMessage: Message = {
      id: `${Date.now()}-bot`,
      text: '',
      sender: 'them',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((currentMessages) => [...currentMessages, newMessage, botMessage]);
    setChatError('');
    setInputText('');
    setIsSending(true);

    try {
      const response = await fetch('http://localhost:3000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          threadId: 'user-chat-1',
          model: 'ollama',
          clientMessageId: newMessage.id,
        }),
      });

      if (!response.ok) {
        throw new Error(`Chat request failed (${response.status})`);
      }
      await consumeChatStream(response, botMessage.id);
    } catch (error) {
      console.error('Failed to send chat message:', error);
      setMessages((currentMessages) =>
        currentMessages.filter(
          (message) =>
            message.id !== newMessage.id && message.id !== botMessage.id,
        ),
      );
      setChatError(
        isFetchFailure(error)
          ? 'Unable to connect to the chat service. Please try again in a moment.'
          : error instanceof Error
            ? error.message
            : 'Unable to send message.',
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="chat-container">
      {/* Header */}
      <header className="chat-header">
        <div className="avatar">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="#dfe5e7">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
          </svg>
        </div>
        <div className="contact-info">
          <h2>John Doe</h2>
          <span>online</span>
        </div>
      </header>

      {/* Message Area */}
      <main className="chat-body">
        {chatError && (
          <div className="chat-error-alert" role="alert">
            <span className="message-alert">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 2.8 19a1.4 1.4 0 0 0 1.2 2.1h16a1.4 1.4 0 0 0 1.2-2.1L12 3Z" />
                <path d="M12 9v5m0 3h.01" />
              </svg>
              <span className="message-text">{chatError}</span>
            </span>
          </div>
        )}
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`message-wrapper ${msg.sender === 'me' ? 'wrapper-me' : 'wrapper-them'}`}
          >
            <div className={`message-bubble ${msg.sender === 'me' ? 'message-me' : 'message-them'}`}>
              {isSending && msg.sender === 'them' && !msg.text ? (
                <span className="typing-indicator" role="status" aria-label="Assistant is typing">
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                <span className="message-text">{msg.text}</span>
              )}
              {msg.contextMode && (
                <span className="context-mode">
                  Context: {CONTEXT_MODE_LABELS[msg.contextMode]}
                </span>
              )}
              <span className="timestamp">{msg.timestamp}</span>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Area */}
      <footer className="chat-footer">
        <form onSubmit={handleSendMessage} className="input-form">
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            onChange={handleDocumentUpload}
            aria-label="Upload a document"
          />
          <button
            ref={attachmentButtonRef}
            type="button"
            className="attach-button"
            aria-label="Attach a document"
            title="Attach a document"
            disabled={isUploading}
            aria-expanded={isAttachmentMenuOpen}
            aria-haspopup="dialog"
            onClick={() => setIsAttachmentMenuOpen((isOpen) => !isOpen)}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
              <path d="M16.5 6.5 7.41 15.59a2 2 0 0 0 2.83 2.82l9.19-9.19a4 4 0 0 0-5.66-5.65l-9.9 9.9a6 6 0 0 0 8.49 8.48l8.49-8.48-1.42-1.42-8.49 8.49a4 4 0 0 1-5.66-5.66l9.9-9.9a2 2 0 0 1 2.83 2.83l-9.19 9.19a0 0 0 0 1-1.41-1.41l9.09-9.09z" />
            </svg>
          </button>
          <input
            type="text"
            className="chat-input"
            placeholder="Type a message"
            value={inputText}
            disabled={isSending}
            onChange={(e) => setInputText(e.target.value)}
          />
          <button type="submit" className="send-button" disabled={!inputText.trim() || isSending}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </form>
      </footer>
      {isAttachmentMenuOpen && (
        <div
          className="attachment-modal-backdrop"
          onClick={() => setIsAttachmentMenuOpen(false)}
        >
          <section
            className="attachment-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attachment-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="attachment-modal-header">
              <div>
                <h2 id="attachment-modal-title">Attach a document</h2>
                <p>Choose a file type to upload</p>
              </div>
              <button
                type="button"
                className="attachment-modal-close"
                aria-label="Close attachment menu"
                onClick={() => setIsAttachmentMenuOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="attachment-options">
              <button type="button" className="attachment-option" onClick={() => openFilePicker('.pdf,application/pdf')}>
                <span className="attachment-option-icon pdf-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M6 2h8l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V8h4.5M7 17h2a1.5 1.5 0 0 0 0-3H7v5m6 0v-5h1.5a2.5 2.5 0 0 1 0 5H13Zm5-5v5m0-5h3m-3 2h2" /></svg>
                </span>
                <span><strong>PDF</strong><small>Portable document</small></span>
              </button>
              <button type="button" className="attachment-option" onClick={() => openFilePicker('.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document')}>
                <span className="attachment-option-icon docx-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M6 2h8l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V8h4.5M7 12l1.2 6 1.3-4 1.3 4 1.2-6m2 0v6h2a2 2 0 0 0 0-4h-2" /></svg>
                </span>
                <span><strong>Word document</strong><small>.docx</small></span>
              </button>
              <button type="button" className="attachment-option" onClick={() => openFilePicker('.csv,text/csv')}>
                <span className="attachment-option-icon csv-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M4 3h16v18H4zM4 8h16M4 13h16M9 8v13m6-13v13" /></svg>
                </span>
                <span><strong>CSV</strong><small>Comma-separated values</small></span>
              </button>
              <button type="button" className="attachment-option" onClick={() => openFilePicker('.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}>
                <span className="attachment-option-icon excel-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M4 3h16v18H4zM4 8h16M4 13h16M9 8v13m6-13v13M6 10l2 3-2 3m4-6v6" /></svg>
                </span>
                <span><strong>Excel sheet</strong><small>.xls, .xlsx</small></span>
              </button>
            </div>
            <p className="attachment-modal-note">Maximum file size: 20 MB</p>
          </section>
        </div>
      )}
    </div>
  );
};

export default WhatsAppChat;