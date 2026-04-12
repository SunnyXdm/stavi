declare module 'ws' {
  import type { EventEmitter } from 'node:events';
  import type { Server as HttpServer } from 'node:http';
  import type { Duplex } from 'node:stream';

  export class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly OPEN: number;
    readyState: number;
    send(data: string | Uint8Array | Buffer): void;
    close(code?: number, reason?: string): void;
    on(event: 'close', listener: () => void): this;
    on(event: 'message', listener: (data: Buffer) => void): this;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options: { noServer?: boolean; server?: HttpServer });
    handleUpgrade(
      request: import('node:http').IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (socket: WebSocket) => void,
    ): void;
    close(callback?: () => void): void;
    on(event: 'connection', listener: (socket: WebSocket) => void): this;
  }
}
