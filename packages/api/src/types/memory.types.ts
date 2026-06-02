import type { Domain } from './mentor.types';

export interface ShortTermMessage {
  role: 'user' | 'assistant';
  text: string;
  intent: string | null;
  emotion: string | null;
  timestamp: Date;
}

export interface MemoryFact {
  id: string;
  type: string;
  key: string;
  value: string;
  confidence: number;
  ageHours: number;
  sourceMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LongTermMemory {
  goals: string[];
  struggles: string[];
  anchors: string[];
  preferences: string[];
  achievements: string[];
  knownPatterns: string[];
  domains: Domain[];
  gym: string | null;
  creatureName: string | null;
  aspirationWords: string[];
  accountabilityStyle: string | null;
}

export interface MemoryContext {
  shortTerm: ShortTermMessage[];
  longTerm: LongTermMemory;
  relevantFacts: MemoryFact[];
  sessionCount: number;
  daysSinceFirstMessage: number;
  lastUserMessage: string | null;
  lastTopicDiscussed: string | null;
  lastAssistantMessage: string | null;
}

export interface MemoryWriteInput {
  platformChatId: string;
  userText: string;
  assistantText: string;
  intent: string;
  emotion: string;
  extractedFacts?: Array<{
    type: string;
    key: string;
    value: string;
    confidence?: number;
  }>;
}
