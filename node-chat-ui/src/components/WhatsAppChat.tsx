import React, { useState, useRef, useEffect } from 'react';
import './WhatsAppChat.css';

interface Message {
  id: string;
  text: string;
  sender: 'me' | 'them';
  timestamp: string;
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
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to the bottom when a new message is added
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: uploadMessageId,
          text: 'Please select a PDF file.',
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
          text: 'The PDF must be 20 MB or smaller.',
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
            : `PDF upload failed (${response.status})`;
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
      console.error('Failed to upload PDF:', error);
      updateUploadMessage(
        error instanceof Error ? error.message : 'Unable to upload PDF.',
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
    setInputText('');
    setIsSending(true);

    const updateBotMessage = (text: string) => {
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === botMessage.id ? { ...message, text } : message,
        ),
      );
    };

    try {
      const response = await fetch('http://localhost:3000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, threadId: 'user-chat-1', model: 'ollama' }),
      });

      if (!response.ok) {
        throw new Error(`Chat request failed (${response.status})`);
      }
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
          eventName === 'token' &&
          'token' in data &&
          typeof data.token === 'string'
        ) {
          answer += data.token;
          setTimeout(() => {
            updateBotMessage(answer);
          }, 100);
        } else if (
          eventName === 'complete' &&
          'answer' in data &&
          typeof data.answer === 'string'
        ) {
          answer = data.answer;
        //   updateBotMessage(answer);
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
    } catch (error) {
      console.error('Failed to send chat message:', error);
      updateBotMessage(
        error instanceof Error ? error.message : 'Unable to send message.',
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
            accept=".pdf,application/pdf"
            onChange={handlePdfUpload}
            aria-label="Upload a PDF"
          />
          <button
            type="button"
            className="attach-button"
            aria-label="Attach PDF"
            title="Attach PDF"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
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
            onChange={(e) => setInputText(e.target.value)}
          />
          <button type="submit" className="send-button" disabled={!inputText.trim() || isSending}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </form>
      </footer>
    </div>
  );
};

export default WhatsAppChat;