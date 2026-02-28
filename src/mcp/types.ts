import { z } from 'zod';

export const ToolManifestEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.any(),
});

export const ToolManifestSchema = z.object({
  type: z.literal('manifest'),
  tools: z.array(ToolManifestEntrySchema),
  project: z.object({
    name: z.string(),
    id: z.string(),
  }),
});

const ToolResultSchema = z.object({
  type: z.literal('tool-result'),
  requestId: z.string(),
  result: z.unknown(),
});

const ToolErrorSchema = z.object({
  type: z.literal('tool-error'),
  requestId: z.string(),
  error: z.string(),
});

const ProgressSchema = z.object({
  type: z.literal('progress'),
  requestId: z.string(),
  message: z.string(),
});

const EvaluateResultSchema = z.object({
  type: z.literal('evaluate-result'),
  requestId: z.string(),
  response: z.any(),
});

const GetFileResultSchema = z.object({
  type: z.literal('get-file-result'),
  requestId: z.string(),
  response: z.any(),
});

const DisconnectSchema = z.object({
  type: z.literal('disconnect'),
  reason: z.string(),
});

export const BrowserMessageSchema = z.discriminatedUnion('type', [
  ToolManifestSchema,
  ToolResultSchema,
  ToolErrorSchema,
  ProgressSchema,
  EvaluateResultSchema,
  GetFileResultSchema,
  DisconnectSchema,
]);

export type ToolManifestEntry = z.infer<typeof ToolManifestEntrySchema>;
export type ToolManifest = z.infer<typeof ToolManifestSchema>;

export const EvaluateRequestSchema = z.object({
  context: z.record(z.string(), z.unknown()),
  trace: z.boolean().optional(),
  maxDepth: z.number().optional(),
});

export type EvaluateBody = z.infer<typeof EvaluateRequestSchema>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EvaluateResponse = any;

export interface EvaluateRequest extends EvaluateBody {
  filePath: string;
}

export interface GetFileRequest {
  path: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GetFileResponse = any;

export type CLIMessage =
  | { type: 'hello' }
  | { type: 'tool-call'; requestId: string; toolName: string; input: unknown }
  | { type: 'evaluate'; requestId: string; request: EvaluateRequest }
  | { type: 'get-file'; requestId: string; request: GetFileRequest };

export interface BridgeOptions {
  port: number;
  host: string;
  serverUrl?: string;
  openBrowser: boolean;
}
