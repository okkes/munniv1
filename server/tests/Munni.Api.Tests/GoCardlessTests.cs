using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Munni.Api.Data;
using Munni.Api.GoCardless;
using Munni.Api.Sync;

namespace Munni.Api.Tests;

public class ImportIdsTests
{
    [Fact]
    public void MatchesJsUuidV5Exactly()
    {
        // reference values computed with the JS `uuid` package and the same
        // namespace — cross-source dedupe depends on byte-exact equality
        Assert.Equal("7fd11b1d-fe03-5861-b867-cc94677242a0", ImportIds.AccountId("NL69INGB0123456789"));
        Assert.Equal("897f58a0-87b1-58b3-b18a-1c4ce075f18f", ImportIds.TransactionId("NL69INGB0123456789", "REF-001"));
        Assert.Equal("7a851e04-b799-58c9-8b49-27ca7c6936a7", ImportIds.FeedSpaceId("NL69INGB0123456789"));
        Assert.Equal("6c267a1d-3fe2-58d5-8241-84653d30da87", ImportIds.TxMetaId("space1", "tx1"));
        Assert.Equal("1f2e3617-f88d-5266-aee7-eebe344abdc2", ImportIds.AccountLinkId("space1", "feed1"));
    }

    [Fact]
    public void NormalizesIbanLikeTheClient()
    {
        Assert.Equal(ImportIds.AccountId("nl69 ingb 0123 4567 89"), ImportIds.AccountId("NL69INGB0123456789"));
    }
}

public class KeywordPredictorTests
{
    [Fact]
    public void PredictsDutchGroceryDebit()
    {
        var p = KeywordPredictor.Predict("Albert Heijn 1350 AMSTERDAM", "debit");
        Assert.Equal("groceries", p!.CatId);
        Assert.Equal("expense", p.TxType);
    }

    [Fact]
    public void PredictsSalaryOnlyOnCredit()
    {
        Assert.Equal("salary", KeywordPredictor.Predict("SALARIS JUNI", "credit")!.CatId);
        Assert.NotEqual("salary", KeywordPredictor.Predict("SALARIS JUNI", "debit")?.CatId);
    }

    [Fact]
    public void ReturnsNullWhenNothingMatches()
    {
        Assert.Null(KeywordPredictor.Predict("xyzzy qwerty", "debit"));
    }
}

public class GcIngestTests
{
    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase($"gc_{Guid.NewGuid():N}").Options);

    private static readonly GcAccountDetails Details = new("NL69INGB0123456789", "Betaalrekening", "EUR");
    private static readonly List<GcBalance> Balances = [new(new GcAmount("1234.56", "EUR"), "closingBooked")];
    private static readonly List<GcTransaction> Transactions =
    [
        new("BANKREF-1", null, "2026-07-05", null, new GcAmount("-42.10", "EUR"), "Albert Heijn", null, "AH 1350<br>AMSTERDAM<br>Pasvolgnr 001"),
        new("BANKREF-2", null, "2026-07-04", null, new GcAmount("2200.00", "EUR"), null, "Werkgever BV", "SALARIS JUNI"),
        new("BANKREF-3", null, "2026-07-03", null, new GcAmount("-9.99", "EUR"), "Onbekend XQZ", null, "QWERTY"),
    ];

    private static readonly Guid OwnerId = Guid.NewGuid();
    private static readonly Guid RequisitionId = Guid.NewGuid();
    private static readonly string FeedId = ImportIds.FeedSpaceId("NL69INGB0123456789");

    private static GcLinkedAccount Linked(string spaceId) => new()
    {
        GcAccountId = "gc-acc-1",
        SpaceId = spaceId,
        AccountEntityId = ImportIds.AccountId("NL69INGB0123456789"),
        Iban = "NL69INGB0123456789",
        Currency = "EUR",
        RequisitionId = RequisitionId,
    };

    private static async Task<AppDbContext> SeedDbAsync()
    {
        var db = NewDb();
        db.Spaces.Add(new Space { Id = "s1" });
        db.GcRequisitions.Add(new GcRequisition
        {
            Id = RequisitionId,
            UserId = OwnerId,
            SpaceId = "s1",
            InstitutionId = "ING_INGBNL2A",
            RequisitionId = "gc-req-1",
            Status = "linked",
        });
        await db.SaveChangesAsync();
        return db;
    }

    [Fact]
    public async Task IngestWritesRawIntoTheFeedAndOverlayIntoTheSpace()
    {
        await using var db = await SeedDbAsync();
        var space = await db.Spaces.FindAsync("s1");

        var accepted = await new GcIngest(db).IngestAccountAsync(space!, Linked("s1"), Details, Balances, Transactions);
        await db.SaveChangesAsync();
        Assert.Equal(3, accepted); // new RAW transactions only

        // the feed exists: registry entry, owner membership, attachment to s1
        Assert.NotNull(await db.FeedSpaces.FindAsync(FeedId));
        Assert.True(await db.SpaceMembers.AnyAsync(m => m.SpaceId == FeedId && m.UserId == OwnerId));
        Assert.True(await db.SpaceAccountLinks.AnyAsync(l => l.SpaceId == "s1" && l.FeedSpaceId == FeedId && !l.Archived));

        // account row lives in the FEED with the dated raw balance
        var account = await db.EntityRows.FindAsync(FeedId, "account", ImportIds.AccountId("NL69INGB0123456789"));
        var accountData = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(account!.DataJson)!;
        Assert.Equal(123456, accountData["balanceCents"].GetInt32());
        Assert.Equal("gocardless", accountData["source"].GetString());
        Assert.True(accountData.ContainsKey("balanceAsOf"));

        // raw halves carry no opinion; <br> separators are sanitized
        var rawTx = await db.EntityRows.FindAsync(FeedId, "transaction", ImportIds.TransactionId("NL69INGB0123456789", "BANKREF-1"));
        var txData = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(rawTx!.DataJson)!;
        Assert.False(txData.ContainsKey("catId"));
        Assert.Equal("AH 1350 · AMSTERDAM · Pasvolgnr 001", txData["description"].GetString());
        Assert.Equal(0, await db.EntityRows.CountAsync(r => r.SpaceId == "s1" && r.Entity == "transaction"));

        // the target space holds the predicted overlay + the link mirror
        var txId = ImportIds.TransactionId("NL69INGB0123456789", "BANKREF-1");
        var meta = await db.EntityRows.FindAsync("s1", "txMeta", ImportIds.TxMetaId("s1", txId));
        var metaData = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(meta!.DataJson)!;
        Assert.Equal("groceries", metaData["catId"].GetString());
        Assert.Equal(0, metaData["needsReview"].GetInt32());

        var unknownId = ImportIds.TransactionId("NL69INGB0123456789", "BANKREF-3");
        var unknownMeta = await db.EntityRows.FindAsync("s1", "txMeta", ImportIds.TxMetaId("s1", unknownId));
        var unknownData = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(unknownMeta!.DataJson)!;
        Assert.Equal("uncategorized", unknownData["catId"].GetString());
        Assert.Equal(1, unknownData["needsReview"].GetInt32());

        Assert.NotNull(await db.EntityRows.FindAsync("s1", "accountLink", ImportIds.AccountLinkId("s1", FeedId)));
    }

    [Fact]
    public async Task RefetchIsIdempotent()
    {
        await using var db = await SeedDbAsync();
        var space = await db.Spaces.FindAsync("s1");

        var ingest = new GcIngest(db);
        var linked = Linked("s1");
        await ingest.IngestAccountAsync(space!, linked, Details, Balances, Transactions);
        await db.SaveChangesAsync();
        var secondRun = await ingest.IngestAccountAsync(space!, linked, Details, Balances, Transactions);
        await db.SaveChangesAsync();

        Assert.Equal(0, secondRun); // deterministic op ids: nothing re-imports
        Assert.Equal(3, await db.EntityRows.CountAsync(r => r.SpaceId == FeedId && r.Entity == "transaction"));
        Assert.Equal(3, await db.EntityRows.CountAsync(r => r.SpaceId == "s1" && r.Entity == "txMeta"));
        Assert.Equal(1, await db.SpaceAccountLinks.CountAsync());
    }

    [Fact]
    public async Task RefetchDoesNotClobberAUserRename()
    {
        await using var db = await SeedDbAsync();
        var space = await db.Spaces.FindAsync("s1");
        var ingest = new GcIngest(db);
        var linked = Linked("s1");
        await ingest.IngestAccountAsync(space!, linked, Details, Balances, Transactions);
        await db.SaveChangesAsync();

        // the user renames the account on their phone; the next fetch runs
        // LATER, so before the fix its fresh server HLC won the name field
        var accountId = ImportIds.AccountId("NL69INGB0123456789");
        var feedSpace = await db.Spaces.FindAsync(FeedId);
        var rename = new SyncOpDto(
            "rename-op-1", FeedId, "account", accountId,
            new Dictionary<string, JsonElement> { ["name"] = JsonSerializer.SerializeToElement("My spending") },
            ServerHlc.Now().Replace(ServerHlc.DeviceId, "phone"));
        await new SyncWriter(db).ApplyAsync(feedSpace!, null, [rename]);
        await db.SaveChangesAsync();

        // drop the recorded account op so the refresh op is not deduped by
        // its minute-grained op id (real fetches run in a later minute)
        db.SyncOps.RemoveRange(db.SyncOps.Where(o => o.SpaceId == FeedId && o.Entity == "account"));
        await db.SaveChangesAsync();

        await ingest.IngestAccountAsync(space!, linked, Details, Balances, Transactions);
        await db.SaveChangesAsync();

        var row = await db.EntityRows.FindAsync(FeedId, "account", accountId);
        var data = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(row!.DataJson)!;
        Assert.Equal("My spending", data["name"].GetString()); // rename survives the refresh
        Assert.Equal(123456, data["balanceCents"].GetInt32()); // raw facts still refreshed
    }
}
