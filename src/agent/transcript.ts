import type { ChatMessage, TranscriptItem } from './types.js';

/** Flatten stored messages into static transcript items (used when restoring a session). */
export function messagesToTranscript(messages: ChatMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      items.push({ key: m.id, kind: 'user', message: m });
    } else if (m.role === 'system') {
      items.push({ key: m.id, kind: 'system', message: m });
    } else if (m.parts && m.parts.length > 0) {
      for (const p of m.parts) {
        if (p.type === 'text') items.push({ key: p.id, kind: 'text', messageId: m.id, content: p.content, timestamp: m.timestamp, ...(p.model ? { model: p.model } : {}) });
        else if (p.type === 'thinking') items.push({ key: p.id, kind: 'thinking', messageId: m.id, content: p.content, timestamp: m.timestamp });
        else items.push({ key: p.id, kind: 'tool', messageId: m.id, toolCall: p.toolCall });
      }
    } else if (m.content) {
      items.push({ key: m.id, kind: 'text', messageId: m.id, content: m.content, timestamp: m.timestamp });
    }
  }
  return items;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
}
