using Microsoft.EntityFrameworkCore;
using Munni.Api.Data;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Munni.Api.Admin;

/// <summary>
/// The versioned catalog document (admin-catalog design AC1): builtin
/// categories + prediction keywords as operator-editable content. One
/// JSON document in AppSettings, version bumped on every publish;
/// clients fetch opportunistically at sync time and fall back to the
/// bundled copy when they have never fetched one.
/// </summary>
public static class CatalogEndpoints
{
    private const string SettingKey = "catalog";

    public sealed record CatalogPublishDto(
        [property: JsonPropertyName("categories")] JsonElement Categories,
        [property: JsonPropertyName("keywords")] JsonElement Keywords,
        // receipts v3 R9: operator-curated store merchant patterns — an
        // older console publishing without the field keeps working
        [property: JsonPropertyName("stores")] JsonElement? Stores = null);

    public static void MapCatalog(this IEndpointRouteBuilder app)
    {
        // public + cacheable: the catalog is content, not user data
        app.MapGet("/catalog", ReadCatalog).AllowAnonymous();
        // publish (admin console): the server owns the version counter
        app.MapPut("/admin/catalog", PublishCatalog).RequireAuthorization();
    }

    private static int VersionOf(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.TryGetProperty("version", out var v) ? v.GetInt32() : 0;
    }

    private static async Task<IResult> ReadCatalog(HttpContext http, AppDbContext db)
    {
        var setting = await db.AppSettings.FindAsync(SettingKey);
        if (setting is null) return Results.NoContent(); // clients keep the bundled baseline
        var etag = $"\"catalog-v{VersionOf(setting.Value)}\"";
        if (http.Request.Headers.IfNoneMatch.ToString() == etag) return Results.StatusCode(304);
        http.Response.Headers.ETag = etag;
        return Results.Content(setting.Value, "application/json");
    }

    private static async Task<IResult> PublishCatalog(CatalogPublishDto body, HttpContext http, AppDbContext db, IConfiguration config)
    {
        if (!await AdminEndpoints.IsAdminForCatalogAsync(http, db, config)) return Results.Forbid();
        if (body.Categories.ValueKind != JsonValueKind.Array || body.Keywords.ValueKind != JsonValueKind.Array)
            return Results.BadRequest(new { error = "categories and keywords must be arrays" });
        if (body.Stores is { } stores && stores.ValueKind != JsonValueKind.Array && stores.ValueKind != JsonValueKind.Null)
            return Results.BadRequest(new { error = "stores must be an array" });

        var setting = await db.AppSettings.FindAsync(SettingKey);
        var version = setting is null ? 0 : VersionOf(setting.Value);
        var next = JsonSerializer.Serialize(new
        {
            version = version + 1,
            categories = body.Categories,
            keywords = body.Keywords,
            stores = body.Stores is { ValueKind: JsonValueKind.Array } s ? s : JsonSerializer.SerializeToElement(Array.Empty<object>()),
        });
        if (setting is null) db.AppSettings.Add(new AppSetting { Key = SettingKey, Value = next });
        else setting.Value = next;
        await db.SaveChangesAsync();
        return Results.Ok(new { version = version + 1 });
    }
}
