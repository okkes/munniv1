using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Munni.Api.Accounts;
using Munni.Api.Data;
using Munni.Api.GoCardless;
using Munni.Api.ImportWatch;
using Munni.Api.Sync;

namespace Munni.Api.Tests;

public class CamtParserTests
{
    private static string Fixture => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "camt053-sample.xml"));

    [Fact]
    public void Parses_statements_entries_and_closing_balances()
    {
        var statements = CamtParser.Parse(Fixture);
        Assert.Equal(2, statements.Count);

        var main = statements[0];
        Assert.Equal("NL00DEMO0000000100", main.Iban);
        Assert.Equal(339055, main.ClosingBalanceCents);
        Assert.Equal(2, main.Entries.Count);

        var jumbo = main.Entries[0];
        Assert.Equal(-3000, jumbo.AmountCents);
        Assert.Equal("2026-07-04", jumbo.Date);
        Assert.Equal("Jumbo Amsterdam", jumbo.CounterpartyName);
        Assert.Equal("NL00JUMB0000000001", jumbo.CounterpartyIban);
        Assert.Equal("GALLERY-REF-001", jumbo.Ref); // the id-bearing reference
        Assert.Equal("JUMBO 512 AMSTERDAM Betaalautomaat", jumbo.Description);

        var salary = statements[1].Entries[0];
        Assert.Equal(220000, salary.AmountCents); // CRDT stays positive
        Assert.Equal("Werkgever BV", salary.CounterpartyName);
    }

    [Fact]
    public void Refuses_non_camt_documents()
    {
        Assert.ThrowsAny<Exception>(() => CamtParser.Parse("<html>nope</html>"));
        Assert.ThrowsAny<Exception>(() => CamtParser.Parse("not xml at all"));
    }
}

public class WatchFolderServiceTests
{
    private static string Fixture => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "camt053-sample.xml"));

    private static AppDbContext Db(string name)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(name).Options;
        return new AppDbContext(options);
    }

    [Fact]
    public async Task Ingests_a_file_as_owned_feeds_with_client_identical_ids()
    {
        using var db = Db($"watch-{Guid.NewGuid():N}");
        var (accepted, feedIds) = await WatchFolderService.IngestFileAsync(db, "watch-owner", Fixture);
        Assert.Equal(3, accepted); // 2 + 1 entries across the two statements
        Assert.Equal(2, feedIds.Count);

        // the feed belongs to the configured owner, membership included
        var owner = await db.Users.SingleAsync(u => u.Sub == "watch-owner");
        var feedId = ImportIds.FeedSpaceId("NL00DEMO0000000100");
        Assert.Equal(owner.Id, (await db.FeedSpaces.FindAsync(feedId))!.OwnerUserId);
        Assert.True(await db.SpaceMembers.AnyAsync(m => m.SpaceId == feedId && m.UserId == owner.Id));

        // ids match what a device import of the same file derives
        var txId = ImportIds.TransactionId("NL00DEMO0000000100", "GALLERY-REF-001");
        var row = await db.EntityRows.FindAsync(feedId, "transaction", txId);
        Assert.NotNull(row);
        Assert.Contains("\"counterIban\":\"NL00JUMB0000000001\"", row!.DataJson);
        // the account row carries the closing balance
        var acct = await db.EntityRows.FindAsync(feedId, "account", ImportIds.AccountId("NL00DEMO0000000100"));
        Assert.Contains("\"balanceCents\":339055", acct!.DataJson);

        // dropping the same file again is a no-op
        var (again, _) = await WatchFolderService.IngestFileAsync(db, "watch-owner", Fixture);
        Assert.Equal(0, again);
    }

    [Fact]
    public async Task Never_writes_into_a_feed_owned_by_someone_else()
    {
        using var db = Db($"watch-{Guid.NewGuid():N}");
        var stranger = new User { Id = Guid.NewGuid(), Sub = "stranger" };
        db.Users.Add(stranger);
        db.FeedSpaces.Add(new FeedSpace
        {
            Id = ImportIds.FeedSpaceId("NL00DEMO0000000100"),
            OwnerUserId = stranger.Id,
            AccountRef = "NL00DEMO0000000100",
        });
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            WatchFolderService.IngestFileAsync(db, "watch-owner", Fixture));
    }

    [Fact]
    public async Task Processes_the_folder_moving_files_to_processed_or_failed()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"munni-watch-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        try
        {
            await File.WriteAllTextAsync(Path.Combine(dir, "statement.xml"), Fixture);
            await File.WriteAllTextAsync(Path.Combine(dir, "broken.xml"), "<html>nope</html>");

            var dbName = $"watch-{Guid.NewGuid():N}";
            var services = new ServiceCollection();
            services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase(dbName));
            services.AddSingleton<SpaceEventBroadcaster>();
            var provider = services.BuildServiceProvider();

            var config = new ConfigurationBuilder().Build();
            var service = new WatchFolderService(
                provider.GetRequiredService<IServiceScopeFactory>(), config, NullLogger<WatchFolderService>.Instance);
            await service.ProcessOnceAsync(dir, "watch-owner", CancellationToken.None);

            Assert.True(File.Exists(Path.Combine(dir, "processed", "statement.xml")));
            Assert.True(File.Exists(Path.Combine(dir, "failed", "broken.xml")));
            Assert.Empty(Directory.EnumerateFiles(dir, "*.xml", SearchOption.TopDirectoryOnly));

            using var db = Db(dbName);
            Assert.True(await db.EntityRows.AnyAsync(r => r.Entity == "transaction"));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }
}
