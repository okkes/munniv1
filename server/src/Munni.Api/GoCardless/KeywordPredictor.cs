using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Munni.Api.GoCardless;

/// <summary>
/// Server-side twin of apps/web/src/domain/predictCategory.ts, fed by the
/// same generated keyword data (keyword-rules.json embedded resource) so
/// GoCardless ingestion categorizes identically to client-side CAMT import.
/// </summary>
public static class KeywordPredictor
{
    public sealed record Rule(
        [property: JsonPropertyName("lang")] string Lang,
        [property: JsonPropertyName("catId")] string CatId,
        [property: JsonPropertyName("keywords")] List<string> Keywords,
        [property: JsonPropertyName("direction")] string Direction,
        [property: JsonPropertyName("txType")] string TxType);

    public sealed record Prediction(string CatId, string TxType);

    private static readonly Lazy<List<(string Keyword, Rule Rule)>> Candidates = new(() =>
    {
        using var stream = Assembly.GetExecutingAssembly()
            .GetManifestResourceStream("Munni.Api.GoCardless.keyword-rules.json")
            ?? throw new InvalidOperationException("keyword-rules.json resource missing");
        var rules = JsonSerializer.Deserialize<List<Rule>>(stream)!;
        return rules
            .SelectMany(rule => rule.Keywords.Select(k => (Keyword: k.ToLowerInvariant(), Rule: rule)))
            .OrderByDescending(c => c.Keyword.Length)
            .ToList();
    });

    /// <summary>
    /// Predicts a category id + transaction type from a transaction's text
    /// by longest-keyword match, or null when nothing matches.
    /// </summary>
    /// <param name="direction">"credit" (money in) or "debit"</param>
    public static Prediction? Predict(string text, string direction)
    {
        var haystack = text.ToLowerInvariant();
        var words = haystack.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet();

        foreach (var (keyword, rule) in Candidates.Value)
        {
            if (rule.Direction != "both" && rule.Direction != direction) continue;
            var hit = keyword.Length > 3 ? haystack.Contains(keyword) : words.Contains(keyword);
            if (hit) return new Prediction(rule.CatId, rule.TxType);
        }
        return null;
    }
}
