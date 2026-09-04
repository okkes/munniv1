using System.Text.Json;
using System.Text.Json.Serialization;

namespace Munni.Api.Shopping;

/// <summary>
/// Receipt-photo OCR via the Tesseract sidecar container (receipts
/// ruling #3): the image passes through, the extracted text comes back,
/// nothing is stored. Mapped only when Ocr:BaseUrl is configured.
/// </summary>
public static class OcrEndpoints
{
    public const string HttpClientName = "ocr";
    private const int MaxImageBytes = 4 * 1024 * 1024;

    public sealed record OcrRequest(string Image);
    public sealed record OcrResult(string Text);

    private sealed record TesseractEnvelope([property: JsonPropertyName("data")] TesseractData? Data);
    private sealed record TesseractData([property: JsonPropertyName("stdout")] string? Stdout);

    public static void MapOcr(this IEndpointRouteBuilder app)
    {
        app.MapPost("/ocr/receipt", async (OcrRequest request, IHttpClientFactory http, CancellationToken ct) =>
        {
            var comma = request.Image?.IndexOf(',') ?? -1;
            if (request.Image is null || !request.Image.StartsWith("data:image/", StringComparison.Ordinal) || comma < 0)
                return Results.BadRequest();
            byte[] bytes;
            try
            {
                bytes = Convert.FromBase64String(request.Image[(comma + 1)..]);
            }
            catch (FormatException)
            {
                return Results.BadRequest();
            }
            if (bytes.Length == 0 || bytes.Length > MaxImageBytes) return Results.BadRequest();

            using var client = http.CreateClient(HttpClientName);
            using var form = new MultipartFormDataContent();
            form.Add(new ByteArrayContent(bytes), "file", "receipt.jpg");
            // Dutch receipts first, English as the fallback alphabet
            form.Add(new StringContent("""{"languages":["nld","eng"]}"""), "options");

            try
            {
                using var response = await client.PostAsync("/tesseract", form, ct);
                if (!response.IsSuccessStatusCode) return Results.StatusCode(StatusCodes.Status502BadGateway);
                var envelope = await JsonSerializer.DeserializeAsync<TesseractEnvelope>(
                    await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
                return Results.Ok(new OcrResult(envelope?.Data?.Stdout ?? string.Empty));
            }
            catch (HttpRequestException)
            {
                return Results.StatusCode(StatusCodes.Status502BadGateway);
            }
        }).RequireAuthorization();
    }
}
