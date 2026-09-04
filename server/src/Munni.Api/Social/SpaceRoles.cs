namespace Munni.Api.Social;

/// <summary>
/// Space member roles. Owners manage members/invites and everything a
/// contributor can; contributors read and write data; readers only pull.
/// Legacy rows created before roles landed say "member" — treated as
/// contributor.
/// </summary>
public static class SpaceRoles
{
    public const string Owner = "owner";
    public const string Contributor = "contributor";
    public const string Reader = "reader";
    /// <summary>pre-roles value, equivalent to contributor</summary>
    public const string LegacyMember = "member";

    public static readonly string[] Assignable = [Owner, Contributor, Reader];

    public static string Normalize(string role) => role == LegacyMember ? Contributor : role;

    public static bool CanWrite(string role) => Normalize(role) is Owner or Contributor;

    public static bool IsOwner(string role) => role == Owner;
}
