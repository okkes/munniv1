namespace Munni.Api;

/// <summary>
/// Client↔server compatibility handshake, the server half (the client
/// half + bump discipline live in apps/web/src/lib/protocol.ts): bump
/// Version together with CLIENT_PROTOCOL when the sync/API contract
/// changes; raise MinClient only when an OLD client would misbehave
/// rather than just miss a feature.
/// </summary>
public static class ApiProtocol
{
    // v2 (#148 r3): the txSeen entity — a v2 client's push would 400 on a v1 server
    public const int Version = 2;
    /// <summary>oldest client protocol this server still speaks</summary>
    public const int MinClient = 1;
}
