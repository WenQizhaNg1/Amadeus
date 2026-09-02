export type MemoryKind = 'fact' | 'episode' | 'relationship';

export interface MemoryItem {
  id: string;
  text: string;
  kind: MemoryKind;
  importance: number;
  createdAt: number;
}

export type NewMemoryItem = Omit<MemoryItem, 'id' | 'createdAt'>;

/** Long-term continuity, independent from Agents SDK conversation history. */
export interface Memory {
  recall(query: string, limit?: number): Promise<MemoryItem[]>;
  remember(item: NewMemoryItem): Promise<MemoryItem>;
  forget(id: string): Promise<void>;
}
