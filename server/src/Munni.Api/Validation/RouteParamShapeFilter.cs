using System.Text.RegularExpressions;

namespace Munni.Api.Validation;

/// <summary>
/// Endpoint filter rejecting requests whose string route parameters do
/// not look like the identifiers this API hands out (uuids, short refs).
/// Guid-constrained params already pass; this catches the free-form ones
/// (spaceId, action, requisitionId) before they reach a handler or query.
/// </summary>
public sealed partial class RouteParamShapeFilter : IEndpointFilter
{
    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex SafeShape();

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        foreach (var value in context.HttpContext.Request.RouteValues.Values)
        {
            if (value is string s && !SafeShape().IsMatch(s))
                return Results.BadRequest(new { error = "malformed route parameter" });
        }
        return await next(context);
    }
}

public static class RouteParamShapeExtensions
{
    /// <summary>Reject malformed string route params for every endpoint in the group.</summary>
    public static RouteGroupBuilder WithSafeRouteParams(this RouteGroupBuilder group) =>
        group.AddEndpointFilter(new RouteParamShapeFilter());
}
