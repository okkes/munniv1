using FluentValidation;

namespace Munni.Api.Validation;

/// <summary>
/// Endpoint filter running the FluentValidation validator for the
/// request body: never trust input from the UI. Returns RFC 7807
/// validation problem details on failure.
/// </summary>
public sealed class ValidationFilter<T> : IEndpointFilter where T : class
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var argument = context.Arguments.OfType<T>().FirstOrDefault();
        if (argument is null) return Results.BadRequest();

        var validator = context.HttpContext.RequestServices.GetRequiredService<IValidator<T>>();
        var result = await validator.ValidateAsync(argument, context.HttpContext.RequestAborted);
        if (!result.IsValid) return Results.ValidationProblem(result.ToDictionary());

        return await next(context);
    }
}

public static class ValidationFilterExtensions
{
    /// <summary>Validate the endpoint's <typeparamref name="T"/> body before the handler runs.</summary>
    public static RouteHandlerBuilder WithValidation<T>(this RouteHandlerBuilder builder) where T : class =>
        builder.AddEndpointFilter(new ValidationFilter<T>());
}
