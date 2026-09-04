namespace Munni.Api.GoCardless;

/// <summary>
/// When to fetch a linked account: once a day, in the 03:00 hour at the
/// bank's local time (quiet hours, fresh end-of-day books, and 1 call
/// per endpoint per day instead of 4 — far inside GoCardless's budget).
/// The bank's country comes from the IBAN prefix; unknown prefixes fall
/// back to UTC, which only shifts the hour, never the cadence.
/// </summary>
internal static class GcSchedule
{
    internal const int FetchLocalHour = 3;

    // GoCardless coverage (EEA + UK + CH); one canonical zone per country
    private static readonly Dictionary<string, string> ZoneByCountry = new()
    {
        ["AT"] = "Europe/Vienna",
        ["BE"] = "Europe/Brussels",
        ["BG"] = "Europe/Sofia",
        ["CH"] = "Europe/Zurich",
        ["CY"] = "Asia/Nicosia",
        ["CZ"] = "Europe/Prague",
        ["DE"] = "Europe/Berlin",
        ["DK"] = "Europe/Copenhagen",
        ["EE"] = "Europe/Tallinn",
        ["ES"] = "Europe/Madrid",
        ["FI"] = "Europe/Helsinki",
        ["FR"] = "Europe/Paris",
        ["GB"] = "Europe/London",
        ["GR"] = "Europe/Athens",
        ["HR"] = "Europe/Zagreb",
        ["HU"] = "Europe/Budapest",
        ["IE"] = "Europe/Dublin",
        ["IS"] = "Atlantic/Reykjavik",
        ["IT"] = "Europe/Rome",
        ["LI"] = "Europe/Vaduz",
        ["LT"] = "Europe/Vilnius",
        ["LU"] = "Europe/Luxembourg",
        ["LV"] = "Europe/Riga",
        ["MT"] = "Europe/Malta",
        ["NL"] = "Europe/Amsterdam",
        ["NO"] = "Europe/Oslo",
        ["PL"] = "Europe/Warsaw",
        ["PT"] = "Europe/Lisbon",
        ["RO"] = "Europe/Bucharest",
        ["SE"] = "Europe/Stockholm",
        ["SI"] = "Europe/Ljubljana",
        ["SK"] = "Europe/Bratislava",
    };

    internal static TimeZoneInfo ZoneForIban(string iban)
    {
        var country = iban.Length >= 2 ? iban[..2].ToUpperInvariant() : "";
        if (ZoneByCountry.TryGetValue(country, out var zoneId))
        {
            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(zoneId);
            }
            catch (TimeZoneNotFoundException)
            {
                // stripped tz database in the runtime image — UTC fallback
            }
            catch (InvalidTimeZoneException)
            {
                // corrupt zone data — UTC fallback
            }
        }
        return TimeZoneInfo.Utc;
    }

    /// <summary>
    /// Due when never fetched (a fresh link should not wait for tonight),
    /// or when the bank's clock is in the 03:00 hour and the last fetch
    /// is at least 20h old (one fetch per night, DST-shift tolerant).
    /// </summary>
    internal static bool IsDue(string iban, DateTimeOffset? lastFetchAt, DateTimeOffset nowUtc)
    {
        if (lastFetchAt is null) return true;
        var local = TimeZoneInfo.ConvertTime(nowUtc, ZoneForIban(iban));
        if (local.Hour != FetchLocalHour) return false;
        return nowUtc - lastFetchAt.Value > TimeSpan.FromHours(20);
    }

    /// <summary>
    /// Budget-aware cadence (user request: more than one sync a night).
    /// Once the rate headers told us the per-endpoint daily budget, the
    /// day is split into that many evenly spaced fetches — one call kept
    /// in reserve for retries. Unknown budget = the nightly 03:00 window.
    /// </summary>
    internal static bool IsDue(GcLinkedAccount linked, DateTimeOffset nowUtc)
    {
        if (linked.LastFetchAt is null) return true;
        var target = Math.Clamp((linked.DailySuccessLimit ?? 1) - 1, 1, 6);
        if (target <= 1) return IsDue(linked.Iban, linked.LastFetchAt, nowUtc);
        // budget spent: wait for the bank-side reset instead of burning 429s
        if (linked.SuccessRemaining is <= 0 && linked.RateResetAt is { } reset && nowUtc < reset) return false;
        return nowUtc - linked.LastFetchAt.Value >= TimeSpan.FromHours(24.0 / target);
    }
}
