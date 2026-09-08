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
    public const int Version = 1;
    /// <summary>oldest client protocol this server still speaks</summary>
    public const int MinClient = 1;
}
