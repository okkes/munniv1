using Munni.Api.GoCardless;

namespace Munni.Api.Tests;

public class GcScheduleTests
{
    [Fact]
    public void Zone_comes_from_the_iban_country_prefix()
    {
        // 15 Jan 12:00 UTC: Amsterdam is UTC+1, London UTC+0, Helsinki UTC+2
        var winterNoonUtc = new DateTimeOffset(2026, 1, 15, 12, 0, 0, TimeSpan.Zero);
        Assert.Equal(13, TimeZoneInfo.ConvertTime(winterNoonUtc, GcSchedule.ZoneForIban("NL69INGB0123456789")).Hour);
        Assert.Equal(12, TimeZoneInfo.ConvertTime(winterNoonUtc, GcSchedule.ZoneForIban("GB33BUKB20201555555555")).Hour);
        Assert.Equal(14, TimeZoneInfo.ConvertTime(winterNoonUtc, GcSchedule.ZoneForIban("FI2112345600000785")).Hour);
    }

    [Fact]
    public void Unknown_or_malformed_prefixes_fall_back_to_utc()
    {
        Assert.Equal(TimeZoneInfo.Utc, GcSchedule.ZoneForIban("XX00UNKNOWN"));
        Assert.Equal(TimeZoneInfo.Utc, GcSchedule.ZoneForIban("Z"));
        Assert.Equal(TimeZoneInfo.Utc, GcSchedule.ZoneForIban(""));
    }

    [Fact]
    public void A_fresh_link_is_due_immediately_whatever_the_hour()
    {
        var afternoonUtc = new DateTimeOffset(2026, 7, 9, 14, 0, 0, TimeSpan.Zero);
        Assert.True(GcSchedule.IsDue("NL69INGB0123456789", null, afternoonUtc));
    }

    [Fact]
    public void Due_only_in_the_3am_bank_local_hour()
    {
        var staleFetch = new DateTimeOffset(2026, 7, 8, 1, 0, 0, TimeSpan.Zero);
        // 9 Jul, Amsterdam is UTC+2 (summer): 01:30 UTC == 03:30 local -> due
        var inWindow = new DateTimeOffset(2026, 7, 9, 1, 30, 0, TimeSpan.Zero);
        Assert.True(GcSchedule.IsDue("NL69INGB0123456789", staleFetch, inWindow));
        // 03:30 UTC == 05:30 local -> outside the window
        var outsideWindow = new DateTimeOffset(2026, 7, 9, 3, 30, 0, TimeSpan.Zero);
        Assert.False(GcSchedule.IsDue("NL69INGB0123456789", staleFetch, outsideWindow));
        // same instant is 03:30 in Reykjavik (UTC+0 year-round): IS is due
        Assert.True(GcSchedule.IsDue("IS140159260076545510", staleFetch, outsideWindow));
    }

    private static GcLinkedAccount Linked(DateTimeOffset? lastFetchAt, int? dailyLimit, int? remaining = null, DateTimeOffset? resetAt = null) => new()
    {
        GcAccountId = "gc-1",
        SpaceId = "s1",
        AccountEntityId = "acct-1",
        Iban = "NL69INGB0123456789",
        Currency = "EUR",
        LastFetchAt = lastFetchAt,
        DailySuccessLimit = dailyLimit,
        SuccessRemaining = remaining,
        RateResetAt = resetAt,
    };

    [Fact]
    public void Known_budget_spreads_fetches_across_the_day()
    {
        // limit 4 → one call in reserve → 3 fetches/day → every 8h
        var now = new DateTimeOffset(2026, 7, 9, 14, 0, 0, TimeSpan.Zero); // afternoon, outside 03:00
        Assert.True(GcSchedule.IsDue(Linked(now.AddHours(-9), dailyLimit: 4), now));
        Assert.False(GcSchedule.IsDue(Linked(now.AddHours(-2), dailyLimit: 4), now));
    }

    [Fact]
    public void Unknown_budget_keeps_the_nightly_window()
    {
        var afternoon = new DateTimeOffset(2026, 7, 9, 14, 0, 0, TimeSpan.Zero);
        Assert.False(GcSchedule.IsDue(Linked(afternoon.AddHours(-30), dailyLimit: null), afternoon));
        var nightWindow = new DateTimeOffset(2026, 7, 9, 1, 30, 0, TimeSpan.Zero); // 03:30 Amsterdam
        Assert.True(GcSchedule.IsDue(Linked(nightWindow.AddHours(-30), dailyLimit: null), nightWindow));
    }

    [Fact]
    public void A_spent_budget_waits_for_the_bank_side_reset()
    {
        var now = new DateTimeOffset(2026, 7, 9, 14, 0, 0, TimeSpan.Zero);
        var linked = Linked(now.AddHours(-9), dailyLimit: 4, remaining: 0, resetAt: now.AddHours(2));
        Assert.False(GcSchedule.IsDue(linked, now));
        Assert.True(GcSchedule.IsDue(linked, now.AddHours(3))); // reset passed
    }

    [Fact]
    public void One_fetch_per_night_even_across_the_whole_3am_hour()
    {
        // fetched at 03:05 local; 03:50 local the same night must not refetch
        var fetchedAt = new DateTimeOffset(2026, 7, 9, 1, 5, 0, TimeSpan.Zero); // 03:05 Amsterdam
        var laterSameHour = new DateTimeOffset(2026, 7, 9, 1, 50, 0, TimeSpan.Zero);
        Assert.False(GcSchedule.IsDue("NL69INGB0123456789", fetchedAt, laterSameHour));
        // the next night's window is due again (25h later, 03:05 local)
        var nextNight = new DateTimeOffset(2026, 7, 10, 1, 5, 0, TimeSpan.Zero);
        Assert.True(GcSchedule.IsDue("NL69INGB0123456789", fetchedAt, nextNight));
    }
}
