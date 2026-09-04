import { resolve, sep } from 'node:path';

import type { StageGateway, StageSocket } from './stage-gateway.ts';

export interface StageServerOptions {
  gateway: StageGateway;
  hostname: string;
  port: number;
  staticRoot: string;
}

export interface StageServer {
  readonly hostname: string;
  readonly port: number;
  stop(): Promise<void>;
}

export interface ServerWebSocketPort {
  sendText(message: string): number;
  sendBinary(frame: Uint8Array): number;
  close(code?: number, reason?: string): void;
}

export class BufferedStageSocket implements StageSocket {
  readonly #socket: ServerWebSocketPort;
  readonly #pending = new Set<{
    resolve(): void;
    reject(error: Error): void;
  }>();

  #closed = false;

  constructor(socket: ServerWebSocketPort) {
    this.#socket = socket;
  }

  sendText(message: string): void | Promise<void> {
    return this.#sent(this.#socket.sendText(message));
  }

  sendBinary(frame: Uint8Array): void | Promise<void> {
    return this.#sent(this.#socket.sendBinary(frame));
  }

  close(code: number, reason: string): void {
    this.#socket.close(code, reason);
  }

  drain(): void {
    for (const pending of this.#pending) {
      pending.resolve();
    }
    this.#pending.clear();
  }

  closed(): void {
    this.#closed = true;
    const error = new Error('Stage WebSocket closed during backpressure.');
    for (const pending of this.#pending) {
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #sent(status: number): void | Promise<void> {
    if (status > 0) {
      return;
    }
    if (status === 0 || this.#closed) {
      throw new Error('Stage WebSocket dropped an outgoing message.');
    }
    return new Promise<void>((resolvePromise, rejectPromise) => {
      this.#pending.add({
        resolve: resolvePromise,
        reject: rejectPromise,
      });
    });
  }
}

function localOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    return true;
  }
  try {
    const hostname = new URL(origin).hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

async function staticResponse(request: Request, root: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed.', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response('Invalid request path.', { status: 400 });
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const path = resolve(root, relativePath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    return new Response('Not found.', { status: 404 });
  }

  const file = Bun.file(path);
  if (!(await file.exists())) {
    if (relativePath === 'index.html') {
      return new Response('Stage build not found. Run bun run build:stage.', {
        status: 503,
      });
    }
    return new Response('Not found.', { status: 404 });
  }
  return new Response(request.method === 'HEAD' ? null : file, {
    headers: { 'Content-Type': file.type },
  });
}

export function serveStage(options: StageServerOptions): StageServer {
  const staticRoot = resolve(options.staticRoot);
  const sockets = new WeakMap<
    Bun.ServerWebSocket<undefined>,
    BufferedStageSocket
  >();

  const server = Bun.serve<undefined>({
    hostname: options.hostname,
    port: options.port,
    fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === '/ws') {
        if (!localOrigin(request)) {
          return new Response('Forbidden WebSocket origin.', { status: 403 });
        }
        if (server.upgrade(request)) {
          return;
        }
        return new Response('WebSocket upgrade required.', { status: 426 });
      }
      return staticResponse(request, staticRoot);
    },
    websocket: {
      maxPayloadLength: 256 * 1_024,
      idleTimeout: 120,
      open(webSocket) {
        const socket = new BufferedStageSocket(webSocket);
        sockets.set(webSocket, socket);
        options.gateway.connect(socket);
      },
      message(webSocket, message) {
        const socket = sockets.get(webSocket);
        if (socket) {
          return options.gateway.receive(socket, message);
        }
      },
      drain(webSocket) {
        sockets.get(webSocket)?.drain();
      },
      close(webSocket) {
        const socket = sockets.get(webSocket);
        if (socket) {
          socket.closed();
          options.gateway.disconnect(socket);
          sockets.delete(webSocket);
        }
      },
    },
  });
  const port = server.port;
  if (port === undefined) {
    void server.stop(true);
    throw new Error('Stage server did not bind a TCP port.');
  }

  return {
    hostname: options.hostname,
    port,
    stop: () => server.stop(true),
  };
}
