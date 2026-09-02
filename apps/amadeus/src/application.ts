import { Runner, type Model, type SessionInputCallback } from '@openai/agents';
import type { Database } from 'bun:sqlite';

import type { Activity } from './activity.ts';
import { createAgent, type AmadeusAgent } from './agent.ts';
import { AmadeusRuntime } from './amadeus.ts';
import {
  ConversationArchivedError,
  ConversationNotFoundError,
  type Conversation,
} from './conversation/conversation.ts';
import { contextWindow } from './conversation/context-window.ts';
import { SQLiteConversations } from './conversation/sqlite-conversations.ts';
import { SQLiteSession } from './conversation/sqlite-session.ts';
import { loadIdentity } from './identity.ts';
import type { Signal } from './signal.ts';
import { openDatabase } from './storage/sqlite.ts';
import type { Voice } from './voice/voice.ts';

export interface StartOptions {
  model: Model;
  voice: Voice;
  databasePath: string;
  identityPath: string;
  contextChars: number;
  onActivity?: (activity: Activity) => void | Promise<void>;
}

export interface Amadeus {
  readonly activity: Activity;
  readonly conversation: Conversation;

  turn(text: string): Promise<void>;
  wake(signal: Signal): Promise<void>;
  interrupt(): Promise<void>;

  create(): Promise<Conversation>;
  open(id: string): Promise<Conversation>;
  rename(id: string, title: string): Promise<void>;
  archive(id: string): Promise<void>;
  unarchive(id: string): Promise<void>;
  list(options?: { includeArchived?: boolean }): Promise<Conversation[]>;

  close(): Promise<void>;
}

interface ApplicationOptions {
  database: Database;
  conversations: SQLiteConversations;
  runner: Runner;
  agent: AmadeusAgent;
  voice: Voice;
  sessionInputCallback: SessionInputCallback;
  conversation: Conversation;
  onActivity?: StartOptions['onActivity'];
}

class Application implements Amadeus {
  readonly #database: Database;
  readonly #conversations: SQLiteConversations;
  readonly #runner: Runner;
  readonly #agent: AmadeusAgent;
  readonly #voice: Voice;
  readonly #sessionInputCallback: ReturnType<typeof contextWindow>;
  readonly #onActivity?: StartOptions['onActivity'];

  #conversation: Conversation;
  #runtime: AmadeusRuntime;
  #operations: Promise<void> = Promise.resolve();
  #pendingOperations = 0;
  #closed = false;
  #closing?: Promise<void>;

  constructor(options: ApplicationOptions) {
    this.#database = options.database;
    this.#conversations = options.conversations;
    this.#runner = options.runner;
    this.#agent = options.agent;
    this.#voice = options.voice;
    this.#sessionInputCallback = options.sessionInputCallback;
    this.#onActivity = options.onActivity;
    this.#conversation = options.conversation;
    this.#runtime = this.#createRuntime(options.conversation.id);
  }

  get activity(): Activity {
    return this.#runtime.activity;
  }

  get conversation(): Conversation {
    return this.#conversation;
  }

  turn(text: string): Promise<void> {
    this.#assertOpen();
    if (this.#pendingOperations > 0) {
      return Promise.reject(new Error('Conversation operation in progress.'));
    }
    return this.#runtime.turn(text);
  }

  wake(signal: Signal): Promise<void> {
    this.#assertOpen();
    if (this.#pendingOperations > 0) {
      return Promise.resolve();
    }
    return this.#runtime.wake(signal);
  }

  interrupt(): Promise<void> {
    this.#assertOpen();
    return this.#runtime.interrupt();
  }

  create(): Promise<Conversation> {
    return this.#enqueue(async () => {
      await this.#runtime.interrupt();
      const conversation = await this.#conversations.create();
      this.#replaceConversation(conversation);
      return conversation;
    });
  }

  open(id: string): Promise<Conversation> {
    return this.#enqueue(async () => {
      if (id === this.#conversation.id) {
        return this.#conversation;
      }

      const conversation = await this.#conversations.get(id);
      if (!conversation) {
        throw new ConversationNotFoundError(id);
      }
      if (conversation.archivedAt !== undefined) {
        throw new ConversationArchivedError(id);
      }

      await this.#runtime.interrupt();
      this.#replaceConversation(conversation);
      return conversation;
    });
  }

  rename(id: string, title: string): Promise<void> {
    return this.#enqueue(async () => {
      await this.#conversations.rename(id, title);
      if (id === this.#conversation.id) {
        this.#conversation = (await this.#conversations.get(id))!;
      }
    });
  }

  archive(id: string): Promise<void> {
    return this.#enqueue(async () => {
      if (id !== this.#conversation.id) {
        await this.#conversations.archive(id);
        return;
      }

      await this.#runtime.interrupt();
      await this.#conversations.archive(id);
      const conversation = await this.#conversations.create();
      this.#replaceConversation(conversation);
    });
  }

  unarchive(id: string): Promise<void> {
    return this.#enqueue(async () => {
      await this.#conversations.unarchive(id);
      if (id === this.#conversation.id) {
        this.#conversation = (await this.#conversations.get(id))!;
      }
    });
  }

  async list(
    options: { includeArchived?: boolean } = {},
  ): Promise<Conversation[]> {
    this.#assertOpen();
    await this.#operations;
    this.#assertOpen();
    return await this.#conversations.list(options);
  }

  close(): Promise<void> {
    if (this.#closing) {
      return this.#closing;
    }

    this.#closed = true;
    this.#closing = this.#operations.then(async () => {
      await this.#runtime.interrupt();
      this.#database.close();
    });
    return this.#closing;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.#assertOpen();
    this.#pendingOperations += 1;
    const result = this.#operations.then(() => {
      this.#assertOpen();
      return operation();
    });
    this.#operations = result.then(
      () => {
        this.#pendingOperations -= 1;
      },
      () => {
        this.#pendingOperations -= 1;
      },
    );
    return result;
  }

  #replaceConversation(conversation: Conversation): void {
    this.#conversation = conversation;
    this.#runtime = this.#createRuntime(conversation.id);
  }

  #createRuntime(id: string): AmadeusRuntime {
    return new AmadeusRuntime({
      runner: this.#runner,
      agent: this.#agent,
      context: { voice: this.#voice },
      session: new SQLiteSession(this.#database, id),
      sessionInputCallback: this.#sessionInputCallback,
      onActivity: this.#onActivity,
    });
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error('Amadeus is closed.');
    }
  }
}

export async function start(options: StartOptions): Promise<Amadeus> {
  const sessionInputCallback = contextWindow(options.contextChars);
  const identity = await loadIdentity(options.identityPath);
  const database = openDatabase(options.databasePath);

  try {
    const conversations = new SQLiteConversations(database);
    const conversation =
      (await conversations.latest()) ?? (await conversations.create());
    const runner = new Runner({ tracingDisabled: true });
    const agent = createAgent({
      model: options.model,
      identity,
    });

    return new Application({
      database,
      conversations,
      runner,
      agent,
      voice: options.voice,
      sessionInputCallback,
      conversation,
      onActivity: options.onActivity,
    });
  } catch (error) {
    database.close();
    throw error;
  }
}
