
import React, { useState, useRef, useEffect } from 'react';
import { Message } from '../types';
import { COLORS } from '../constants';

interface ChatWindowProps {
  isOpen: boolean;
  messages: Message[];
  onSendMessage: (text: string) => void;
  isLoading: boolean;
  handbookStatus: 'idle' | 'ingesting' | 'ready';
}

// Fix #3: Strict HTML sanitizer — only <strong> tags are allowed through.
// This prevents any injected HTML from executing while still rendering bold text.
const sanitizeHtml = (html: string): string => {
  return html.replace(/<(?!\/?strong\b)[^>]*>/gi, '');
};

// Converts **bold** markdown to <strong> and sanitizes the result.
const formatBold = (str: string): string => {
  const withBold = str.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  return sanitizeHtml(withBold);
};

// Fix #6: Renders bullet lists, numbered lists, and bold text from AI markdown.
const FormattedText: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');

  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        // Bullet points: "* item" or "- item"
        if (/^\s*[*-] /.test(line)) {
          const content = line.replace(/^\s*[*-] /, '');
          return (
            <div key={i} className="flex gap-2 ml-1">
              <span className="text-[#cf2e2e] flex-shrink-0">•</span>
              <span dangerouslySetInnerHTML={{ __html: formatBold(content) }} />
            </div>
          );
        }

        // Fix #6: Numbered lists: "1. item", "2. item", etc.
        const numberedMatch = line.match(/^\s*(\d+)\.\s+(.*)/);
        if (numberedMatch) {
          const [, num, content] = numberedMatch;
          return (
            <div key={i} className="flex gap-2 ml-1">
              <span className="text-[#cf2e2e] flex-shrink-0 font-semibold">{num}.</span>
              <span dangerouslySetInnerHTML={{ __html: formatBold(content) }} />
            </div>
          );
        }

        // Regular paragraph / heading line
        return (
          <p key={i} className="min-h-[1em]" dangerouslySetInnerHTML={{ __html: formatBold(line) }} />
        );
      })}
    </div>
  );
};

const ChatWindow: React.FC<ChatWindowProps> = ({
  isOpen,
  messages,
  onSendMessage,
  isLoading,
  handbookStatus
}) => {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim());
    setInput('');
  };

  if (!isOpen) return null;

  // Fix #5: Only show typing dots while waiting for the first token.
  // Once streaming begins (content !== ''), the dots disappear and the
  // live text takes over — no overlap.
  const lastMessage = messages[messages.length - 1];
  const showTypingDots =
    isLoading && (lastMessage?.role !== 'bot' || lastMessage?.content === '');

  return (
    <div className="fixed bottom-24 right-6 w-full max-w-[420px] h-[650px] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden z-40 border border-gray-100 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* Header */}
      <div
        style={{ backgroundColor: COLORS.sfcNavy }}
        className="p-4 flex items-center gap-3 text-white shadow-md relative z-10"
      >
        <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center overflow-hidden border-2 border-white/20">
          {/* Terrier mascot icon — no external image dependency */}
          <svg viewBox="0 0 64 64" className="w-8 h-8" xmlns="http://www.w3.org/2000/svg">
            <circle cx="32" cy="32" r="32" fill="#003366"/>
            {/* Ears */}
            <ellipse cx="20" cy="22" rx="7" ry="9" fill="#5a3e2b" transform="rotate(-15 20 22)"/>
            <ellipse cx="44" cy="22" rx="7" ry="9" fill="#5a3e2b" transform="rotate(15 44 22)"/>
            <ellipse cx="20" cy="23" rx="4" ry="6" fill="#8b6347" transform="rotate(-15 20 23)"/>
            <ellipse cx="44" cy="23" rx="4" ry="6" fill="#8b6347" transform="rotate(15 44 23)"/>
            {/* Head */}
            <ellipse cx="32" cy="35" rx="16" ry="14" fill="#8b6347"/>
            {/* Muzzle */}
            <ellipse cx="32" cy="42" rx="9" ry="6" fill="#c49a6c"/>
            {/* Eyes */}
            <circle cx="25" cy="32" r="3" fill="#1a1a1a"/>
            <circle cx="39" cy="32" r="3" fill="#1a1a1a"/>
            <circle cx="26" cy="31" r="1" fill="white"/>
            <circle cx="40" cy="31" r="1" fill="white"/>
            {/* Nose */}
            <ellipse cx="32" cy="39" rx="3.5" ry="2.5" fill="#1a1a1a"/>
            {/* Mouth */}
            <path d="M29 42 Q32 45 35 42" stroke="#1a1a1a" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
          </svg>
        </div>
        <div>
          <h3 className="font-bold text-lg leading-tight">TerrierHelper</h3>
          <p className="text-[10px] opacity-70 flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${handbookStatus === 'ready' ? 'bg-green-400' : 'bg-yellow-400'}`}></span>
            {handbookStatus === 'ready' ? 'System ready' : 'Awaiting documents...'}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[88%] p-3.5 rounded-2xl text-[13.5px] leading-relaxed shadow-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-none'
                  : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'
              }`}
            >
              <FormattedText text={msg.content} />

              {msg.link && (
                <div className="mt-3 pt-2 border-t border-gray-100">
                  <a
                    href={msg.link}
                    className="text-blue-500 hover:text-blue-700 underline font-semibold flex items-center gap-1"
                  >
                    <i className="fa-solid fa-envelope text-xs"></i>
                    Email Support Hub
                  </a>
                </div>
              )}
              {msg.source && (
                <div className="mt-3 text-[10px] uppercase tracking-wider opacity-40 font-black border-t pt-1 border-gray-100 flex items-center gap-1">
                  <i className="fa-solid fa-book-open"></i>
                  Ref: {msg.source}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Fix #5: dots only show before first streaming token arrives */}
        {showTypingDots && (
          <div className="flex justify-start">
            <div className="bg-white p-4 rounded-2xl rounded-tl-none shadow-sm border border-gray-100">
              <div className="flex gap-1.5 items-center">
                <div className="w-1.5 h-1.5 bg-[#cf2e2e] rounded-full animate-bounce"></div>
                <div className="w-1.5 h-1.5 bg-[#cf2e2e] rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1.5 h-1.5 bg-[#cf2e2e] rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 border-t bg-white shadow-[0_-4px_10px_rgba(0,0,0,0.02)]">
        <div className="flex gap-2 bg-gray-100 p-1 rounded-xl focus-within:ring-2 focus-within:ring-[#cf2e2e]/20 transition-all">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={handbookStatus === 'ready' ? 'Type your question...' : 'Waiting for docs...'}
            disabled={handbookStatus !== 'ready' || isLoading}
            className="flex-1 bg-transparent px-3 py-2 text-sm focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || handbookStatus !== 'ready' || isLoading}
            style={{ backgroundColor: COLORS.sfcRed }}
            className="w-10 h-10 rounded-lg text-white flex items-center justify-center transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:grayscale shadow-sm"
          >
            <i className="fa-solid fa-paper-plane text-sm"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatWindow;
