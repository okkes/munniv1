using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using System.Text.RegularExpressions;
using Munni.Api.Accounts;
using Munni.Api.Data;
using Munni.Api.Sync;

namespace Munni.Api.GoCardless;

/// <summary>
/// Turns GoCardless account/transaction data into sync ops — the server
/// acting as one more device, in the shared-accounts shape: raw facts go
/// once into the account's FEED space, the requisition's target space
/// gets the predicted overlay (txMeta) plus the attachment mirror.
/// Deterministic op/entity ids make every ingest idempotent and match
/// the client-side importer, so cross-source imports collapse into the
/// same rows.
/// </summary>
public sealed partial class GcIngest(AppDbContext db)
{
    public async Task<int> IngestAccountAsync(
        Space space,
        GcLinkedAccount linked,
        GcAccountDetails details,
        IReadOnlyList<GcBalance> balances,
        IReadOnlyList<GcTransaction> transactions,
        IReadOnlyList<GcTransaction>? pending = null)
    {
        var feedSpace = await EnsureFeedAsync(linked, space.Id);

        var accountOps = new List<SyncOpDto>();
        var feedOps = new List<SyncOpDto>();
        var spaceOps = new List<SyncOpDto>();
        var counter = 0;
        string NextHlc() => ServerHlc.Now(counter++);

        // account row in the feed (create or refresh balance — raw bank truth)
        var accountFields = await BuildAccountFieldsAsync(feedSpace.Id, linked, details, balances);
        // minute-grained seed: rate-budgeted accounts sync several times a
        // day and each fetch must refresh lastSyncedAt (a daily seed would
        // dedupe the later ones away)
        accountOps.Add(NewOp(feedSpace.Id, "account", linked.AccountEntityId, accountFields, NextHlc(), $"acct:{linked.GcAccountId}:{DateTime.UtcNow:yyyy-MM-ddTHH:mm}"));

        // attachment mirror so offline devices render the link
        spaceOps.Add(NewOp(space.Id, "accountLink", ImportIds.AccountLinkId(space.Id, feedSpace.Id), new Dictionary<string, JsonElement>
        {
            ["feedSpaceId"] = Json(feedSpace.Id),
            ["accountId"] = Json(linked.AccountEntityId),
        }, NextHlc(), $"gclink:{space.Id}:{feedSpace.Id}"));

        foreach (var tx in transactions) AddBookedOps(space.Id, feedSpace.Id, linked, tx, feedOps, spaceOps, NextHlc);

        await MirrorPendingAsync(linked, feedSpace.Id, pending ?? [], feedOps, NextHlc);

        var writer = new SyncWriter(db);
        await writer.ApplyAsync(feedSpace, null, accountOps);
        // returns NEW raw transactions only (account/overlay refresh not counted)
        var (_, accepted) = await writer.ApplyAsync(feedSpace, null, feedOps);
        await writer.ApplyAsync(space, null, spaceOps);
        return accepted;
    }

    /// <summary>One booked bank transaction → raw feed op + the target space's predicted overlay.</summary>
    private static void AddBookedOps(
        string spaceId,
        string feedSpaceId,
        GcLinkedAccount linked,
        GcTransaction tx,
        List<SyncOpDto> feedOps,
        List<SyncOpDto> spaceOps,
        Func<string> nextHlc)
    {
        var reference = tx.TransactionId ?? tx.InternalTransactionId;
        if (reference is null || tx.BookingDate is null) return;
        var cents = ToCents(tx.TransactionAmount.Amount);
        var direction = cents < 0 ? "debit" : "credit";
        var counterparty = CleanBankText(cents < 0 ? tx.CreditorName : tx.DebtorName);
        var counterIban = cents < 0 ? tx.CreditorAccount?.Iban : tx.DebtorAccount?.Iban;
        var description = CleanBankText(tx.RemittanceInformationUnstructured) ?? "";
        var entityId = ImportIds.TransactionId(linked.Iban, reference);

        // raw half: no opinion, just the bank's facts
        var rawFields = new Dictionary<string, JsonElement>
        {
            ["accountId"] = Json(linked.AccountEntityId),
            ["date"] = Json(tx.BookingDate),
            ["amountCents"] = Json(cents),
            ["currency"] = Json(tx.TransactionAmount.Currency),
            ["merchant"] = Json(counterparty ?? Truncate(description, 40)),
            ["description"] = Json(description),
            ["importRef"] = Json(reference),
        };
        // the other side's account number, when the bank names it —
        // clients surface it and join it to known accounts (user request)
        if (!string.IsNullOrWhiteSpace(counterIban)) rawFields["counterIban"] = Json(ImportIds.Normalize(counterIban));
        // op id derived from the entity id: re-fetching the same tx is a no-op
        feedOps.Add(NewOp(feedSpaceId, "transaction", entityId, rawFields, nextHlc(), $"gc:{entityId}"));

        // the target space's starting opinion (kept server-side for UX
        // parity — devices and members refine it from here by LWW)
        var predicted = KeywordPredictor.Predict($"{counterparty} {description}", direction);
        var metaFields = new Dictionary<string, JsonElement>
        {
            ["txId"] = Json(entityId),
            ["catId"] = Json(predicted?.CatId ?? "uncategorized"),
            ["txType"] = Json(predicted?.TxType ?? (direction == "credit" ? "income" : "expense")),
            ["needsReview"] = Json(predicted is null ? 1 : 0),
        };
        spaceOps.Add(NewOp(spaceId, "txMeta", ImportIds.TxMetaId(spaceId, entityId), metaFields, nextHlc(), $"gcmeta:{spaceId}:{entityId}"));
    }

    /// <summary>
    /// Pending (reserved) charges: mirrored with a pending flag so the user
    /// sees money that is spoken for (user request). No overlay and no
    /// review — the booked twin replaces them later. Rows that left the
    /// bank's pending list get tombstoned.
    /// </summary>
    private async Task MirrorPendingAsync(
        GcLinkedAccount linked,
        string feedSpaceId,
        IReadOnlyList<GcTransaction> pending,
        List<SyncOpDto> feedOps,
        Func<string> nextHlc)
    {
        var currentPending = new HashSet<string>();
        foreach (var tx in pending)
        {
            var reference = tx.TransactionId ?? tx.InternalTransactionId;
            var date = tx.BookingDate ?? tx.ValueDate;
            if (reference is null || date is null) continue;
            var cents = ToCents(tx.TransactionAmount.Amount);
            var counterparty = CleanBankText(cents < 0 ? tx.CreditorName : tx.DebtorName);
            var description = CleanBankText(tx.RemittanceInformationUnstructured) ?? "";
            // 'pending:'-prefixed id: the booked twin gets its own row, so a
            // pending row is only ever removed, never mutated into booked
            var entityId = ImportIds.TransactionId(linked.Iban, $"pending:{reference}");
            currentPending.Add(entityId);
            var pendingFields = new Dictionary<string, JsonElement>
            {
                ["accountId"] = Json(linked.AccountEntityId),
                ["date"] = Json(date),
                ["amountCents"] = Json(cents),
                ["currency"] = Json(tx.TransactionAmount.Currency),
                ["merchant"] = Json(counterparty ?? Truncate(description, 40)),
                ["description"] = Json(description),
                ["pending"] = Json(1),
            };
            // content-derived op seed: a pending amount update re-emits
            feedOps.Add(NewOp(feedSpaceId, "transaction", entityId, pendingFields, nextHlc(), $"gcpend:{entityId}:{date}:{cents}"));
        }
        var tracked = await db.GcPendingTxs.Where(p => p.GcAccountId == linked.GcAccountId).ToListAsync();
        foreach (var stale in tracked.Where(p => !currentPending.Contains(p.EntityId)))
        {
            feedOps.Add(new SyncOpDto(
                ImportIds.OpId($"gcpendrm:{stale.EntityId}:{DateTime.UtcNow.Ticks}"),
                feedSpaceId, "transaction", stale.EntityId, new Dictionary<string, JsonElement>(), nextHlc(), Deleted: true));
            db.GcPendingTxs.Remove(stale);
        }
        var trackedIds = tracked.Select(p => p.EntityId).ToHashSet();
        foreach (var id in currentPending.Where(id => !trackedIds.Contains(id)))
            db.GcPendingTxs.Add(new GcPendingTx { GcAccountId = linked.GcAccountId, EntityId = id });
    }

    /// <summary>The feed account row's fields: raw bank truth plus the logo hint.</summary>
    private async Task<Dictionary<string, JsonElement>> BuildAccountFieldsAsync(
        string feedSpaceId, GcLinkedAccount linked, GcAccountDetails details, IReadOnlyList<GcBalance> balances)
    {
        var balance = balances.FirstOrDefault(b => b.BalanceType is "closingBooked" or "interimBooked")
                      ?? (balances.Count > 0 ? balances[0] : null);
        var requisition = await db.GcRequisitions.FindAsync(linked.RequisitionId);
        // wallet accounts (PayPal…) hold a pseudo reference, not an IBAN —
        // they name themselves after the institution and skip the iban field
        var isRealIban = !linked.Iban.StartsWith("GC:", StringComparison.OrdinalIgnoreCase);
        var fallbackName = isRealIban
            ? $"Bank · {linked.Iban[^4..]}"
            : InstitutionDisplayName(requisition?.InstitutionId) ?? details.OwnerName ?? "Wallet";
        var fields = new Dictionary<string, JsonElement>
        {
            ["type"] = Json("checking"),
            ["source"] = Json("gocardless"),
            ["currency"] = Json(details.Currency ?? linked.Currency),
        };
        // the bank's display name seeds the row once; after that the field
        // belongs to the user (re-asserting it each fetch stamped a fresh
        // server HLC and silently clobbered renames made in the app)
        var exists = await db.EntityRows.AnyAsync(r =>
            r.SpaceId == feedSpaceId && r.Entity == "account" && r.EntityId == linked.AccountEntityId);
        if (!exists) fields["name"] = Json(details.Name ?? fallbackName);
        if (isRealIban) fields["iban"] = Json(linked.Iban);
        // the institution id lets clients show the real bank logo
        if (requisition is not null) fields["bankId"] = Json(requisition.InstitutionId);
        if (balance is not null)
        {
            fields["balanceCents"] = Json(ToCents(balance.BalanceAmount.Amount));
            fields["balanceAsOf"] = Json(DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd"));
        }
        // every device shows when this account last heard from the bank
        fields["lastSyncedAt"] = Json(DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"));
        return fields;
    }

    /// <summary>
    /// Feed registry + owner membership + server-side attachment for a
    /// GoCardless-linked account (the owning flow that may create feeds).
    /// </summary>
    private async Task<Space> EnsureFeedAsync(GcLinkedAccount linked, string targetSpaceId)
    {
        var feedId = ImportIds.FeedSpaceId(linked.Iban);
        var requisition = await db.GcRequisitions.FindAsync(linked.RequisitionId)
            ?? throw new InvalidOperationException($"requisition {linked.RequisitionId} missing");
        var ownerId = requisition.UserId;

        if (await db.FeedSpaces.FindAsync(feedId) is null)
            db.FeedSpaces.Add(new FeedSpace { Id = feedId, OwnerUserId = ownerId, AccountRef = ImportIds.Normalize(linked.Iban) });

        var feedSpace = await db.Spaces.FindAsync(feedId);
        if (feedSpace is null)
        {
            feedSpace = new Space { Id = feedId };
            db.Spaces.Add(feedSpace);
        }
        if (!await db.SpaceMembers.AnyAsync(m => m.SpaceId == feedId && m.UserId == ownerId))
            db.SpaceMembers.Add(new SpaceMember { SpaceId = feedId, UserId = ownerId, Role = Social.SpaceRoles.Owner });

        if (!await db.SpaceAccountLinks.AnyAsync(l => l.SpaceId == targetSpaceId && l.FeedSpaceId == feedId && l.AccountId == linked.AccountEntityId))
        {
            db.SpaceAccountLinks.Add(new SpaceAccountLink
            {
                Id = Guid.NewGuid(),
                SpaceId = targetSpaceId,
                FeedSpaceId = feedId,
                AccountId = linked.AccountEntityId,
                AttachedBy = ownerId,
            });
        }
        await db.SaveChangesAsync();
        return feedSpace;
    }

    /// <summary>"PAYPAL_PPLXLULL" → "Paypal" — good enough when details carry no name</summary>
    private static string? InstitutionDisplayName(string? institutionId)
    {
        var brand = institutionId?.Split('_')[0];
        if (string.IsNullOrEmpty(brand)) return null;
        return char.ToUpperInvariant(brand[0]) + brand[1..].ToLowerInvariant();
    }

    private static SyncOpDto NewOp(string spaceId, string entity, string entityId, Dictionary<string, JsonElement> fields, string hlc, string opSeed) =>
        new(ImportIds.OpId(opSeed), spaceId, entity, entityId, fields, hlc);

    private static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);

    private static int ToCents(string amount) => (int)Math.Round(decimal.Parse(amount, System.Globalization.CultureInfo.InvariantCulture) * 100);

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];

    [GeneratedRegex(@"<br\s*/?>", RegexOptions.IgnoreCase)]
    private static partial Regex BrTagRegex();

    [GeneratedRegex(@"</?[a-zA-Z][^>]*>")]
    private static partial Regex HtmlTagRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();

    /// <summary>ING et al. embed literal &lt;br&gt; separators in remittance text.</summary>
    private static string? CleanBankText(string? text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        var cleaned = BrTagRegex().Replace(text, " · ");
        cleaned = HtmlTagRegex().Replace(cleaned, " ");
        return WhitespaceRegex().Replace(cleaned, " ").Trim();
    }
}
