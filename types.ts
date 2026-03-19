
export type Role = 'user' | 'bot' | 'system';

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: Date;
  source?: string;
  link?: string;
}

export interface DocumentFile {
  name: string;
  base64: string;
  mimeType: string;
}
