using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Munni.Api.Accounts;
using Munni.Api.Data;
using Munni.Api.GoCardless;
using Munni.Api.Sync;

namespace Munni.Api.ImportWatch;

/// <summary>
/// Watch-folder importer (user request): drop CAMT.053 exports — manual
/// downloads, or a personal scraper container's output — into the
/// configured folder and they ingest as raw FEED rows for the configured
/// owner, exactly like a device-side import of the same file would
/// (identical deterministic ids, so both paths dedupe against each
/// other and against GoCardless). Processed files move to `processed/`,
/// broken ones to `failed/`. Spaces attach the resulting account through
/// the normal accounts UI.
/// </summary>
public sealed class WatchFolderService(IServiceScopeFactory scopeFactory, IConfiguration config, ILogger<WatchFolderService> logger) : BackgroundService
{
    /// <summary>poll cadence; tests shrink it</summary>
    internal TimeSpan PollInterval { get; set; } = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var path = config["ImportWatch:Path"];
        var ownerSub = config["ImportWatch:OwnerSub"];
        if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(ownerSub)) return; // feature off
        if (logger.IsEnabled(LogLevel.Information))
            logger.LogInformation("watch-folder importer active on {Path} for {OwnerSub}", path, ownerSub);

        using var timer = new PeriodicTimer(PollInterval);
        do
        {
            try
            {
                await ProcessOnceAsync(path, ownerSub, stoppingToken);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "watch-folder cycle failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    internal async Task ProcessOnceAsync(string path, string ownerSub, CancellationToken ct)
    {
        if (!Directory.Exists(path)) return;
        Directory.CreateDirectory(Path.Combine(path, "processed"));
        Directory.CreateDirectory(Path.Combine(path, "failed"));

        foreach (var file in Directory.EnumerateFiles(path, "*.xml", SearchOption.TopDirectoryOnly))
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            try
            {
                var (accepted, feedIds) = await IngestFileAsync(db, ownerSub, await File.ReadAllTextAsync(file, ct));
                Move(file, Path.Combine(path, "processed"));
                if (logger.IsEnabled(LogLevel.Information))
                    logger.LogInformation("watch-folder: imported {File} — {Accepted} new transactions", Path.GetFileName(file), accepted);
                if (accepted > 0)
                {
                    var events = scope.ServiceProvider.GetRequiredService<SpaceEventBroadcaster>();
                    foreach (var feedId in feedIds) events.Publish(feedId);
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "watch-folder: {File} failed — moved to failed/", Path.GetFileName(file));
                Move(file, Path.Combine(path, "failed"));
            }
        }
    }

    private static void Move(string file, string targetDir)
    {
        var target = Path.Combine(targetDir, Path.GetFileName(file));
        // a re-dropped duplicate name gets a timestamp instead of an exception
        if (File.Exists(target))
            target = Path.Combine(targetDir, $"{Path.GetFileNameWithoutExtension(file)}-{DateTime.UtcNow.Ticks}{Path.GetExtension(file)}");
        File.Move(file, target);
    }

    internal static async Task<(int Accepted, IReadOnlyList<string> FeedIds)> IngestFileAsync(AppDbContext db, string ownerSub, string xml)
    {
        var statements = CamtParser.Parse(xml);
        var owner = await ResolveOwnerAsync(db, ownerSub);

        var accepted = 0;
        var feedIds = new List<string>();
        foreach (var stmt in statements)
        {
            if (string.IsNullOrEmpty(stmt.Iban)) throw new FormatException("statement without IBAN");
            accepted += await IngestStatementAsync(db, owner, stmt);
            feedIds.Add(ImportIds.FeedSpaceId(stmt.Iban));
        }
        return (accepted, feedIds);
    }

    private static async Task<User> ResolveOwnerAsync(AppDbContext db, string ownerSub)
    {
        var owner = await db.Users.FirstOrDefaultAsync(u => u.Sub == ownerSub);
        if (owner is null)
        {
            owner = new User { Id = Guid.NewGuid(), Sub = ownerSub };
            db.Users.Add(owner);
            await db.SaveChangesAsync();
        }
        return owner;
    }

    private static async Task<int> IngestStatementAsync(AppDbContext db, User owner, CamtStatement stmt)
    {
        var iban = ImportIds.Normalize(stmt.Iban);
        var feedId = ImportIds.FeedSpaceId(iban);

        // the feed registry is the squatting defence — never write into
        // someone else's feed from a dropped file
        var feed = await db.FeedSpaces.FindAsync(feedId);
        if (feed is null)
        {
            db.FeedSpaces.Add(new FeedSpace { Id = feedId, OwnerUserId = owner.Id, AccountRef = iban });
        }
        else if (feed.OwnerUserId != owner.Id)
        {
            throw new InvalidOperationException($"feed for {iban} is owned by another user");
        }
        var space = await db.Spaces.FindAsync(feedId);
        if (space is null)
        {
            space = new Space { Id = feedId };
            db.Spaces.Add(space);
        }
        if (!await db.SpaceMembers.AnyAsync(m => m.SpaceId == feedId && m.UserId == owner.Id))
            db.SpaceMembers.Add(new SpaceMember { SpaceId = feedId, UserId = owner.Id, Role = Social.SpaceRoles.Owner });
        await db.SaveChangesAsync();

        var counter = 0;
        string NextHlc() => ServerHlc.Now(counter++);
        var entryOps = stmt.Entries.Select(entry => EntryOp(feedId, iban, entry, NextHlc())).ToList();

        var writer = new SyncWriter(db);
        await writer.ApplyAsync(space, null, [AccountOp(feedId, iban, stmt, NextHlc())]);
        // returns NEW transactions only (the account refresh isn't counted)
        var (_, accepted) = await writer.ApplyAsync(space, null, entryOps);
        await db.SaveChangesAsync();
        return accepted;
    }

    private static SyncOpDto AccountOp(string feedId, string iban, CamtStatement stmt, string hlc)
    {
        var fields = new Dictionary<string, JsonElement>
        {
            ["name"] = Json($"Bank · {iban[^4..]}"),
            ["type"] = Json("checking"),
            ["source"] = Json("camt053"),
            ["currency"] = Json(stmt.Currency),
            ["iban"] = Json(iban),
        };
        if (stmt.ClosingBalanceCents is { } balance)
        {
            fields["balanceCents"] = Json(balance);
            if (stmt.BalanceAsOf is not null) fields["balanceAsOf"] = Json(stmt.BalanceAsOf);
        }
        fields["lastSyncedAt"] = Json(DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"));
        // per-statement seed: a newer statement's balance must not be
        // dropped as an "idempotent retry" of the previous file's op
        var seed = $"camtacct:{iban}:{stmt.BalanceAsOf ?? stmt.ClosingBalanceCents?.ToString() ?? "none"}";
        return new SyncOpDto(ImportIds.OpId(seed), feedId, "account", ImportIds.AccountId(iban), fields, hlc);
    }

    private static SyncOpDto EntryOp(string feedId, string iban, CamtEntry entry, string hlc)
    {
        var entityId = ImportIds.TransactionId(iban, entry.Ref);
        var fields = new Dictionary<string, JsonElement>
        {
            ["accountId"] = Json(ImportIds.AccountId(iban)),
            ["date"] = Json(entry.Date),
            ["amountCents"] = Json(entry.AmountCents),
            ["currency"] = Json(entry.Currency),
            ["merchant"] = Json(entry.CounterpartyName ?? Truncate(entry.Description, 40)),
            ["description"] = Json(entry.Description),
            ["importRef"] = Json(entry.Ref),
        };
        if (!string.IsNullOrWhiteSpace(entry.CounterpartyIban))
            fields["counterIban"] = Json(ImportIds.Normalize(entry.CounterpartyIban));
        // deterministic op id: re-dropping the same file is a no-op
        return new SyncOpDto(ImportIds.OpId($"camt:{entityId}"), feedId, "transaction", entityId, fields, hlc);
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];

    private static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);
}
