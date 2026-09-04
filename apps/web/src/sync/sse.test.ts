import { describe, expect, it, vi } from 'vitest';
import { drainSseBuffer } from './backend';

describe('drainSseBuffer (SSE frame parsing)', () => {
  it('emits complete data frames and returns the unterminated rest', () => {
    const onEvent = vi.fn();
    const rest = drainSseBuffer('data: {"spaceId":"a"}\n\ndata: {"spaceId":"b"}\n\ndata: {"spa', onEvent);
    expect(onEvent.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    expect(rest).toBe('data: {"spa');
  });

  it('ignores keepalive comments and malformed payloads', () => {
    const onEvent = vi.fn();
    const rest = drainSseBuffer(': connected\n\n: keepalive\n\ndata: not-json\n\ndata: {"other":1}\n\n', onEvent);
    expect(onEvent).not.toHaveBeenCalled();
    expect(rest).toBe('');
  });

  it('handles multi-line chunks split across reads', () => {
    const onEvent = vi.fn();
    let buffer = drainSseBuffer('data: {"spaceId"', onEvent);
    expect(onEvent).not.toHaveBeenCalled();
    buffer = drainSseBuffer(buffer + ':"space_1"}\n\n', onEvent);
    expect(onEvent).toHaveBeenCalledWith('space_1');
    expect(buffer).toBe('');
  });
});
