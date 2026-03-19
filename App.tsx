
import React, { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import ChatBubble from './components/ChatBubble';
import ChatWindow from './components/ChatWindow';
import { Message, DocumentFile } from './types';
import { COLORS } from './constants';
import { uploadDocuments, askGeminiStream } from './services/geminiService';

const App: React.FC = () => {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'bot',
      content: "Hello! I am TerrierHelper. You can upload multiple SFC documents (like 'The Cord', syllabi, or campus maps), and I'll help you with any questions about them.",
      timestamp: new Date()
    }
  ]);
  const [documents, setDocuments] = useState<DocumentFile[]>([]);
  // Fix #4: sessionId points to server-side doc store — base64 sent once on
  // upload, not re-transmitted with every chat message.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadState, setUploadState] = useState<'idle' | 'ingesting' | 'ready'>('idle');

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploadState('ingesting');

    const newDocs: DocumentFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });
      newDocs.push({ name: file.name, base64, mimeType: file.type || 'application/pdf' });
    }

    const allDocs = [...documents, ...newDocs];
    try {
      const sid = await uploadDocuments(allDocs);
      setSessionId(sid);
      setDocuments(allDocs);
      setUploadState('ready');

      const fileNames = newDocs.map(d => d.name).join(', ');
      setMessages(prev => [...prev, {
        id: uuidv4(),
        role: 'bot',
        content: `I've successfully ingested: **${fileNames}**. You can now ask questions about these documents.`,
        timestamp: new Date()
      }]);
    } catch {
      setUploadState(documents.length > 0 ? 'ready' : 'idle');
      setMessages(prev => [...prev, {
        id: uuidv4(),
        role: 'bot',
        content: 'Sorry, there was an error uploading the documents. Please try again.',
        timestamp: new Date()
      }]);
    }
    event.target.value = '';
  }, [documents]);

  // Fix #7: useCallback restored
  const removeDocument = useCallback((index: number) => {
    setDocuments(prev => {
      const updated = prev.filter((_, i) => i !== index);
      if (updated.length === 0) {
        setUploadState('idle');
        setSessionId(null);
      } else {
        setUploadState('ingesting');
        uploadDocuments(updated)
          .then(sid => { setSessionId(sid); setUploadState('ready'); })
          .catch(() => setUploadState('ready'));
      }
      return updated;
    });
  }, []);

  const handleSendMessage = useCallback(async (text: string) => {
    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content: text,
      timestamp: new Date()
    };

    const historyToSend = [...messages];
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    const botMessageId = uuidv4();
    setMessages(prev => [...prev, {
      id: botMessageId,
      role: 'bot',
      content: '',
      timestamp: new Date(),
      source: documents.length > 0 ? `${documents.length} Doc(s)` : undefined,
    }]);

    try {
      // Fix #1: no API key here — lives only in server.ts
      const stream = askGeminiStream(text, historyToSend, sessionId);

      let fullContent = '';
      for await (const chunk of stream) {
        fullContent += chunk;
        setMessages(prev => prev.map(msg =>
          msg.id === botMessageId ? { ...msg, content: fullContent } : msg
        ));
      }

      if (fullContent.toLowerCase().includes('cannot find') || fullContent.toLowerCase().includes("don't see")) {
        setMessages(prev => prev.map(msg =>
          msg.id === botMessageId ? { ...msg, link: 'mailto:thehub@sfc.edu' } : msg
        ));
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Connection failed.';
      setMessages(prev => prev.map(msg =>
        msg.id === botMessageId ? { ...msg, content: `Error: ${message}` } : msg
      ));
    } finally {
      setIsLoading(false);
    }
  }, [messages, documents, sessionId]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 md:p-12 relative overflow-hidden">
      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full opacity-10 pointer-events-none" style={{ backgroundColor: COLORS.sfcRed }}></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[30%] h-[30%] rounded-full opacity-5 pointer-events-none" style={{ backgroundColor: COLORS.sfcNavy }}></div>

      <main className="w-full max-w-5xl bg-white rounded-3xl shadow-xl overflow-hidden flex flex-col md:flex-row relative z-10 border border-gray-100">
        <div className="md:w-1/3 p-8 flex flex-col justify-between text-white" style={{ backgroundColor: COLORS.sfcNavy }}>
          <div>
            <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-6 shadow-lg rotate-3 transition-transform hover:rotate-0">
              <span className="text-2xl font-black" style={{ color: COLORS.sfcRed }}>SFC</span>
            </div>
            <h1 className="text-3xl font-bold mb-4 tracking-tight">TerrierHelper</h1>
            <p className="text-sm opacity-80 leading-relaxed font-light">
              The intelligent student portal for St. Francis College.
              Powered by advanced AI to navigate handbooks and academic policies in real-time.
            </p>
          </div>
          <div className="mt-8">
            <div className="text-[10px] uppercase tracking-widest opacity-40 mb-3 font-black">Official Resources</div>
            <ul className="space-y-3 text-sm">
              <li><a href="https://www.sfc.edu" className="flex items-center gap-2 hover:translate-x-1 transition-transform opacity-70 hover:opacity-100"><i className="fa-solid fa-globe w-4"></i> sfc.edu</a></li>
              <li><a href="#" className="flex items-center gap-2 hover:translate-x-1 transition-transform opacity-70 hover:opacity-100"><i className="fa-solid fa-user-graduate w-4"></i> MySFC Portal</a></li>
              <li><a href="#" className="flex items-center gap-2 hover:translate-x-1 transition-transform opacity-70 hover:opacity-100"><i className="fa-solid fa-calendar-days w-4"></i> Academic Calendar</a></li>
              <li>
                <a href="/api/download-source" className="flex items-center gap-2 hover:translate-x-1 transition-transform opacity-70 hover:opacity-100 mt-4 text-green-300">
                  <i className="fa-solid fa-download w-4"></i> Download Source Code
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="md:w-2/3 p-8 bg-gray-50 flex flex-col">
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 bg-gray-200/50 rounded-3xl flex items-center justify-center mb-6 border border-gray-200">
              <i className="fa-solid fa-file-shield text-3xl text-gray-400"></i>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Policy Ingestion</h2>
            <p className="text-gray-500 mb-8 max-w-md text-sm">
              Upload PDF files to initialize TerrierHelper's knowledge base. Multiple files are supported.
            </p>

            <div className="w-full max-w-md bg-white p-6 rounded-2xl shadow-sm border border-gray-200 relative group">
              <div className="absolute -top-3 right-6 px-3 py-1 bg-[#cf2e2e] text-white text-[10px] font-black rounded-full uppercase tracking-wider">
                v2.0 Native Stream
              </div>
              <label className="block text-xs font-bold text-gray-400 mb-4 text-left uppercase tracking-tighter">
                Active Knowledge Objects ({documents.length})
              </label>
              <div className="relative group mb-4">
                <input
                  type="file"
                  accept="application/pdf"
                  multiple
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="p-6 border-2 border-dashed rounded-xl flex flex-col items-center gap-3 transition-all border-gray-200 group-hover:border-[#cf2e2e] bg-gray-50/50 group-hover:bg-[#ffeded] group-hover:shadow-inner">
                  {uploadState === 'ingesting' ? (
                    <i className="fa-solid fa-circle-notch fa-spin text-2xl text-[#cf2e2e]"></i>
                  ) : (
                    <i className="fa-solid fa-plus text-2xl text-gray-300 group-hover:text-[#cf2e2e]"></i>
                  )}
                  <span className="text-xs font-bold text-gray-500 group-hover:text-[#cf2e2e]">
                    Click to add Handbook or Syllabus
                  </span>
                </div>
              </div>
              <div className="space-y-2 max-h-[180px] overflow-y-auto pr-2">
                {documents.map((doc, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-100 hover:border-[#cf2e2e]/30 transition-colors">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-8 h-8 rounded bg-red-100 flex items-center justify-center text-[#cf2e2e] text-xs font-bold">PDF</div>
                      <span className="text-xs truncate text-gray-700 font-semibold">{doc.name}</span>
                    </div>
                    <button onClick={() => removeDocument(idx)} className="w-6 h-6 rounded flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all">
                      <i className="fa-solid fa-xmark text-xs"></i>
                    </button>
                  </div>
                ))}
                {documents.length === 0 && (
                  <div className="py-6 border border-dashed rounded-lg border-gray-100 text-center">
                    <p className="text-[11px] text-gray-400 font-medium italic">Ready for document upload</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-8 pt-8 border-t flex items-center justify-between text-[10px] text-gray-400 font-bold uppercase tracking-widest">
            <span>St. Francis College TerrierHelper</span>
            <span className="flex items-center gap-2">
              <i className="fa-solid fa-lock text-green-500/50"></i>
              Private Session
            </span>
          </div>
        </div>
      </main>

      <ChatWindow
        isOpen={isChatOpen}
        messages={messages}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
        handbookStatus={uploadState === 'ready' ? 'ready' : 'idle'}
      />
      <ChatBubble onClick={() => setIsChatOpen(!isChatOpen)} isOpen={isChatOpen} />
    </div>
  );
};

export default App;
