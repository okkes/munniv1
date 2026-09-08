using Munni.Api.Data;

namespace Munni.Api.Admin;

/// <summary>
/// Delegating handler that piggybacks on provider traffic to capture
/// rate-limit headers (admin-redesign AD3) — the console shows how much
/// quota is left and when it resets, without ever making extra calls.
/// GoCardless sends HTTP_X_RATELIMIT_LIMIT/REMAINING/RESET (global) and
/// HTTP_X_RATELIMIT_ACCOUNT_SUCCESS_* (per-account daily scopes).
/// </summary>
public sealed class QuotaCaptureHandler(IServiceScopeFactory scopeFactory, string provider) : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var response = await base.SendAsync(request, cancellationToken);
        try
        {
            await CaptureAsync(request, response, cancellationToken);
        }
        catch
        {
            // quota bookkeeping must never break the actual call
        }
        return response;
    }

    private async Task CaptureAsync(HttpRequestMessage request, HttpResponseMessage response, CancellationToken ct)
    {
        var global = ReadTriplet(response, "HTTP_X_RATELIMIT");
        var account = ReadTriplet(response, "HTTP_X_RATELIMIT_ACCOUNT_SUCCESS");
        if (global is null && account is null) return;

        var scope = ScopeOf(request.RequestUri);
        using var serviceScope = scopeFactory.CreateScope();
        var db = serviceScope.ServiceProvider.GetRequiredService<AppDbContext>();
        if (global is not null) await UpsertAsync(db, scope, global.Value, ct);
        if (account is not null) await UpsertAsync(db, $"{scope}:account-daily", account.Value, ct);
        await db.SaveChangesAsync(ct);
    }

    private async Task UpsertAsync(AppDbContext db, string scope, (int? Limit, int? Remaining, int? ResetSeconds) values, CancellationToken ct)
    {
        var row = db.ProviderQuotas.Local.FirstOrDefault(q => q.Provider == provider && q.Scope == scope)
                  ?? await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions
                      .FirstOrDefaultAsync(db.ProviderQuotas, q => q.Provider == provider && q.Scope == scope, ct);
        if (row is null)
        {
            row = new ProviderQuota { Id = Guid.NewGuid(), Provider = provider, Scope = scope };
            db.ProviderQuotas.Add(row);
        }
        row.Limit = values.Limit;
        row.Remaining = values.Remaining;
        row.ResetAtUtc = values.ResetSeconds is { } seconds ? DateTimeOffset.UtcNow.AddSeconds(seconds) : null;
        row.CapturedAtUtc = DateTimeOffset.UtcNow;
    }

    private static (int? Limit, int? Remaining, int? ResetSeconds)? ReadTriplet(HttpResponseMessage response, string prefix)
    {
        var limit = ReadInt(response, $"{prefix}_LIMIT");
        var remaining = ReadInt(response, $"{prefix}_REMAINING");
        var reset = ReadInt(response, $"{prefix}_RESET");
        if (limit is null && remaining is null && reset is null) return null;
        return (limit, remaining, reset);
    }

    private static int? ReadInt(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) && int.TryParse(values.FirstOrDefault(), out var parsed)
            ? parsed
            : null;

    /// <summary>endpoint family: /api/v2/accounts/{id}/transactions/ → "accounts:transactions"</summary>
    internal static string ScopeOf(Uri? uri)
    {
        var segments = (uri?.AbsolutePath ?? "/")
            .Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Where(s => s != "api" && !s.StartsWith('v'))
            .ToList();
        return segments.Count switch
        {
            0 => "root",
            1 => segments[0],
            // drop the {id} in the middle: accounts/{id}/transactions
            _ => $"{segments[0]}:{segments[^1]}",
        };
    }
}
