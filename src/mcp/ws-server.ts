import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { CLIMessage, EvaluateRequest, GetFileRequest, ToolManifest } from './types';
import { BrowserMessageSchema } from './types';
import { logEvent } from './log';

export interface WSServerEvents {
  onConnected: (manifest: ToolManifest) => void;
  onDisconnected: (reason: string) => void;
  onToolResult: (requestId: string, result: unknown) => void;
  onToolError: (requestId: string, error: string) => void;
  onEvaluateResult: (requestId: string, response: unknown) => void;
  onGetFileResult: (requestId: string, response: unknown) => void;
  onProgress: (requestId: string, message: string) => void;
}

export class BridgeWSServer {
  private wss: WebSocketServer;
  private client: WebSocket | null = null;
  private events: WSServerEvents;

  constructor(httpServer: HttpServer, events: WSServerEvents, token: string) {
    this.events = events;
    this.wss = new WebSocketServer({
      server: httpServer,
      verifyClient: (
        info: { req: IncomingMessage },
        cb: (result: boolean, code?: number, message?: string) => void,
      ) => {
        const url = new URL(info.req.url ?? '', 'http://localhost');
        const clientToken = url.searchParams.get('token');
        if (clientToken !== token) {
          logEvent('Rejected WebSocket connection: invalid or missing token');
          cb(false, 401, 'Unauthorized');
          return;
        }
        cb(true);
      },
    });

    this.wss.on('connection', (ws) => {
      if (this.client) {
        ws.close(4000, 'Already connected');
        logEvent('Rejected additional browser connection');
        return;
      }

      this.client = ws;
      this.send({ type: 'hello' });

      ws.on('message', (data) => {
        this.handleMessage(data);
      });
      ws.on('close', () => {
        this.client = null;
        this.events.onDisconnected('Browser disconnected');
      });
      ws.on('error', (err) => {
        logEvent(`WebSocket error: ${err.message}`);
      });
    });
  }

  get isConnected(): boolean {
    return this.client !== null;
  }

  callTool(requestId: string, toolName: string, input: unknown) {
    this.send({ type: 'tool-call', requestId, toolName, input });
  }

  callEvaluate(requestId: string, request: EvaluateRequest) {
    this.send({ type: 'evaluate', requestId, request });
  }

  callGetFile(requestId: string, request: GetFileRequest) {
    this.send({ type: 'get-file', requestId, request });
  }

  close() {
    this.client?.close();
    this.wss.close();
  }

  private send(msg: CLIMessage) {
    this.client?.send(JSON.stringify(msg));
  }

  private handleMessage(raw: Buffer | ArrayBuffer | Buffer[]) {
    const text = Buffer.isBuffer(raw) ? raw.toString('utf-8') : Buffer.from(raw as ArrayBuffer).toString('utf-8');
    const parsed = BrowserMessageSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      logEvent(`Invalid WebSocket message: ${String(parsed.error)}`);
      return;
    }

    const msg = parsed.data;
    switch (msg.type) {
      case 'manifest':
        this.events.onConnected(msg);
        break;
      case 'tool-result':
        this.events.onToolResult(msg.requestId, msg.result);
        break;
      case 'tool-error':
        this.events.onToolError(msg.requestId, msg.error);
        break;
      case 'evaluate-result':
        this.events.onEvaluateResult(msg.requestId, msg.response);
        break;
      case 'get-file-result':
        this.events.onGetFileResult(msg.requestId, msg.response);
        break;
      case 'progress':
        this.events.onProgress(msg.requestId, msg.message);
        break;
      case 'disconnect':
        // Browser is about to close the socket; the 'close' event will handle cleanup
        break;
    }
  }
}
