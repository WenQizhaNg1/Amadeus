export interface Conversation {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

export class ConversationNotFoundError extends Error {
  constructor(id: string) {
    super(`Conversation not found: ${id}`);
    this.name = 'ConversationNotFoundError';
  }
}

export class ConversationArchivedError extends Error {
  constructor(id: string) {
    super(`Conversation is archived: ${id}`);
    this.name = 'ConversationArchivedError';
  }
}
