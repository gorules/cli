import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { EvaluateRequest, EvaluateResponse, GetFileRequest, GetFileResponse, ToolManifestEntry } from './types';
import { EvaluateRequestSchema } from './types';
import INSTRUCTIONS from './instruction.md';

export class BridgeMcpServer {
  private tools: ToolManifestEntry[] = [];
  private readonly callTool: (name: string, input: unknown) => Promise<unknown>;
  private readonly callEvaluate: (request: EvaluateRequest) => Promise<EvaluateResponse>;
  private readonly callGetFile: (request: GetFileRequest) => Promise<GetFileResponse>;
  private transports = new Map<string, StreamableHTTPServerTransport>();
  readonly httpServer: HttpServer;

  constructor(
    callTool: (name: string, input: unknown) => Promise<unknown>,
    callEvaluate: (request: EvaluateRequest) => Promise<EvaluateResponse>,
    callGetFile: (request: GetFileRequest) => Promise<GetFileResponse>,
  ) {
    this.callTool = callTool;
    this.callEvaluate = callEvaluate;
    this.callGetFile = callGetFile;

    const app = new Hono();

    app.post('/evaluate/:filePath{.+}', async (c) => {
      const filePath = c.req.param('filePath');
      const body: unknown = await c.req.json();
      const parsed = EvaluateRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ success: false, error: parsed.error.message }, 400);
      }

      try {
        const response = (await this.callEvaluate({ ...parsed.data, filePath })) as Record<string, unknown>;
        const { success, ...rest } = response;

        if (success === false) {
          if (typeof rest.error === 'string') {
            try {
              rest.error = JSON.parse(rest.error);
            } catch {
              // keep as string
            }
          }
          return c.json(rest, 400);
        }

        return c.json(rest);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
      }
    });

    app.get('/file/:filePath{.+}', async (c) => {
      const filePath = c.req.param('filePath');

      try {
        const response: unknown = await this.callGetFile({ path: filePath });
        return c.json(response as Record<string, unknown>);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
      }
    });

    // Handle MCP routes directly on the HTTP server to avoid Hono's adapter
    // writing response headers after StreamableHTTPServerTransport already has.
    const honoListener = getRequestListener(app.fetch);

    this.httpServer = createServer((incoming, outgoing) => {
      const url = incoming.url || '';
      if (url === '/mcp' || url.startsWith('/mcp?')) {
        this.handleMcpRequest(incoming, outgoing).catch(() => {
          if (!outgoing.headersSent) {
            outgoing.writeHead(500);
            outgoing.end('Internal server error');
          }
        });
        return;
      }

      void honoListener(incoming, outgoing);
    });
  }

  private async handleMcpRequest(incoming: IncomingMessage, outgoing: ServerResponse) {
    const method = incoming.method;
    const sessionId = incoming.headers['mcp-session-id'] as string | undefined;

    if (method === 'POST') {
      if (sessionId) {
        const transport = this.transports.get(sessionId);
        if (!transport) {
          outgoing.writeHead(404);
          outgoing.end('Session not found');
          return;
        }
        await transport.handleRequest(incoming, outgoing);
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (sid) => {
          this.transports.set(sid, transport);
        },
      });

      const server = this.createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(incoming, outgoing);
      return;
    }

    if (method === 'GET') {
      if (!sessionId) {
        outgoing.writeHead(404);
        outgoing.end('Session not found');
        return;
      }
      const transport = this.transports.get(sessionId);
      if (!transport) {
        outgoing.writeHead(404);
        outgoing.end('Session not found');
        return;
      }
      await transport.handleRequest(incoming, outgoing);
      return;
    }

    if (method === 'DELETE') {
      if (!sessionId) {
        outgoing.writeHead(404);
        outgoing.end('Session not found');
        return;
      }
      const transport = this.transports.get(sessionId);
      if (!transport) {
        outgoing.writeHead(404);
        outgoing.end('Session not found');
        return;
      }
      await transport.handleRequest(incoming, outgoing);
      this.transports.delete(sessionId);
      return;
    }

    outgoing.writeHead(405);
    outgoing.end('Method not allowed');
  }

  private createMcpServer(): McpServer {
    const mcpServer = new McpServer(
      { name: 'gorules-brms', version: '1.0.0' },
      {
        capabilities: { tools: {} },
        instructions: INSTRUCTIONS,
      },
    );

    mcpServer.server.setRequestHandler(ListToolsRequestSchema, () => {
      return {
        tools: this.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown> & { type: 'object' },
        })),
      };
    });

    mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        const result = await this.callTool(name, args);
        return {
          content: [
            {
              type: 'text' as const,
              text: typeof result === 'string' ? result : JSON.stringify(result),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    });

    return mcpServer;
  }

  registerTools(tools: ToolManifestEntry[]) {
    this.tools = tools;
  }

  clearTools() {
    this.tools = [];
  }

  async listen(port: number, host: string) {
    return new Promise<void>((resolve, reject) => {
      this.httpServer.on('error', reject);
      this.httpServer.listen(port, host, () => {
        resolve();
      });
    });
  }
}
