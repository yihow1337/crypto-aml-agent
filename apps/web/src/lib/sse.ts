/**
 * Minimal, dependency-free Server-Sent Events parser (WHATWG "event stream interpretation").
 * Used with fetch + ReadableStream because EventSource cannot POST.
 *
 * Handles: chunk boundaries anywhere (including between `\r` and `\n`), `\n` / `\r\n` / `\r`
 * line endings, multi-line `data:` fields, comment lines (`: ping`), `id` / `retry`, and a
 * leading UTF-8 BOM.
 */
import type { AgentEvent } from '@aml/engine';

export interface SseMessage {
  /** `event:` field, or `message` when absent. */
  event: string;
  /** `data:` lines joined with `\n`. */
  data: string;
  id?: string;
  retry?: number;
}

export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];
  private eventType = '';
  private lastId: string | undefined;
  private retry: number | undefined;
  private sawData = false;
  private started = false;
  /** Number of comment lines seen (keep-alive pings). */
  comments = 0;

  /** Feed a decoded text chunk; returns every message completed by it. */
  push(chunk: string): SseMessage[] {
    if (!this.started) {
      if (chunk.length === 0) return [];
      this.started = true;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
    }
    this.buffer += chunk;
    return this.drain(false);
  }

  /**
   * End of stream. Per spec an unterminated event is discarded, but a final line without a
   * trailing newline is still processed and a pending event with data is dispatched, which is
   * friendlier to servers that omit the final blank line.
   */
  flush(): SseMessage[] {
    const out = this.drain(true);
    if (this.buffer.length > 0) {
      this.processLine(this.buffer, out);
      this.buffer = '';
    }
    this.dispatch(out);
    return out;
  }

  private drain(final: boolean): SseMessage[] {
    const out: SseMessage[] = [];
    let start = 0;
    const buf = this.buffer;
    for (let i = 0; i < buf.length; i++) {
      const ch = buf.charCodeAt(i);
      if (ch !== 10 && ch !== 13) continue;
      if (ch === 13 && i === buf.length - 1 && !final) break; // might be \r\n split across chunks
      this.processLine(buf.slice(start, i), out);
      if (ch === 13 && buf.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
    }
    this.buffer = buf.slice(start);
    return out;
  }

  private processLine(line: string, out: SseMessage[]): void {
    if (line === '') {
      this.dispatch(out);
      return;
    }
    if (line.charCodeAt(0) === 58 /* ':' */) {
      this.comments++;
      return;
    }
    const colon = line.indexOf(':');
    let field: string;
    let value: string;
    if (colon === -1) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.charCodeAt(0) === 32) value = value.slice(1);
    }
    switch (field) {
      case 'event':
        this.eventType = value;
        break;
      case 'data':
        this.dataLines.push(value);
        this.sawData = true;
        break;
      case 'id':
        if (!value.includes('\0')) this.lastId = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) this.retry = Number(value);
        break;
      default:
        break; // unknown fields are ignored
    }
  }

  private dispatch(out: SseMessage[]): void {
    if (!this.sawData) {
      this.eventType = '';
      return;
    }
    const msg: SseMessage = { event: this.eventType || 'message', data: this.dataLines.join('\n') };
    if (this.lastId !== undefined) msg.id = this.lastId;
    if (this.retry !== undefined) msg.retry = this.retry;
    out.push(msg);
    this.dataLines = [];
    this.eventType = '';
    this.sawData = false;
  }
}

/** Parse a complete SSE payload (handy for tests and saved streams). */
export function parseSse(text: string): SseMessage[] {
  const p = new SseParser();
  return [...p.push(text), ...p.flush()];
}

const AGENT_EVENT_TYPES = new Set([
  'status',
  'tool_call',
  'tool_result',
  'analysis',
  'thinking',
  'budget',
  'report',
  'error',
  'done',
]);

/**
 * Decode an SSE message into an AgentEvent. The JSON body carries the full event (including
 * `type`); if `type` is missing it falls back to the `event:` name. Returns null for
 * unparseable or unknown messages.
 */
export function toAgentEvent(msg: SseMessage): AgentEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(msg.data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type : msg.event;
  if (!AGENT_EVENT_TYPES.has(type)) return null;
  return { ...obj, type } as AgentEvent;
}

/**
 * Read a byte stream as SSE, invoking `onMessage` for each message. Resolves when the stream
 * ends; rejects if reading fails (including abort). With `idleMs`, rejects with a
 * `TimeoutError` when no bytes (not even `: ping` comments) arrive for that long.
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onMessage: (msg: SseMessage) => void,
  signal?: AbortSignal,
  idleMs = 0,
): Promise<{ comments: number }> {
  const reader = body.getReader();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const arm = () => {
    if (!idleMs) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      reader.cancel().catch(() => undefined);
    }, idleMs);
  };
  const decoder = new TextDecoder('utf-8');
  const parser = new SseParser();
  const onAbort = () => {
    reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    arm();
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (timedOut) throw new DOMException(`no data for ${idleMs} ms`, 'TimeoutError');
      if (done) break;
      arm();
      for (const m of parser.push(decoder.decode(value, { stream: true }))) onMessage(m);
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const tail = decoder.decode();
    for (const m of tail ? parser.push(tail) : []) onMessage(m);
    for (const m of parser.flush()) onMessage(m);
    return { comments: parser.comments };
  } finally {
    clearTimeout(idleTimer);
    signal?.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}
