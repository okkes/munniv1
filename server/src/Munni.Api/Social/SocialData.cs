namespace Munni.Api.Social;

/// <summary>Friendship edge; UserAId &lt; UserBId (ordered pair, unique).</summary>
public class Friendship
{
    public Guid Id { get; set; }
    public Guid UserAId { get; set; }
    public Guid UserBId { get; set; }
    public Guid RequestedBy { get; set; }
    public required string Status { get; set; } // pending | accepted
    // #169: a request sent from a space's invite flow piggybacks the
    // space — accepting the friendship also creates the membership
    public string? SpaceId { get; set; }
    public string? SpaceRole { get; set; }
    public string? SpaceName { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Invitation to join a shared space (must be friends first).</summary>
public class SpaceInvite
{
    public Guid Id { get; set; }
    public required string SpaceId { get; set; }
    public Guid FromUserId { get; set; }
    public Guid ToUserId { get; set; }
    public required string Role { get; set; } // member | owner
    public required string Status { get; set; } // pending | accepted | declined
    /// <summary>sender's name for the space at invite time (spaces have no server-side name)</summary>
    public string? SpaceName { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
