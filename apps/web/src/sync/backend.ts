import type { Op } from './merge';

export interface PushResult {
  lastSeq: number;
}
export interface PullResult {
  ops: Op[];
  latestSeq: number;
}

/**
 * Transport to the sync server. Demo/offline identities simply never get
 * an engine, so no network code can even run for them.
 */
export interface SyncBackend {
  push(spaceId: string, clientId: string, ops: Op[]): Promise<PushResult>;
  pull(spaceId: string, since: number): Promise<PullResult>;
  /** space ids this user is a member of — how a fresh device discovers its data */
  listSpaces(): Promise<string[]>;
  /**
   * Optional long-lived change stream: resolves when the stream ends,
   * rejects on connection errors; `onEvent` fires per changed space.
   */
  events?(signal: AbortSignal, onEvent: (spaceId: string) => void): Promise<void>;
}

interface ApiBackendOptions {
  baseUrl: string;
  /** returns the bearer token (Logto access token) or test-mode subject */
  getAuth: () => Promise<{ bearer?: string; testSub?: string }>;
}

export class ApiSyncBackend implements SyncBackend {
  constructor(private readonly options: ApiBackendOptions) {}

  private async headers(): Promise<Record<string, string>> {
    const auth = await this.options.getAuth();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth.bearer) headers.Authorization = `Bearer ${auth.bearer}`;
    if (auth.testSub) headers['X-User-Sub'] = auth.testSub;
    return headers;
  }

  async push(spaceId: string, clientId: string, ops: Op[]): Promise<PushResult> {
    const res = await fetch(`${this.options.baseUrl}/sync/${spaceId}/push`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({ clientId, ops }),
    });
    if (!res.ok) throw new SyncHttpError(res.status);
    return (await res.json()) as PushResult;
  }

  async pull(spaceId: string, since: number): Promise<PullResult> {
    const res = await fetch(`${this.options.baseUrl}/sync/${spaceId}/pull?since=${since}`, {
      headers: await this.headers(),
    });
    if (!res.ok) throw new SyncHttpError(res.status);
    return (await res.json()) as PullResult;
  }

  async listSpaces(): Promise<string[]> {
    const res = await fetch(`${this.options.baseUrl}/me/spaces`, { headers: await this.headers() });
    if (!res.ok) throw new SyncHttpError(res.status);
    return (await res.json()) as string[];
  }

  /**
   * Server-sent events over fetch (EventSource cannot send auth
   * headers). Lines look like `data: {"spaceId":"…"}`; comment lines
   * (keepalives) are ignored.
   */
  async events(signal: AbortSignal, onEvent: (spaceId: string) => void): Promise<void> {
    const res = await fetch(`${this.options.baseUrl}/sync/events`, {
      headers: { ...(await this.headers()), Accept: 'text/event-stream' },
      signal,
    });
    if (!res.ok || !res.body) throw new SyncHttpError(res.status);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer = drainSseBuffer(buffer + decoder.decode(value, { stream: true }), onEvent);
    }
  }
}

/** emits every complete SSE message in the buffer; returns the remainder */
export function drainSseBuffer(buffer: string, onEvent: (spaceId: string) => void): string {
  let boundary = buffer.indexOf('\n\n');
  while (boundary !== -1) {
    emitSseChunk(buffer.slice(0, boundary), onEvent);
    buffer = buffer.slice(boundary + 2);
    boundary = buffer.indexOf('\n\n');
  }
  return buffer;
}

function emitSseChunk(chunk: string, onEvent: (spaceId: string) => void): void {
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data:')) continue; // keepalive comments etc.
    try {
      const payload = JSON.parse(line.slice(5).trim()) as { spaceId?: string };
      if (payload.spaceId) onEvent(payload.spaceId);
    } catch {
      // malformed event — skip, the poll is the safety net
    }
  }
}

export class SyncHttpError extends Error {
  constructor(readonly status: number) {
    super(`sync request failed: ${status}`);
  }
}
