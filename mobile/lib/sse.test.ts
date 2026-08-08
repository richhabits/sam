import { describe, expect, it } from 'vitest';
import { parseFrames } from './sse';

// The SSE reader's only hard part is that chunk boundaries are arbitrary. These pin the
// cases that would otherwise drop or duplicate tokens under load — the kind of bug that
// never shows up on a fast loopback and always shows up on a phone over wifi.
describe('parseFrames — SSE framing', () => {
  it('reads complete frames and keeps the trailing partial in the buffer', () => {
    const { events, rest } = parseFrames('data: {"type":"token","t":"he"}\n\ndata: {"type":"tok');
    expect(events).toEqual([{ type: 'token', t: 'he' }]);
    expect(rest).toBe('data: {"type":"tok'); // NOT dropped — the rest arrives next chunk
  });

  it('reassembles a message split mid-JSON across two chunks', () => {
    const a = parseFrames('data: {"type":"tok');
    expect(a.events).toEqual([]);
    const b = parseFrames(a.rest + 'en","t":"llo"}\n\n');
    expect(b.events).toEqual([{ type: 'token', t: 'llo' }]);
    expect(b.rest).toBe('');
  });

  it('handles several frames arriving in one chunk, in order', () => {
    const { events } = parseFrames(
      'data: {"type":"route","tier":"free"}\n\ndata: {"type":"token","t":"a"}\n\ndata: {"type":"token","t":"b"}\n\n',
    );
    expect(events.map((e) => e.type)).toEqual(['route', 'token', 'token']);
    expect((events[1] as any).t + (events[2] as any).t).toBe('ab');
  });

  it('ignores keep-alive comments and [DONE], which are not payload', () => {
    const { events } = parseFrames(': keep-alive\n\ndata: [DONE]\n\ndata: {"type":"end"}\n\n');
    expect(events).toEqual([{ type: 'end' }]);
  });

  it('survives a malformed frame instead of throwing away the whole stream', () => {
    const { events } = parseFrames('data: {not json}\n\ndata: {"type":"token","t":"ok"}\n\n');
    expect(events).toEqual([{ type: 'token', t: 'ok' }]);
  });

  it('a frame is only complete on the blank line — a single newline is not a boundary', () => {
    const { events, rest } = parseFrames('data: {"type":"token","t":"x"}\n');
    expect(events).toEqual([]);
    expect(rest).toBe('data: {"type":"token","t":"x"}\n');
  });
});
