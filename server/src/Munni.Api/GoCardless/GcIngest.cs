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
/// gets the predicted overlay (txMeta). Attaching to a space is the
/// user's explicit step (#204 r2) — ingest never writes links.
/// Deterministic op/entity ids make every ingest idempotent and match
/// the client-side importer, so cross-source imports collapse into the
/// same rows.
/// </summary>
public sealed partial class GcIngest(AppDbContext db, ILogger? logger = null)
{
    public async Task<int> IngestAccountAsync(
        Space space,
        GcLinkedAccount linked,
        GcAccountDetails details,
        IReadOnlyList<GcBalance> balances,
        IReadOnlyList<GcTransaction> transactions,
        IReadOnlyList<GcTransaction>? pending = null,
        GcRequisition? actingConsent = null)
    {
        var feedSpace = await EnsureFeedAsync(linked, actingConsent);

        var accountOps = new List<SyncOpDto>();
        var feedOps = new List<SyncOpDto>();
        var spaceOps = new List<SyncOpDto>();
        var counter = 0;
        string NextHlc() => ServerHlc.Now(counter++);

        // Count both writes the ops and tallies what could be represented
        var written = transactions.Count(tx => AddBookedOps(space.Id, feedSpace.Id, linked, tx, feedOps, spaceOps, NextHlc));
        var dropped = transactions.Count - written;
        // #240: rows without a reference or date used to vanish without a
        // trace — an ASPSP omitting entry_reference lost its whole history
        // and nothing anywhere said so
        if (dropped > 0)
            logger?.LogWarning("gc ingest {Ref}: {Dropped} of {Total} booked rows lack a reference/date and were dropped",
                linked.Iban, dropped, transactions.Count);

        var pendingWritten = await MirrorPendingAsync(linked, feedSpace.Id, pending ?? [], feedOps, NextHlc);
        var pendingDropped = (pending?.Count ?? 0) - pendingWritten;

        // #240 r3: the fetch outcome is a FACT of the account row now —
        // "the bank answered with nothing" must be visible in the app,
        // not only in a server log nobody can reach
        linked.LastFetchReceived = transactions.Count + (pending?.Count ?? 0);
        linked.LastFetchDropped = dropped + pendingDropped;

        // account row in the feed (create or refresh balance — raw bank truth)
        var accountFields = await BuildAccountFieldsAsync(feedSpace.Id, linked, details, balances);
        // minute-grained seed: rate-budgeted accounts sync several times a
        // day and each fetch must refresh lastSyncedAt (a daily seed would
        // dedupe the later ones away)
        accountOps.Add(NewOp(feedSpace.Id, "account", linked.AccountEntityId, accountFields, NextHlc(), $"acct:{linked.GcAccountId}:{DateTime.UtcNow:yyyy-MM-ddTHH:mm}"));

        // #204 r2 (user): connecting NEVER attaches — the account exists
        // globally (the feed + its raw rows); joining a space is the
        // user's explicit step, where they also pick the type and the
        // history gate. The requisition's space stays the RETURN context
        // and the home of the prediction overlays, nothing more.

        var writer = new SyncWriter(db);
        await writer.ApplyAsync(feedSpace, null, accountOps);
        // returns NEW raw transactions only (account/overlay refresh not counted)
        var (_, accepted) = await writer.ApplyAsync(feedSpace, null, feedOps);
        await writer.ApplyAsync(space, null, spaceOps);
        return accepted;
    }

    /// <summary>One booked bank transaction → raw feed op + the target space's predicted overlay.
    /// False = the row lacks an identity or date and cannot be represented.</summary>
    private static bool AddBookedOps(
        string spaceId,
        string feedSpaceId,
        GcLinkedAccount linked,
        GcTransaction tx,
        List<SyncOpDto> feedOps,
        List<SyncOpDto> spaceOps,
        Func<string> nextHlc)
    {
        var reference = tx.TransactionId ?? tx.InternalTransactionId;
        if (reference is null || tx.BookingDate is null) return false;
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
        return true;
    }

    /// <summary>
    /// Pending (reserved) charges: mirrored with a pending flag so the user
    /// sees money that is spoken for (user request). No overlay and no
    /// review — the booked twin replaces them later. Rows that left the
    /// bank's pending list get tombstoned.
    /// </summary>
    private async Task<int> MirrorPendingAsync(
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
        return currentPending.Count;
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
            ["source"] = Json("gocardless"),
            ["currency"] = Json(details.Currency ?? linked.Currency),
        };
        // the bank's display name seeds the row once; after that the field
        // belongs to the user (re-asserting it each fetch stamped a fresh
        // server HLC and silently clobbered renames made in the app).
        // #212 r2: type is seed-only for the same reason — the SPACE owns
        // the account's type (accountLink.type); re-sending 'checking'
        // every fetch kept overwriting the global fallback clients read
        var exists = await db.EntityRows.AnyAsync(r =>
            r.SpaceId == feedSpaceId && r.Entity == "account" && r.EntityId == linked.AccountEntityId);
        if (!exists)
        {
            fields["name"] = Json(details.Name ?? fallbackName);
            fields["type"] = Json("checking");
        }
        if (isRealIban) fields["iban"] = Json(linked.Iban);
        // the institution id lets clients show the real bank logo; the
        // provider names WHO fetches (#176: EB rows read "GoCardless"
        // without it) — re-sent every fetch, so existing rows heal
        if (requisition is not null)
        {
            fields["bankId"] = Json(requisition.InstitutionId);
            fields["provider"] = Json(requisition.Provider);
        }
        if (balance is not null)
        {
            fields["balanceCents"] = Json(ToCents(balance.BalanceAmount.Amount));
            fields["balanceAsOf"] = Json(DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd"));
        }
        // every device shows when this account last heard from the bank
        fields["lastSyncedAt"] = Json(DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"));
        // #240 r3: what that fetch actually carried — "the bank answered
        // with nothing" and "rows could not be stored" become visible
        // facts on the account row instead of invisible server logs
        if (linked.LastFetchReceived is { } received) fields["lastFetchReceived"] = Json(received);
        if (linked.LastFetchDropped is { } droppedRows) fields["lastFetchDropped"] = Json(droppedRows);
        return fields;
    }

    /// <summary>
    /// Feed registry + owner membership + server-side attachment for a
    /// GoCardless-linked account (the owning flow that may create feeds).
    /// #240: the ACTING consent decides who is acting — a completion runs
    /// as the consenting user, a scheduled fetch as the bound consent's
    /// user. A second user's own consent covering an existing IBAN feed
    /// makes them a CO-owner (user ruling: connecting the same bank
    /// account IS full ownership; the IBAN proves it is the same one).
    /// </summary>
    private async Task<Space> EnsureFeedAsync(GcLinkedAccount linked, GcRequisition? actingConsent = null)
    {
        var feedId = ImportIds.FeedSpaceId(linked.Iban);
        var requisition = actingConsent
            ?? await db.GcRequisitions.FindAsync(linked.RequisitionId)
            ?? throw new InvalidOperationException($"requisition {linked.RequisitionId} missing");
        var ownerId = requisition.UserId;
        var wallet = linked.Iban.StartsWith("GC:", StringComparison.OrdinalIgnoreCase);

        var feed = await db.FeedSpaces.FindAsync(feedId);
        if (feed is null)
        {
            db.FeedSpaces.Add(new FeedSpace { Id = feedId, OwnerUserId = ownerId, AccountRef = ImportIds.Normalize(linked.Iban) });
        }
        else if (wallet && feed.OwnerUserId != ownerId)
        {
            // #240: a WALLET (no IBAN) is personal by nature — there is no
            // joint-PayPal the way there is a joint bank account, so the
            // consent that fetches it owns its feed. A stale binding (an
            // old identity's requisition) left the feed "shared with me"
            // for its real owner: /me/feeds omitted it, edit and
            // attach-to-space locked.
            feed.OwnerUserId = ownerId;
        }
        else if (!wallet && feed.OwnerUserId != ownerId
                 && !await db.FeedOwners.AnyAsync(o => o.FeedSpaceId == feedId && o.UserId == ownerId))
        {
            // #240 r3: an IBAN feed someone else connected first — this
            // user's OWN consent covers the same account, so they own it
            // too. The recorded consent lets the fetch binding hand over
            // if the first owner ever deletes theirs.
            db.FeedOwners.Add(new FeedOwner
            {
                FeedSpaceId = feedId,
                UserId = ownerId,
                RequisitionId = requisition.Id,
                GcAccountId = linked.GcAccountId,
            });
        }

        var feedSpace = await db.Spaces.FindAsync(feedId);
        if (feedSpace is null)
        {
            feedSpace = new Space { Id = feedId };
            db.Spaces.Add(feedSpace);
        }
        if (!await db.SpaceMembers.AnyAsync(m => m.SpaceId == feedId && m.UserId == ownerId))
            db.SpaceMembers.Add(new SpaceMember { SpaceId = feedId, UserId = ownerId, Role = Social.SpaceRoles.Owner });

        // #204 r2 (user): no SpaceAccountLink here — connecting creates
        // the GLOBAL account only; the explicit attach endpoint writes
        // the link when the user picks the space, type and history gate
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
