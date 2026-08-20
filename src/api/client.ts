export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export interface ApiOptions {
  url: string;
  token: string;
}

export interface SyncDeploymentRequest {
  project: string;
  target?: string;
  alias?: string;
  current?: { commitId?: string | null; releaseId?: string | null };
}

export interface SyncArtifact {
  url: string;
  sha256?: string;
  expiresAt?: string;
}

export interface SyncDeploymentResult {
  project: { id: string; key: string | null } | null;
  target: string;
  alias?: string;
  action: 'no_change' | 'load' | 'no_release' | 'no_access' | 'error';
  commit?: { id: string; branchId: string | null; branchName: string | null };
  release?: { id: string; name?: string | null; version?: string | null; semanticVersion?: string | null };
  environment?: { id: string; key: string | null; name: string | null };
  artifact?: SyncArtifact;
  code?: string;
}

export interface SyncResponse {
  nextPollAt: string | null;
  deployments: SyncDeploymentResult[];
}

/**
 * Trailing slashes and a trailing `/api` are both accepted so a copied browser
 * URL and a documented API base behave the same.
 */
export const normalizeApiUrl = (url: string): string => {
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
};

export const resolveApiOptions = (args: { url?: string; token?: string }): ApiOptions => {
  const url = args.url || process.env.GORULES_URL;
  const token = args.token || process.env.GORULES_TOKEN;

  if (!url) {
    throw new CliError('Missing server URL. Pass --url or set GORULES_URL.', 2);
  }
  if (!token) {
    throw new CliError('Missing access token. Pass --token or set GORULES_TOKEN.', 2);
  }

  return { url: normalizeApiUrl(url), token };
};

/** Never interpolated into output: a token in a CI log is a leaked credential. */
const authHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});

const describeHttpError = async (response: Response, context: string): Promise<CliError> => {
  const body = await response.text().catch(() => '');
  const detail = body.slice(0, 500);

  if (response.status === 401) {
    return new CliError(`${context}: the access token was rejected (401). Check GORULES_TOKEN.`);
  }
  if (response.status === 403) {
    return new CliError(`${context}: the access token is not permitted to do this (403). Check its project scope.`);
  }
  if (response.status === 404) {
    return new CliError(`${context}: not found (404). Check the server URL and the project reference.`);
  }

  return new CliError(`${context}: HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
};

/** Retries transport failures and 5xx only; a 4xx is an answer, not a blip. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithRetry = async (url: string, init: RequestInit, context: string): Promise<Response> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_ATTEMPTS) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) {
        break;
      }
    }
    await sleep(2 ** (attempt - 1) * 500);
  }

  throw new CliError(`${context}: ${lastError instanceof Error ? lastError.message : 'request failed'}`);
};

export const sync = async (options: ApiOptions, deployments: SyncDeploymentRequest[]): Promise<SyncResponse> => {
  const response = await fetchWithRetry(
    `${options.url}/rules-sync`,
    {
      method: 'POST',
      headers: { ...authHeaders(options.token), 'Content-Type': 'application/json' },
      // No syncInterval: a one-shot sync answers with nextPollAt null
      body: JSON.stringify({ deployments }),
    },
    'Failed to resolve the target',
  );

  if (!response.ok) {
    throw await describeHttpError(response, 'Failed to resolve the target');
  }

  return (await response.json()) as SyncResponse;
};

/**
 * The sync response returns either an absolute signed CDN URL, which must be
 * fetched without the token, or a path relative to the API base, which must be
 * fetched with it. Self-hosted installs without CDN configuration always take
 * the second form.
 */
export const downloadArtifact = async (options: ApiOptions, artifact: SyncArtifact): Promise<Buffer> => {
  const isRelative = artifact.url.startsWith('/');
  const url = isRelative ? `${options.url}${artifact.url}` : artifact.url;

  const response = await fetchWithRetry(
    url,
    { headers: isRelative ? authHeaders(options.token) : {} },
    'Failed to download the artifact',
  );

  if (!response.ok) {
    throw await describeHttpError(response, 'Failed to download the artifact');
  }

  return Buffer.from(await response.arrayBuffer());
};
