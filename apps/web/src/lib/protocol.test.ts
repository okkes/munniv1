import { describe, expect, it } from 'vitest';
import { CLIENT_PROTOCOL, MIN_SERVER_PROTOCOL, protocolIssueFor } from './protocol';

describe('version handshake (native apps deploy separately from the API)', () => {
  it('same generation is compatible — and so are servers predating the handshake', () => {
    expect(protocolIssueFor({ protocol: CLIENT_PROTOCOL, minClientProtocol: 1 })).toBeNull();
    expect(protocolIssueFor({})).toBe('server-outdated'); // pre-handshake servers default to v1 — v2 clients refuse (#148 r3)
  });

  it('a server that dropped support for this client says: update the app', () => {
    expect(protocolIssueFor({ protocol: CLIENT_PROTOCOL + 5, minClientProtocol: CLIENT_PROTOCOL + 1 })).toBe(
      'client-outdated',
    );
  });

  it('a server older than this client requires says: update the server first', () => {
    expect(protocolIssueFor({ protocol: MIN_SERVER_PROTOCOL - 1, minClientProtocol: 1 })).toBe('server-outdated');
  });
});
