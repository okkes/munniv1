using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Munni.Api.Auth;
using Munni.Api.Data;
using Munni.Api.Push;
using Munni.Api.Validation;

namespace Munni.Api.Social;

public sealed record MeResponse(Guid UserId, string? DisplayName, string? Picture, string? Country = null, string? DisplayCurrency = null);
public sealed record UpdateMeRequest(string DisplayName, string? Picture = null, string? Country = null, string? DisplayCurrency = null);
public sealed record FriendDto(Guid UserId, string? DisplayName, string? Picture = null);
public sealed record FriendRequestDto(Guid Id, Guid FromUserId, string? FromName, Guid ToUserId, string? ToName, string? SpaceName = null);
public sealed record FriendsResponse(List<FriendDto> Friends, List<FriendRequestDto> SentPending, List<FriendRequestDto> ReceivedPending);
// #169: a request may piggyback a space — accepting also joins it
public sealed record SendFriendRequest(Guid ToUserId, string? SpaceId = null, string? Role = null, string? SpaceName = null);
public sealed record SendSpaceInvite(Guid ToUserId, string Role, string? SpaceName);
public sealed record ChangeRoleRequest(string Role, string? SpaceName = null);
public sealed record SpaceInviteDto(Guid Id, string SpaceId, string? SpaceName, Guid FromUserId, string? FromName, string Role);
public sealed record OutgoingInviteDto(Guid Id, Guid ToUserId, string? ToName, string Role);
public sealed record MemberDto(Guid UserId, string? DisplayName, string Role, string? Picture = null, DateTimeOffset? JoinedAt = null);

public static class SocialEndpoints
{
    /// <summary>Strict rate-limit policy for writes that reach other people.</summary>
    public const string MutationsPolicy = "social-mutations";

    private const string StatusAccepted = "accepted";
    private const string StatusPending = "pending";
    private const string StatusDeclined = "declined";

    public static void MapSocial(this IEndpointRouteBuilder app)
    {
        var authed = app.MapGroup("").RequireAuthorization().WithSafeRouteParams();

        authed.MapGet("/me", GetMe);
        // onboarding default for "country of use" (user ruling: IP-based
        // ONLY here, for signed-in users — never on the login screen)
        authed.MapGet("/geo", GetGeoAsync);
        authed.MapPut("/me", UpdateMe).WithValidation<UpdateMeRequest>();
        // full account deletion — Apple guideline 5.1.1 subsection v wants
        // an in-app path. The strict limiter also throttles double-taps.
        authed.MapDelete("/me", DeleteMe).RequireRateLimiting(MutationsPolicy);
        authed.MapGet("/friends", GetFriends);
        // writes that reach OTHER people get the stricter limiter (invite spam)
        authed.MapPost("/friends/requests", SendFriendRequestAsync).WithValidation<SendFriendRequest>().RequireRateLimiting(MutationsPolicy);
        authed.MapPost("/friends/requests/{id:guid}/accept", AcceptFriendRequest).RequireRateLimiting(MutationsPolicy);
        authed.MapDelete("/friends/{userId:guid}", RemoveFriend).RequireRateLimiting(MutationsPolicy);
        authed.MapPost("/spaces/{spaceId}/invites", SendSpaceInviteAsync).WithValidation<SendSpaceInvite>().RequireRateLimiting(MutationsPolicy);
        authed.MapGet("/spaces/{spaceId}/invites", GetSpaceInvites);
        authed.MapDelete("/spaces/invites/{id:guid}", RevokeInvite).RequireRateLimiting(MutationsPolicy);
        authed.MapGet("/me/invites", GetMyInvites);
        authed.MapPost("/spaces/invites/{id:guid}/{action}", RespondToInvite).RequireRateLimiting(MutationsPolicy);
        authed.MapGet("/spaces/{spaceId}/members", GetMembers);
        authed.MapPut("/spaces/{spaceId}/members/{userId:guid}/role", ChangeMemberRole).WithValidation<ChangeRoleRequest>().RequireRateLimiting(MutationsPolicy);
        authed.MapDelete("/spaces/{spaceId}/members/{userId:guid}", RemoveMember).RequireRateLimiting(MutationsPolicy);
    }

    // ── identity ────────────────────────────────────────────────────────
    /// <summary>best-effort IP → ISO country for the onboarding default.
    /// Free lookup (ip-api.com), cached per IP, fails open to null —
    /// the client keeps its own default when this returns nothing.</summary>
    private static readonly ConcurrentDictionary<string, string?> GeoCache = new();

    private static async Task<IResult> GetGeoAsync(HttpContext ctx, IHttpClientFactory httpFactory)
    {
        var ip = ctx.Request.Headers["X-Forwarded-For"].FirstOrDefault()?.Split(',')[0].Trim();
        if (string.IsNullOrEmpty(ip)) ip = ctx.Connection.RemoteIpAddress?.ToString();
        if (string.IsNullOrEmpty(ip) || ip == "127.0.0.1" || ip == "::1") return Results.Ok(new { country = (string?)null });
        if (GeoCache.TryGetValue(ip, out var cached)) return Results.Ok(new { country = cached });
        string? country = null;
        try
        {
            // ipwho.is: free AND speaks TLS (ip-api.com's free tier is
            // plaintext-only — Sonar hotspot, and the IP deserves better)
            using var client = httpFactory.CreateClient("geo");
            var res = await client.GetFromJsonAsync<GeoLookup>($"https://ipwho.is/{ip}?fields=success,country_code");
            if (res?.Success == true && !string.IsNullOrEmpty(res.CountryCode)) country = res.CountryCode;
        }
        catch
        {
            // lookup down — the client default stands
        }
        if (GeoCache.Count > 10_000) GeoCache.Clear(); // bounded, coarse
        GeoCache[ip] = country;
        return Results.Ok(new { country });
    }

    private sealed record GeoLookup(
        [property: System.Text.Json.Serialization.JsonPropertyName("success")] bool? Success,
        [property: System.Text.Json.Serialization.JsonPropertyName("country_code")] string? CountryCode);

    private static async Task<IResult> GetMe(AppDbContext db, HttpContext http)
    {
        var user = await db.Users.FindAsync(http.GetUserId());
        return Results.Ok(new MeResponse(user!.Id, user.DisplayName, user.Picture, user.Country, user.DisplayCurrency));
    }

    private static async Task<IResult> DeleteMe(
        AppDbContext db,
        HttpContext http,
        IHttpClientFactory httpFactory,
        IConfiguration config,
        ILoggerFactory loggerFactory,
        bool keepIdentity = false)
    {
        var user = await db.Users.FindAsync(http.GetUserId());
        if (user is null) return Results.NotFound();
        var gc = http.RequestServices.GetService<Munni.Api.GoCardless.IGoCardlessApi>();
        // keepIdentity: the go-offline conversion — munni data dies, the
        // Logto login survives (dev and prod share identities, and a later
        // sign-in should simply provision a fresh account)
        await AccountDeletion.DeleteUserAsync(db, gc, httpFactory, config, loggerFactory.CreateLogger("AccountDeletion"), user, !keepIdentity);
        return Results.Ok(new { deleted = true });
    }

    private static async Task<IResult> UpdateMe(UpdateMeRequest request, AppDbContext db, HttpContext http)
    {
        var user = await db.Users.FindAsync(http.GetUserId());
        user!.DisplayName = request.DisplayName.Trim();
        if (request.Picture is not null) user.Picture = request.Picture;
        if (request.Country is not null) user.Country = request.Country.ToUpperInvariant();
        // display currency is a personal rendering preference (currency
        // plan CD3): '' clears back to "as recorded", null leaves it alone
        if (request.DisplayCurrency is not null)
            user.DisplayCurrency = request.DisplayCurrency.Length == 0 ? null : request.DisplayCurrency.ToUpperInvariant();
        await db.SaveChangesAsync();
        return Results.Ok(new MeResponse(user.Id, user.DisplayName, user.Picture, user.Country, user.DisplayCurrency));
    }

    // ── friends ─────────────────────────────────────────────────────────
    private static async Task<IResult> GetFriends(AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        var edges = await db.Friendships.Where(f => f.UserAId == me || f.UserBId == me).ToListAsync();
        var otherIds = edges.Select(f => f.UserAId == me ? f.UserBId : f.UserAId).Distinct().ToList();
        var users = await db.Users.Where(u => otherIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => new { u.DisplayName, u.Picture });
        var names = users.ToDictionary(kv => kv.Key, kv => kv.Value.DisplayName);

        FriendRequestDto Req(Friendship f)
        {
            var other = f.UserAId == me ? f.UserBId : f.UserAId;
            var (from, to) = f.RequestedBy == me ? (me, other) : (other, me);
            return new FriendRequestDto(f.Id, from, from == me ? null : names.GetValueOrDefault(from), to,
                to == me ? null : names.GetValueOrDefault(to), f.SpaceName);
        }

        return Results.Ok(new FriendsResponse(
            edges.Where(f => f.Status == StatusAccepted)
                .Select(f => f.UserAId == me ? f.UserBId : f.UserAId)
                .Select(id => new FriendDto(id, names.GetValueOrDefault(id), users.GetValueOrDefault(id)?.Picture)).ToList(),
            edges.Where(f => f.Status == StatusPending && f.RequestedBy == me).Select(Req).ToList(),
            edges.Where(f => f.Status == StatusPending && f.RequestedBy != me).Select(Req).ToList()));
    }

    /// <summary>#169: the optional space a friend request carries along.</summary>
    private readonly record struct SpaceIntent(string SpaceId, string Role, string? SpaceName);

    private static async Task<IResult> SendFriendRequestAsync(SendFriendRequest request, AppDbContext db, PushNotifier push, HttpContext http, CancellationToken ct)
    {
        var me = http.GetUserId();
        if (request.ToUserId == me) return Results.BadRequest();
        if (await db.Users.FindAsync([request.ToUserId], ct) is null) return Results.NotFound();
        // #169: a piggybacked space demands the sender owns it — the same
        // gate a direct space invite passes through
        var role = SpaceRoles.Assignable.Contains(request.Role ?? "") ? request.Role! : SpaceRoles.Contributor;
        if (request.SpaceId is not null)
        {
            var membership = await db.SpaceMembers.FirstOrDefaultAsync(m => m.SpaceId == request.SpaceId && m.UserId == me, ct);
            if (membership is null || !SpaceRoles.IsOwner(membership.Role)) return Results.Forbid();
        }

        var (a, b) = me < request.ToUserId ? (me, request.ToUserId) : (request.ToUserId, me);
        var existing = await db.Friendships.FirstOrDefaultAsync(f => f.UserAId == a && f.UserBId == b, ct);
        if (existing is not null) await AutoAcceptReciprocalAsync(db, push, existing, me, request, role, ct);
        else await CreatePendingRequestAsync(db, push, (a, b), me, request, role, ct);
        return Results.Ok();
    }

    /// <summary>their pending request to me auto-accepts (legacy behavior).</summary>
    private static async Task AutoAcceptReciprocalAsync(AppDbContext db, PushNotifier push, Friendship existing, Guid me, SendFriendRequest request, string role, CancellationToken ct)
    {
        if (existing.Status != StatusPending || existing.RequestedBy == me) return;
        existing.Status = StatusAccepted;
        await db.SaveChangesAsync(ct);
        await push.NotifyFriendAcceptedAsync(request.ToUserId, await NameOf(db, me, ct), ct);
        // already friends now — the space intent survives as a
        // regular pending invite (joining still needs their yes)
        if (request.SpaceId is not null)
            await AddSpaceInviteIfMissingAsync(db, push, new SpaceIntent(request.SpaceId, role, request.SpaceName), me, request.ToUserId, ct);
    }

    private static async Task CreatePendingRequestAsync(AppDbContext db, PushNotifier push, (Guid A, Guid B) pair, Guid me, SendFriendRequest request, string role, CancellationToken ct)
    {
        db.Friendships.Add(new Friendship
        {
            Id = Guid.NewGuid(),
            UserAId = pair.A,
            UserBId = pair.B,
            RequestedBy = me,
            Status = StatusPending,
            SpaceId = request.SpaceId,
            SpaceRole = request.SpaceId is null ? null : role,
            SpaceName = request.SpaceId is null ? null : request.SpaceName,
        });
        await db.SaveChangesAsync(ct);
        await push.NotifyFriendRequestAsync(request.ToUserId, await NameOf(db, me, ct), ct);
    }

    /// <summary>#169 fallback when the pair turned out to be friends already.</summary>
    private static async Task AddSpaceInviteIfMissingAsync(
        AppDbContext db, PushNotifier push, SpaceIntent intent, Guid fromUserId, Guid toUserId, CancellationToken ct)
    {
        if (await db.SpaceMembers.AnyAsync(m => m.SpaceId == intent.SpaceId && m.UserId == toUserId, ct)) return;
        if (await db.SpaceInvites.AnyAsync(i => i.SpaceId == intent.SpaceId && i.ToUserId == toUserId && i.Status == StatusPending, ct)) return;
        db.SpaceInvites.Add(new SpaceInvite
        {
            Id = Guid.NewGuid(),
            SpaceId = intent.SpaceId,
            FromUserId = fromUserId,
            ToUserId = toUserId,
            Role = intent.Role,
            Status = StatusPending,
            SpaceName = intent.SpaceName,
        });
        await db.SaveChangesAsync(ct);
        await push.NotifySpaceInviteAsync(toUserId, await NameOf(db, fromUserId, ct), intent.SpaceName, ct);
    }

    private static async Task<IResult> AcceptFriendRequest(Guid id, AppDbContext db, PushNotifier push, HttpContext http, CancellationToken ct)
    {
        var me = http.GetUserId();
        var f = await db.Friendships.FindAsync([id], ct);
        if (f is null || (f.UserAId != me && f.UserBId != me) || f.RequestedBy == me) return Results.NotFound();
        f.Status = StatusAccepted;
        // #169: the request rode in from a space's invite flow — accepting
        // creates the membership too, exactly like accepting a space invite
        var joinsSpace = f.SpaceId is not null
            && !await db.SpaceMembers.AnyAsync(m => m.SpaceId == f.SpaceId && m.UserId == me, ct);
        if (joinsSpace)
        {
            var role = SpaceRoles.Assignable.Contains(f.SpaceRole ?? "") ? f.SpaceRole! : SpaceRoles.Contributor;
            db.SpaceMembers.Add(new SpaceMember { SpaceId = f.SpaceId!, UserId = me, Role = role });
            // rejoining member with a still-connected bank: their archived
            // account attachments in this space reconnect automatically
            await Accounts.AccountEndpoints.ReviveLinksOnJoinAsync(db, f.SpaceId!, me);
        }
        await db.SaveChangesAsync(ct);
        var myName = await NameOf(db, me, ct);
        await push.NotifyFriendAcceptedAsync(f.RequestedBy, myName, ct);
        if (joinsSpace)
        {
            await push.NotifySpaceJoinAsync(f.RequestedBy, myName, f.SpaceName, ct);
        }
        return Results.Ok();
    }

    private static async Task<IResult> RemoveFriend(Guid userId, AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        var (a, b) = me < userId ? (me, userId) : (userId, me);
        // also used to decline a pending request
        var edge = await db.Friendships.FirstOrDefaultAsync(f => f.UserAId == a && f.UserBId == b);
        if (edge is not null)
        {
            db.Friendships.Remove(edge);
            await db.SaveChangesAsync();
        }
        return Results.Ok();
    }

    // ── space invites & members ────────────────────────────────────────
    private static async Task<IResult> SendSpaceInviteAsync(string spaceId, SendSpaceInvite request, AppDbContext db, PushNotifier push, HttpContext http, CancellationToken ct)
    {
        var me = http.GetUserId();
        var membership = await db.SpaceMembers.FirstOrDefaultAsync(m => m.SpaceId == spaceId && m.UserId == me, ct);
        if (membership is null || !SpaceRoles.IsOwner(membership.Role)) return Results.Forbid();

        var (a, b) = me < request.ToUserId ? (me, request.ToUserId) : (request.ToUserId, me);
        var friends = await db.Friendships.AnyAsync(f => f.UserAId == a && f.UserBId == b && f.Status == StatusAccepted, ct);
        if (!friends) return Results.BadRequest(new { error = "not friends" });
        if (await db.SpaceMembers.AnyAsync(m => m.SpaceId == spaceId && m.UserId == request.ToUserId, ct))
            return Results.BadRequest(new { error = "already member" });

        var pending = await db.SpaceInvites.AnyAsync(i => i.SpaceId == spaceId && i.ToUserId == request.ToUserId && i.Status == StatusPending, ct);
        if (!pending)
        {
            db.SpaceInvites.Add(new SpaceInvite
            {
                Id = Guid.NewGuid(),
                SpaceId = spaceId,
                FromUserId = me,
                ToUserId = request.ToUserId,
                Role = SpaceRoles.Assignable.Contains(request.Role) ? request.Role : SpaceRoles.Contributor,
                Status = StatusPending,
                SpaceName = request.SpaceName,
            });
            await db.SaveChangesAsync(ct);
            await push.NotifySpaceInviteAsync(request.ToUserId, await NameOf(db, me, ct), request.SpaceName, ct);
        }
        return Results.Ok();
    }

    /// <summary>Owner-only: the space's outgoing pending invites (for "waiting…" feedback).</summary>
    private static async Task<IResult> GetSpaceInvites(string spaceId, AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        var myRole = (await db.SpaceMembers.FirstOrDefaultAsync(m => m.SpaceId == spaceId && m.UserId == me))?.Role;
        if (myRole is null || !SpaceRoles.IsOwner(myRole)) return Results.Forbid();

        var invites = await db.SpaceInvites.Where(i => i.SpaceId == spaceId && i.Status == StatusPending).ToListAsync();
        var toIds = invites.Select(i => i.ToUserId).Distinct().ToList();
        var names = await db.Users.Where(u => toIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.DisplayName);
        return Results.Ok(invites.Select(i =>
            new OutgoingInviteDto(i.Id, i.ToUserId, names.GetValueOrDefault(i.ToUserId), i.Role)).ToList());
    }

    /// <summary>Any owner of the space may withdraw a pending invite.</summary>
    private static async Task<IResult> RevokeInvite(Guid id, AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        var invite = await db.SpaceInvites.FindAsync(id);
        if (invite is null || invite.Status != StatusPending) return Results.NotFound();
        var myRole = (await db.SpaceMembers.FirstOrDefaultAsync(m => m.SpaceId == invite.SpaceId && m.UserId == me))?.Role;
        if (myRole is null || !SpaceRoles.IsOwner(myRole)) return Results.Forbid();
        db.SpaceInvites.Remove(invite);
        await db.SaveChangesAsync();
        return Results.Ok();
    }

    private static async Task<IResult> GetMyInvites(AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        var invites = await db.SpaceInvites.Where(i => i.ToUserId == me && i.Status == StatusPending).ToListAsync();
        var fromIds = invites.Select(i => i.FromUserId).Distinct().ToList();
        var names = await db.Users.Where(u => fromIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.DisplayName);
        return Results.Ok(invites.Select(i =>
            new SpaceInviteDto(i.Id, i.SpaceId, i.SpaceName, i.FromUserId, names.GetValueOrDefault(i.FromUserId), i.Role)).ToList());
    }

    private static async Task<IResult> RespondToInvite(Guid id, string action, AppDbContext db, PushNotifier push, HttpContext http, CancellationToken ct)
    {
        var me = http.GetUserId();
        var invite = await db.SpaceInvites.FindAsync([id], ct);
        if (invite is null || invite.ToUserId != me || invite.Status != StatusPending) return Results.NotFound();
        if (action == "accept")
        {
            invite.Status = StatusAccepted;
            db.SpaceMembers.Add(new SpaceMember { SpaceId = invite.SpaceId, UserId = me, Role = invite.Role });
            // rejoining member with a still-connected bank: their archived
            // account attachments in this space reconnect automatically
            await Accounts.AccountEndpoints.ReviveLinksOnJoinAsync(db, invite.SpaceId, me);
        }
        else invite.Status = StatusDeclined;
        await db.SaveChangesAsync(ct);
        if (invite.Status == StatusAccepted)
        {
            await push.NotifySpaceJoinAsync(invite.FromUserId, await NameOf(db, me, ct), invite.SpaceName, ct);
        }
        return Results.Ok();
    }

    private static async Task<IResult> GetMembers(string spaceId, AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        if (!await db.SpaceMembers.AnyAsync(m => m.SpaceId == spaceId && m.UserId == me)) return Results.Forbid();
        var members = await db.SpaceMembers.Where(m => m.SpaceId == spaceId).ToListAsync();
        var ids = members.Select(m => m.UserId).ToList();
        var users = await db.Users.Where(u => ids.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => new { u.DisplayName, u.Picture });
        return Results.Ok(members.Select(m => new MemberDto(
            m.UserId,
            users.GetValueOrDefault(m.UserId)?.DisplayName,
            SpaceRoles.Normalize(m.Role),
            users.GetValueOrDefault(m.UserId)?.Picture,
            m.JoinedAt)).ToList());
    }

    /// <summary>Owner-only. Also how ownership is transferred (promote to owner).</summary>
    private static async Task<IResult> ChangeMemberRole(string spaceId, Guid userId, ChangeRoleRequest request, AppDbContext db, PushNotifier push, HttpContext http, CancellationToken ct)
    {
        var me = http.GetUserId();
        var myRole = (await db.SpaceMembers.FirstOrDefaultAsync(m => m.SpaceId == spaceId && m.UserId == me, ct))?.Role;
        if (myRole is null || !SpaceRoles.IsOwner(myRole)) return Results.Forbid();

        var member = await db.SpaceMembers.FirstOrDefaultAsync(m => m.SpaceId == spaceId && m.UserId == userId, ct);
        if (member is null) return Results.NotFound();

        // an owner may not demote themself while they are the only owner
        if (userId == me && request.Role != SpaceRoles.Owner && !await HasAnotherOwner(db, spaceId, me))
            return Results.BadRequest(new { error = "last owner" });

        member.Role = request.Role;
        await db.SaveChangesAsync(ct);
        // #172: the affected member hears about it on their own devices
        if (userId != me)
        {
            await push.NotifyMemberRoleChangedAsync(userId, request.SpaceName, request.Role, ct);
        }
        return Results.Ok();
    }

    private static async Task<IResult> RemoveMember(string spaceId, Guid userId, string? spaceName, AppDbContext db, PushNotifier push, HttpContext http, CancellationToken ct)
    {
        var me = http.GetUserId();
        var myRole = (await db.SpaceMembers.FirstOrDefaultAsync(m => m.SpaceId == spaceId && m.UserId == me, ct))?.Role;
        var removingSelf = userId == me;
        if (myRole is null || (!removingSelf && !SpaceRoles.IsOwner(myRole))) return Results.Forbid();
        var member = await db.SpaceMembers.FirstOrDefaultAsync(m => m.SpaceId == spaceId && m.UserId == userId, ct);
        if (member is null) return Results.Ok();
        await RemoveMembershipAsync(db, spaceId, userId, member, ct);
        // #172/#173: being removed reaches the victim's devices as a
        // notification carrying who did it; a self-leave stays silent
        if (!removingSelf) await NotifyRemovedAsync(db, push, userId, spaceName, me, ct);
        return Results.Ok();
    }

    private static async Task RemoveMembershipAsync(AppDbContext db, string spaceId, Guid userId, SpaceMember member, CancellationToken ct)
    {
        db.SpaceMembers.Remove(member);
        // the leaver's attached bank accounts freeze in this space:
        // shared history stays readable, new data stops flowing
        await Accounts.AccountEndpoints.ArchiveLinksOnLeaveAsync(db, spaceId, userId);
        // never leave a space ownerless: promote the longest-standing
        // remaining member (deterministic by user id) when the last
        // owner walks out
        if (SpaceRoles.IsOwner(member.Role) && !await HasAnotherOwner(db, spaceId, userId))
        {
            var successor = await db.SpaceMembers
                .Where(m => m.SpaceId == spaceId && m.UserId != userId)
                .OrderBy(m => m.UserId)
                .FirstOrDefaultAsync(ct);
            if (successor is not null) successor.Role = SpaceRoles.Owner;
        }
        await db.SaveChangesAsync(ct);
    }

    /// <summary>the removal push — the name travels with the request (spaces
    /// keep no server-side name) and is capped like the invite validator caps it</summary>
    private static async Task NotifyRemovedAsync(AppDbContext db, PushNotifier push, Guid userId, string? spaceName, Guid actorId, CancellationToken ct)
    {
        var cappedName = spaceName is { Length: > 200 } ? spaceName[..200] : spaceName;
        await push.NotifyMemberRemovedAsync(userId, cappedName, await NameOf(db, actorId, ct), ct);
    }

    private static async Task<bool> HasAnotherOwner(AppDbContext db, string spaceId, Guid excludingUserId) =>
        await db.SpaceMembers.AnyAsync(m => m.SpaceId == spaceId && m.UserId != excludingUserId && m.Role == SpaceRoles.Owner);

    private static async Task<string?> NameOf(AppDbContext db, Guid userId, CancellationToken ct) =>
        (await db.Users.FindAsync([userId], ct))?.DisplayName;
}
