using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Munni.Api.Auth;
using Munni.Api.Data;
using Munni.Api.Validation;

namespace Munni.Api.Splits;

public sealed record SplitShareDto(Guid UserId, long Cents);
public sealed record SplitMemberDto(Guid UserId, string Role, string? DisplayName, bool IsMe);
public sealed record SplitEntryDto(
    string Id, string Kind, Guid PaidByUserId, string Description, long AmountCents, string Date,
    List<SplitShareDto> Shares,
    /// <summary>the adder's private backlink — only serialized for them</summary>
    string? SourceTxId,
    Guid CreatedBy);
public sealed record SplitSummaryDto(string Id, string Name, string Currency, string Status, string Role, string? AttachedSpaceId, string? AttachedEventId, int MemberCount, int EntryCount);
public sealed record SplitDetailDto(string Id, string Name, string Currency, string Status, string Role, string? AttachedSpaceId, string? AttachedEventId, List<SplitMemberDto> Members, List<SplitEntryDto> Entries);

public sealed record CreateSplitRequest(string Id, string Name, string Currency, string? SpaceId);
public sealed record AcceptInviteRequest(string? SpaceId);
public sealed record AttachRequest(string? SpaceId, string? EventId);
public sealed record AddEntryRequest(string Id, string Kind, Guid? PaidByUserId, string Description, long AmountCents, string Date, List<SplitShareDto>? Shares, string? SourceTxId);

/// <summary>
/// Split sessions (settleup-splits design, SP1): membership is the ONLY
/// authorization boundary — a split member sees the split and nothing
/// else, a space membership grants nothing here. Online-only, server-
/// resident by design.
/// </summary>
public static class SplitsEndpoints
{
    public static void MapSplits(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/splits").RequireAuthorization().WithSafeRouteParams();
        group.MapGet("", ListSplits);
        group.MapPost("", CreateSplit);
        group.MapGet("/{splitId}", GetSplit);
        group.MapPost("/{splitId}/entries", AddEntry);
        group.MapDelete("/{splitId}/entries/{entryId}", DeleteEntry);
        // SP3: share-link invites — the ONLY way in besides creating.
        // Minting/accepting reach other people → the strict social limiter
        group.MapPost("/{splitId}/invites", MintInvite).RequireRateLimiting(Social.SocialEndpoints.MutationsPolicy);
        group.MapGet("/invites/{token}", PeekInvite);
        group.MapPost("/invites/{token}/accept", AcceptInvite).RequireRateLimiting(Social.SocialEndpoints.MutationsPolicy);
        // SP4: only the owner closes the session (decision Q3)
        group.MapPost("/{splitId}/close", CloseSplit);
        // SP5: (re)wire MY OWN attachment — space and/or event
        group.MapPost("/{splitId}/attach", Attach);
    }

    /// <summary>per-member wiring: the caller updates only THEIR membership
    /// row; the server stores the ids blindly — they are meaningful only
    /// inside the member's own local database</summary>
    private static async Task<IResult> Attach(string splitId, AttachRequest request, AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        var (split, membership) = await MemberGateAsync(db, splitId, me);
        if (split is null || membership is null) return Results.NotFound();
        if (request.SpaceId is not null) membership.AttachedSpaceId = request.SpaceId;
        membership.AttachedEventId = request.EventId; // null clears the link
        await db.SaveChangesAsync();
        return Results.Ok(new { spaceId = membership.AttachedSpaceId, eventId = membership.AttachedEventId });
    }

    /// <summary>closing locks the ledger: no new entries, no new invites —
    /// the closed state simply fails the Status=="open" guards everywhere</summary>
    private static async Task<IResult> CloseSplit(string splitId, AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        var (split, membership) = await MemberGateAsync(db, splitId, me);
        if (split is null || membership is null) return Results.NotFound();
        if (membership.Role != "owner") return Results.Forbid();
        if (split.Status != "settled")
        {
            split.Status = "settled";
            db.SplitInvites.RemoveRange(await db.SplitInvites.Where(i => i.SplitId == splitId).ToListAsync());
            await db.SaveChangesAsync();
        }
        return Results.Ok(new { id = splitId, status = split.Status });
    }

    /// <summary>any member can mint; a fresh link retires the previous one
    /// (one active link per split keeps revocation trivial)</summary>
    private static async Task<IResult> MintInvite(string splitId, AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        var (split, membership) = await MemberGateAsync(db, splitId, me);
        if (split is null || membership is null) return Results.NotFound();
        if (split.Status != "open") return Results.BadRequest(new { error = "split settled" });
        db.SplitInvites.RemoveRange(await db.SplitInvites.Where(i => i.SplitId == splitId).ToListAsync());
        var invite = new SplitInvite
        {
            Token = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24))
                .Replace('+', '-').Replace('/', '_').TrimEnd('='),
            SplitId = splitId,
            CreatedBy = me,
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
        };
        db.SplitInvites.Add(invite);
        await db.SaveChangesAsync();
        return Results.Ok(new { token = invite.Token, expiresAt = invite.ExpiresAt });
    }

    /// <summary>the join screen shows ONLY the split name + inviter (design:
    /// an invitee learns nothing else); invalid/expired tokens 404</summary>
    private static async Task<IResult> PeekInvite(string token, AppDbContext db)
    {
        var found = await LiveInviteAsync(db, token);
        if (found is null) return Results.NotFound();
        var (invite, split) = found.Value;
        var inviter = await db.Users.FindAsync(invite.CreatedBy);
        return Results.Ok(new { splitName = split.Name, currency = split.Currency, inviterName = inviter?.DisplayName });
    }

    private static async Task<IResult> AcceptInvite(string token, AcceptInviteRequest request, AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        var found = await LiveInviteAsync(db, token);
        if (found is null) return Results.NotFound();
        var (invite, split) = found.Value;
        var existing = await db.SplitMembers.FirstOrDefaultAsync(m => m.SplitId == invite.SplitId && m.UserId == me);
        if (existing is not null)
        {
            // idempotent re-join may still (re)pick the attachment
            if (request.SpaceId is not null) existing.AttachedSpaceId = request.SpaceId;
        }
        else
        {
            db.SplitMembers.Add(new SplitMember
            {
                SplitId = invite.SplitId,
                UserId = me,
                Role = "member",
                // per-member attachment: THEIR space, never validated against
                // anyone else's — it's personal wiring the server just stores
                AttachedSpaceId = request.SpaceId,
            });
        }
        await db.SaveChangesAsync();
        return Results.Ok(new { splitId = split.Id });
    }

    private static async Task<(SplitInvite Invite, Split Split)?> LiveInviteAsync(AppDbContext db, string token)
    {
        var invite = await db.SplitInvites.FindAsync(token);
        if (invite is null || invite.ExpiresAt < DateTimeOffset.UtcNow) return null;
        var split = await db.Splits.FindAsync(invite.SplitId);
        if (split is null || split.Status != "open") return null;
        return (invite, split);
    }

    private static async Task<IResult> ListSplits(AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        var memberships = await db.SplitMembers.Where(m => m.UserId == me).ToListAsync();
        var splitIds = memberships.Select(m => m.SplitId).ToList();
        var splits = await db.Splits.Where(s => splitIds.Contains(s.Id)).ToListAsync();
        var memberCounts = await db.SplitMembers.Where(m => splitIds.Contains(m.SplitId))
            .GroupBy(m => m.SplitId).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count);
        var entryCounts = await db.SplitEntries.Where(e => splitIds.Contains(e.SplitId))
            .GroupBy(e => e.SplitId).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count);
        return Results.Ok(splits
            .OrderByDescending(s => s.CreatedAt)
            .Select(s =>
            {
                var membership = memberships.First(m => m.SplitId == s.Id);
                return new SplitSummaryDto(s.Id, s.Name, s.Currency, s.Status, membership.Role,
                    membership.AttachedSpaceId, membership.AttachedEventId,
                    memberCounts.GetValueOrDefault(s.Id), entryCounts.GetValueOrDefault(s.Id));
            })
            .ToList());
    }

    private static async Task<IResult> CreateSplit(CreateSplitRequest request, AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Length > 60)
            return Results.BadRequest(new { error = "invalid name" });
        if (await db.Splits.AnyAsync(s => s.Id == request.Id)) return Results.Ok(new { id = request.Id }); // idempotent
        db.Splits.Add(new Split { Id = request.Id, Name = request.Name.Trim(), Currency = request.Currency, CreatedBy = me });
        db.SplitMembers.Add(new SplitMember { SplitId = request.Id, UserId = me, Role = "owner", AttachedSpaceId = request.SpaceId });
        await db.SaveChangesAsync();
        return Results.Ok(new { id = request.Id });
    }

    private static async Task<IResult> GetSplit(string splitId, AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        var (split, membership) = await MemberGateAsync(db, splitId, me);
        if (split is null || membership is null) return Results.NotFound();
        var members = await db.SplitMembers.Where(m => m.SplitId == splitId).ToListAsync();
        var memberIds = members.Select(m => m.UserId).ToList();
        var names = await db.Users.Where(u => memberIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.DisplayName);
        var entries = await db.SplitEntries.Where(e => e.SplitId == splitId).OrderByDescending(e => e.Date).ToListAsync();
        return Results.Ok(new SplitDetailDto(
            split.Id, split.Name, split.Currency, split.Status, membership.Role, membership.AttachedSpaceId, membership.AttachedEventId,
            members.Select(m => new SplitMemberDto(m.UserId, m.Role, names.GetValueOrDefault(m.UserId), m.UserId == me)).ToList(),
            entries.Select(e => new SplitEntryDto(
                e.Id, e.Kind, e.PaidByUserId, e.Description, e.AmountCents, e.Date,
                JsonSerializer.Deserialize<List<SplitShareDto>>(e.SharesJson) ?? [],
                // the tx backlink is the adder's private wiring (guest-safety)
                SourceTxId: e.CreatedBy == me ? e.SourceTxId : null,
                e.CreatedBy)).ToList()));
    }

    private static async Task<IResult> AddEntry(string splitId, AddEntryRequest request, AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        var (split, membership) = await MemberGateAsync(db, splitId, me);
        if (split is null || membership is null) return Results.NotFound();
        if (split.Status != "open") return Results.BadRequest(new { error = "split settled" });
        if (request.AmountCents <= 0 || string.IsNullOrWhiteSpace(request.Description) || request.Description.Length > 120)
            return Results.BadRequest(new { error = "invalid entry" });
        if (request.Kind is not ("expense" or "settlement")) return Results.BadRequest(new { error = "invalid kind" });
        if (await db.SplitEntries.AnyAsync(e => e.Id == request.Id)) return Results.Ok(new { id = request.Id }); // idempotent

        var members = await db.SplitMembers.Where(m => m.SplitId == splitId).Select(m => m.UserId).ToListAsync();
        var paidBy = request.PaidByUserId ?? me;
        if (!members.Contains(paidBy)) return Results.BadRequest(new { error = "payer not a member" });

        // shares are FROZEN now: custom ones must balance, equal ones are
        // computed over the current member set (design: no drifting history)
        var (shares, shareError) = ResolveShares(request, members);
        if (shareError is not null) return Results.BadRequest(new { error = shareError });

        db.SplitEntries.Add(new SplitEntry
        {
            Id = request.Id,
            SplitId = splitId,
            Kind = request.Kind,
            PaidByUserId = paidBy,
            Description = request.Description.Trim(),
            AmountCents = request.AmountCents,
            Date = request.Date,
            SharesJson = JsonSerializer.Serialize(shares),
            SourceTxId = request.SourceTxId,
            CreatedBy = me,
        });
        await db.SaveChangesAsync();
        return Results.Ok(new { id = request.Id });
    }

    private static (List<SplitShareDto> Shares, string? Error) ResolveShares(AddEntryRequest request, List<Guid> members)
    {
        if (request.Shares is not { Count: > 0 }) return (EqualShares(request.AmountCents, members), null);
        if (request.Shares.Sum(s => s.Cents) != request.AmountCents || request.Shares.Any(s => s.Cents < 0))
            return ([], "shares must add up");
        if (request.Shares.Any(s => !members.Contains(s.UserId)))
            return ([], "share holder not a member");
        return (request.Shares, null);
    }

    private static async Task<IResult> DeleteEntry(string splitId, string entryId, AppDbContext db, HttpContext http)
    {
        var me = http.GetUserId();
        var (split, membership) = await MemberGateAsync(db, splitId, me);
        if (split is null || membership is null) return Results.NotFound();
        var entry = await db.SplitEntries.FirstOrDefaultAsync(e => e.SplitId == splitId && e.Id == entryId);
        if (entry is null) return Results.Ok(); // idempotent
        // only the author or the split owner takes an entry back
        if (entry.CreatedBy != me && membership.Role != "owner") return Results.Forbid();
        db.SplitEntries.Remove(entry);
        await db.SaveChangesAsync();
        return Results.Ok();
    }

    /// <summary>the single authorization gate: split existence is only ever
    /// revealed to members (404 for everyone else, never 403)</summary>
    private static async Task<(Split? Split, SplitMember? Membership)> MemberGateAsync(AppDbContext db, string splitId, Guid userId)
    {
        var membership = await db.SplitMembers.FirstOrDefaultAsync(m => m.SplitId == splitId && m.UserId == userId);
        if (membership is null) return (null, null);
        return (await db.Splits.FindAsync(splitId), membership);
    }

    /// <summary>equal division; remainder cents land on the lowest user ids (deterministic)</summary>
    internal static List<SplitShareDto> EqualShares(long amountCents, List<Guid> members)
    {
        var ordered = members.OrderBy(m => m).ToList();
        var basis = amountCents / ordered.Count;
        var remainder = amountCents % ordered.Count;
        return ordered.Select((userId, index) => new SplitShareDto(userId, basis + (index < remainder ? 1 : 0))).ToList();
    }
}
