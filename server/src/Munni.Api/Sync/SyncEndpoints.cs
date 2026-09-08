using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Munni.Api.Auth;
using Munni.Api.Data;
using Munni.Api.Validation;

namespace Munni.Api.Sync;

public sealed record PushRequest(string ClientId, List<SyncOpDto> Ops);
public sealed record PushResponse(long LastSeq, int Accepted, int Duplicates);
public sealed record PullResponse(List<SyncOpDto> Ops, long LatestSeq);
public sealed record BootstrapRow(string Entity, string EntityId, bool Deleted, JsonElement Data, Dictionary<string, string> FieldVersions);
public sealed record BootstrapResponse(List<BootstrapRow> Rows, long LatestSeq);

public static class SyncEndpoints
{
    public static void MapSync(this IEndpointRouteBuilder app)
    {
        // fresh devices discover their spaces here before pulling — feeds
        // reachable through attachments/ownership are part of the answer,
        // so real-time sync of shared accounts needs no extra wiring
        app.MapGet("/me/spaces", async (AppDbContext db, HttpContext http) =>
        {
            var userId = http.GetUserId();
            var spaceIds = await db.SpaceMembers.Where(m => m.UserId == userId).Select(m => m.SpaceId).ToListAsync();
            var feeds = await Accounts.FeedAccess.ReachableFeedsAsync(db, userId);
            return Results.Ok(spaceIds.Union(feeds).ToList());
        }).RequireAuthorization();

        // near-real-time change stream: emits {"spaceId":…} whenever one of
        // the caller's spaces accepted new ops (push or bank ingest)
        app.MapGet("/sync/events", StreamEvents).RequireAuthorization();

        var group = app.MapGroup("/sync/{spaceId}").RequireAuthorization().WithSafeRouteParams();
        group.MapPost("/push", Push).WithValidation<PushRequest>();
        group.MapGet("/pull", Pull);
        group.MapGet("/bootstrap", Bootstrap);
    }

    private static async Task<IResult> Push(string spaceId, PushRequest request, AppDbContext db, SpaceEventBroadcaster events, HttpContext http)
    {
        var userId = http.GetUserId();
        var space = await db.Spaces.FindAsync(spaceId);
        if (space is null)
        {
            // deterministic (uuidv5) feed ids are guessable from an IBAN —
            // feeds are born only via POST /feeds (security review S1)
            if (Accounts.FeedAccess.IsFeedShaped(spaceId))
                return Results.Forbid();
            // first push creates the space with the pusher as owner
            space = new Space { Id = spaceId };
            db.Spaces.Add(space);
            db.SpaceMembers.Add(new SpaceMember { SpaceId = spaceId, UserId = userId, Role = Social.SpaceRoles.Owner });
        }
        else
        {
            var membership = await db.SpaceMembers.FirstOrDefaultAsync(m => m.SpaceId == spaceId && m.UserId == userId);
            // readers may pull but never push
            if (membership is null || !Social.SpaceRoles.CanWrite(membership.Role)) return Results.Forbid();
        }

        var writer = new SyncWriter(db);
        var (lastSeq, accepted) = await writer.ApplyAsync(space, userId, request.Ops);
        await db.SaveChangesAsync();
        if (accepted > 0) events.Publish(spaceId); // wake the other devices/members
        return Results.Ok(new PushResponse(lastSeq, accepted, request.Ops.Count - accepted));
    }

    private static async Task<IResult> Pull(string spaceId, long since, AppDbContext db, HttpContext http)
    {
        var cap = long.MaxValue;
        var member = await RequireMember(spaceId, db, http);
        if (member is not null)
        {
            // not a member — attachments may still derive (possibly
            // archive-capped) read access to a feed space
            var feedCap = await Accounts.FeedAccess.ReadCapAsync(db, http.GetUserId(), spaceId);
            if (feedCap is null) return member;
            cap = feedCap.Value;
        }

        var space = await db.Spaces.FindAsync(spaceId);
        var ops = await db.SyncOps
            .Where(o => o.SpaceId == spaceId && o.Seq > since && o.Seq <= cap)
            .OrderBy(o => o.Seq)
            .Take(1000)
            .ToListAsync();
        var dtos = ops.Select(o => new SyncOpDto(
            o.OpId, o.SpaceId, o.Entity, o.EntityId,
            JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(o.PayloadJson) ?? new(),
            o.Hlc, o.Deleted)).ToList();
        // archived readers must not chase a cursor beyond their cap
        return Results.Ok(new PullResponse(dtos, Math.Min(space?.LastSeq ?? 0, cap)));
    }

    private static async Task<IResult> Bootstrap(string spaceId, AppDbContext db, HttpContext http)
    {
        var member = await RequireMember(spaceId, db, http);
        if (member is not null)
        {
            // feeds: full snapshot only with UNCAPPED access — the
            // materialized rows can't be filtered by seq, so archived
            // readers use capped pulls from 0 instead
            var feedCap = await Accounts.FeedAccess.ReadCapAsync(db, http.GetUserId(), spaceId);
            if (feedCap != long.MaxValue) return member;
        }

        var space = await db.Spaces.FindAsync(spaceId);
        var rows = await db.EntityRows.Where(r => r.SpaceId == spaceId).ToListAsync();
        var dtos = rows.Select(r => new BootstrapRow(
            r.Entity, r.EntityId, r.Deleted,
            JsonSerializer.Deserialize<JsonElement>(r.DataJson),
            JsonSerializer.Deserialize<Dictionary<string, string>>(r.FieldVersionsJson) ?? new())).ToList();
        return Results.Ok(new BootstrapResponse(dtos, space?.LastSeq ?? 0));
    }

    private static async Task<IResult?> RequireMember(string spaceId, AppDbContext db, HttpContext http)
    {
        var userId = http.GetUserId();
        var isMember = await db.SpaceMembers.AnyAsync(m => m.SpaceId == spaceId && m.UserId == userId);
        return isMember ? null : Results.Forbid();
    }

    private static async Task StreamEvents(AppDbContext db, SpaceEventBroadcaster events, HttpContext http)
    {
        var userId = http.GetUserId();
        // membership snapshot at connect (incl. feeds reachable through
        // attachments); new invites are picked up when the client
        // reconnects (and the 10s poll covers the gap meanwhile)
        var mySpaces = (await db.SpaceMembers.Where(m => m.UserId == userId).Select(m => m.SpaceId).ToListAsync())
            .Union(await Accounts.FeedAccess.ReachableFeedsAsync(db, userId))
            .ToHashSet();

        http.Response.Headers.ContentType = "text/event-stream";
        http.Response.Headers.CacheControl = "no-cache";
        http.Response.Headers["X-Accel-Buffering"] = "no"; // reverse proxies must not buffer the stream

        var (id, reader) = events.Subscribe();
        try
        {
            await http.Response.WriteAsync(": connected\n\n", http.RequestAborted);
            await http.Response.Body.FlushAsync(http.RequestAborted);
            while (!http.RequestAborted.IsCancellationRequested)
            {
                using var keepalive = CancellationTokenSource.CreateLinkedTokenSource(http.RequestAborted);
                keepalive.CancelAfter(TimeSpan.FromSeconds(25));
                string? spaceId = null;
                try
                {
                    spaceId = await reader.ReadAsync(keepalive.Token);
                }
                catch (OperationCanceledException) when (!http.RequestAborted.IsCancellationRequested)
                {
                    // no events for a while — keepalive comment holds proxies open
                }

                if (spaceId is not null && !mySpaces.Contains(spaceId)) continue;
                var frame = spaceId is null
                    ? ": keepalive\n\n"
                    : $"data: {JsonSerializer.Serialize(new { spaceId })}\n\n";
                await http.Response.WriteAsync(frame, http.RequestAborted);
                await http.Response.Body.FlushAsync(http.RequestAborted);
            }
        }
        catch (OperationCanceledException)
        {
            // client went away — normal for a long-lived stream
        }
        finally
        {
            events.Unsubscribe(id);
        }
    }
}
