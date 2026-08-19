import { BridgeWSServer } from './ws-server';
import { BridgeMcpServer } from './mcp-server';
import type {
  BridgeOptions,
  ToolManifest,
  EvaluateRequest,
  EvaluateResponse,
  GetFileRequest,
  GetFileResponse,
} from './types';
import { customAlphabet } from 'nanoid';
import { printBanner, logConnect, logDisconnect, logToolCall, logEvent } from './log';

export async function startBridge(opts: BridgeOptions) {
  const pendingCalls = new Map<
    string,
    {
      name: string;
      resolve: (result: unknown) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      startedAt: number;
    }
  >();

  let manifest: ToolManifest | null = null;

  const callTool = (name: string, input: unknown): Promise<unknown> => {
    if (!manifest) {
      throw new Error('Browser not connected. Open GoRules and click "Connect MCP".');
    }

    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCalls.delete(requestId);
        reject(new Error('Tool execution timed out (60s). Browser may be unresponsive.'));
      }, 60_000);

      pendingCalls.set(requestId, { name, resolve, reject, timer, startedAt: performance.now() });
      ws.callTool(requestId, name, input);
    });
  };

  const callEvaluate = (request: EvaluateRequest): Promise<EvaluateResponse> => {
    if (!manifest) {
      throw new Error('Browser not connected. Open GoRules and click "Connect MCP".');
    }

    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCalls.delete(requestId);
        reject(new Error('Evaluate timed out (5s). Browser may be unresponsive.'));
      }, 5_000);

      pendingCalls.set(requestId, { name: 'evaluate', resolve, reject, timer, startedAt: performance.now() });
      ws.callEvaluate(requestId, request);
    });
  };

  const callGetFile = (request: GetFileRequest): Promise<GetFileResponse> => {
    if (!manifest) {
      throw new Error('Browser not connected. Open GoRules and click "Connect MCP".');
    }

    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCalls.delete(requestId);
        reject(new Error('Get file timed out (5s). Browser may be unresponsive.'));
      }, 5_000);

      pendingCalls.set(requestId, { name: 'get-file', resolve, reject, timer, startedAt: performance.now() });
      ws.callGetFile(requestId, request);
    });
  };

  const generateToken = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);
  const token = generateToken();
  const mcp = new BridgeMcpServer(callTool, callEvaluate, callGetFile);

  // WebSocket server shares the same HTTP server
  const ws = new BridgeWSServer(
    mcp.httpServer,
    {
      onConnected: (m) => {
        manifest = m;
        mcp.registerTools(m.tools);
        logConnect(m.project.name, m.tools.length);
      },

      onDisconnected: (reason) => {
        manifest = null;
        mcp.clearTools();
        for (const [id, pending] of pendingCalls) {
          clearTimeout(pending.timer);
          pending.reject(new Error('Browser disconnected'));
          pendingCalls.delete(id);
        }
        logDisconnect(reason);
      },

      onToolResult: (requestId, result) => {
        const pending = pendingCalls.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          const duration = Math.round(performance.now() - pending.startedAt);
          pending.resolve(result);
          pendingCalls.delete(requestId);
          logToolCall(pending.name, duration);
        }
      },

      onToolError: (requestId, error) => {
        const pending = pendingCalls.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error(error));
          pendingCalls.delete(requestId);
        }
      },

      onEvaluateResult: (requestId, response) => {
        const pending = pendingCalls.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          const duration = Math.round(performance.now() - pending.startedAt);
          pending.resolve(response);
          pendingCalls.delete(requestId);
          logEvent(`Evaluate completed (${duration}ms)`);
        }
      },

      onGetFileResult: (requestId, response) => {
        const pending = pendingCalls.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          const duration = Math.round(performance.now() - pending.startedAt);
          pending.resolve(response);
          pendingCalls.delete(requestId);
          logEvent(`Get file completed (${duration}ms)`);
        }
      },

      onProgress: () => {},
    },
    token,
  );

  await mcp.listen(opts.port, opts.host);
  printBanner(opts.host, opts.port, token);

  if (opts.openBrowser && opts.serverUrl) {
    const { execFile } = await import('node:child_process');
    execFile('open', [opts.serverUrl]);
  }
}
