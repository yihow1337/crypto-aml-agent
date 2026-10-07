import { describe, expect, it } from 'vitest';
import { parseSse, readSseStream, SseParser, toAgentEvent, type SseMessage } from './sse';

function feed(chunks: string[]): SseMessage[] {
  const p = new SseParser();
  const out: SseMessage[] = [];
  for (const c of chunks) out.push(...p.push(c));
  out.push(...p.flush());
  return out;
}

describe('SseParser', () => {
  it('parses a single event with a named type', () => {
    const msgs = parseSse('event: status\ndata: {"type":"status"}\n\n');
    expect(msgs).toEqual([{ event: 'status', data: '{"type":"status"}' }]);
  });

  it('defaults the event name to "message"', () => {
    expect(parseSse('data: hello\n\n')).toEqual([{ event: 'message', data: 'hello' }]);
  });

  it('joins multi-line data with \\n', () => {
    const msgs = parseSse('data: line 1\ndata: line 2\ndata:line 3\n\n');
    expect(msgs[0].data).toBe('line 1\nline 2\nline 3');
  });

  it('ignores comment lines (keep-alive pings)', () => {
    const p = new SseParser();
    const msgs = [...p.push(': ping\n\n: ping\n\nevent: done\ndata: {}\n\n'), ...p.flush()];
    expect(msgs).toEqual([{ event: 'done', data: '{}' }]);
    expect(p.comments).toBe(2);
  });

  it('handles chunk boundaries anywhere, including inside field names and values', () => {
    const text = 'event: tool_call\ndata: {"a":1,"b":"中文"}\n\nevent: done\ndata: {}\n\n';
    const expected = parseSse(text);
    for (let size = 1; size <= 7; size++) {
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
      expect(feed(chunks)).toEqual(expected);
    }
  });

  it('handles CRLF and CR line endings, including \\r\\n split across chunks', () => {
    expect(feed(['event: a\r', '\ndata: 1\r\n\r', '\n'])).toEqual([{ event: 'a', data: '1' }]);
    expect(parseSse('event: b\rdata: 2\r\r')).toEqual([{ event: 'b', data: '2' }]);
  });

  it('does not emit an event until the blank line arrives', () => {
    const p = new SseParser();
    expect(p.push('event: status\ndata: {"x":1}\n')).toEqual([]);
    expect(p.push('\n')).toEqual([{ event: 'status', data: '{"x":1}' }]);
  });

  it('strips exactly one leading space from values', () => {
    expect(parseSse('data:  two spaces\n\n')[0].data).toBe(' two spaces');
  });

  it('records id and retry fields', () => {
    const [m] = parseSse('id: 42\nretry: 1500\ndata: x\n\n');
    expect(m).toEqual({ event: 'message', data: 'x', id: '42', retry: 1500 });
  });

  it('skips events without data and resets the event name', () => {
    expect(parseSse('event: orphan\n\ndata: y\n\n')).toEqual([{ event: 'message', data: 'y' }]);
  });

  it('strips a leading BOM', () => {
    expect(parseSse('﻿data: z\n\n')).toEqual([{ event: 'message', data: 'z' }]);
  });

  it('flushes a final event without a trailing blank line', () => {
    expect(feed(['event: done\ndata: {"ok":true}'])).toEqual([{ event: 'done', data: '{"ok":true}' }]);
  });

  it('treats a field line without a colon as a field with an empty value', () => {
    expect(parseSse('data\n\n')).toEqual([{ event: 'message', data: '' }]);
  });
});

describe('toAgentEvent', () => {
  it('decodes the full event object from data', () => {
    const ev = toAgentEvent({ event: 'budget', data: '{"type":"budget","subrequests":3,"limit":45,"llmTurns":1}' });
    expect(ev).toEqual({ type: 'budget', subrequests: 3, limit: 45, llmTurns: 1 });
  });

  it('falls back to the SSE event name when type is missing', () => {
    const ev = toAgentEvent({ event: 'done', data: '{"investigationId":"abc","durationMs":10}' });
    expect(ev).toMatchObject({ type: 'done', investigationId: 'abc' });
  });

  it('rejects invalid JSON, non-objects and unknown types', () => {
    expect(toAgentEvent({ event: 'status', data: 'not json' })).toBeNull();
    expect(toAgentEvent({ event: 'status', data: '[1,2]' })).toBeNull();
    expect(toAgentEvent({ event: 'message', data: '{"type":"weird"}' })).toBeNull();
  });
});

describe('readSseStream', () => {
  function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
  }

  it('decodes UTF-8 split across byte chunks', async () => {
    const bytes = new TextEncoder().encode('event: status\ndata: {"message":"抓取鏈上資料"}\n\n: ping\n\n');
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 5) chunks.push(bytes.slice(i, i + 5));
    const got: SseMessage[] = [];
    const { comments } = await readSseStream(streamOf(chunks), (m) => got.push(m));
    expect(got).toEqual([{ event: 'status', data: '{"message":"抓取鏈上資料"}' }]);
    expect(comments).toBe(1);
  });

  it('rejects with TimeoutError when the stream goes idle', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': ping\n\ndata: 1\n\n'));
        // never closes
      },
    });
    const got: SseMessage[] = [];
    await expect(readSseStream(stream, (m) => got.push(m), undefined, 40)).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(got).toHaveLength(1);
  });

  it('rejects with AbortError when the signal is aborted', async () => {
    const ctrl = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: 1\n\n'));
      },
    });
    const got: SseMessage[] = [];
    const p = readSseStream(stream, (m) => {
      got.push(m);
      ctrl.abort();
    }, ctrl.signal);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(got).toHaveLength(1);
  });
});
