using FluentValidation;
using Munni.Api.Accounts;
using Munni.Api.GoCardless;
using Munni.Api.Social;
using Munni.Api.Sync;

namespace Munni.Api.Validation;

public sealed class RegisterFeedRequestValidator : AbstractValidator<RegisterFeedRequest>
{
    public RegisterFeedRequestValidator()
    {
        RuleFor(r => r.FeedSpaceId).NotEmpty().MaximumLength(64)
            .Must(FeedAccess.IsFeedShaped).WithMessage("feed ids are deterministic uuidv5 values");
        RuleFor(r => r.AccountRef).NotEmpty().MaximumLength(64);
    }
}

public sealed class AttachAccountRequestValidator : AbstractValidator<AttachAccountRequest>
{
    public AttachAccountRequestValidator()
    {
        RuleFor(r => r.FeedSpaceId).NotEmpty().MaximumLength(64);
        RuleFor(r => r.AccountId).NotEmpty().MaximumLength(64);
        RuleFor(r => r.HistoryFrom).Matches(@"^\d{4}-\d{2}-\d{2}$").When(r => !string.IsNullOrEmpty(r.HistoryFrom))
            .WithMessage("historyFrom must be yyyy-mm-dd");
    }
}

public sealed class UpdateMeRequestValidator : AbstractValidator<UpdateMeRequest>
{
    public UpdateMeRequestValidator()
    {
        RuleFor(r => r.DisplayName).NotEmpty().MaximumLength(100);
        // preset avatar id ("icon|#color") or a small data URL — the client
        // downscales uploads to ≤256px JPEG, well under this cap
        RuleFor(r => r.Picture).MaximumLength(65_536);
        RuleFor(r => r.Country).Matches("^[A-Za-z]{2}$").When(r => !string.IsNullOrEmpty(r.Country));
        // '' is the explicit "clear back to as-recorded" sentinel
        RuleFor(r => r.DisplayCurrency).Matches("^[A-Za-z]{3}$").When(r => !string.IsNullOrEmpty(r.DisplayCurrency));
    }
}

public sealed class SendFriendRequestValidator : AbstractValidator<SendFriendRequest>
{
    public SendFriendRequestValidator()
    {
        RuleFor(r => r.ToUserId).NotEmpty();
    }
}

public sealed class SendSpaceInviteValidator : AbstractValidator<SendSpaceInvite>
{
    // "member" accepted for older clients; the server maps it to contributor
    private static readonly string[] Roles = [.. SpaceRoles.Assignable, SpaceRoles.LegacyMember];

    public SendSpaceInviteValidator()
    {
        RuleFor(r => r.ToUserId).NotEmpty();
        RuleFor(r => r.Role).NotEmpty().Must(Roles.Contains).WithMessage("role must be owner, contributor or reader");
        RuleFor(r => r.SpaceName).MaximumLength(200);
    }
}

public sealed class ChangeRoleRequestValidator : AbstractValidator<ChangeRoleRequest>
{
    public ChangeRoleRequestValidator()
    {
        RuleFor(r => r.Role).NotEmpty().Must(SpaceRoles.Assignable.Contains).WithMessage("role must be owner, contributor or reader");
    }
}

public sealed class SyncOpDtoValidator : AbstractValidator<SyncOpDto>
{
    private static readonly string[] Entities = ["space", "account", "category", "transaction", "txMeta", "accountLink", "recurring", "recurringDismiss", "budget", "event", "goal", "goalContribution", "debt", "allocation", "receipt", "receiptLink", "storeMarker", "storeConn", "storeConnLink", "holding", "lot", "insightDismiss", "topic", "activity"];

    public SyncOpDtoValidator()
    {
        RuleFor(o => o.OpId).NotEmpty().MaximumLength(64);
        RuleFor(o => o.SpaceId).NotEmpty().MaximumLength(64);
        RuleFor(o => o.Entity).NotEmpty().Must(Entities.Contains).WithMessage("unknown entity");
        // 128, not 64: composite ids are legitimate — an allocation cell is
        // `alloc:{space-uuid}:{period}:{catId}` (65+ for real spaces) and a
        // recurring set-aside bucket adds `rec:{uuid}` on top. A too-tight
        // limit 400s the push and POISONS the outbox: everything queued
        // after the op (a hundred store receipts, say) never syncs again
        RuleFor(o => o.EntityId).NotEmpty().MaximumLength(128);
        RuleFor(o => o.Hlc).NotEmpty().MaximumLength(64);
        RuleFor(o => o.Fields).NotNull();
    }
}

public sealed class PushRequestValidator : AbstractValidator<PushRequest>
{
    public PushRequestValidator()
    {
        RuleFor(r => r.ClientId).NotEmpty().MaximumLength(64);
        RuleFor(r => r.Ops).NotNull();
        RuleFor(r => r.Ops.Count).LessThanOrEqualTo(1000).WithMessage("push at most 1000 ops per request");
        RuleForEach(r => r.Ops).SetValidator(new SyncOpDtoValidator());
    }
}

public sealed class RenameDeviceRequestValidator : AbstractValidator<Munni.Api.Auth.RenameDeviceRequest>
{
    public RenameDeviceRequestValidator()
    {
        RuleFor(r => r.Name).NotEmpty().MaximumLength(60);
    }
}

public sealed class SubscribeRequestValidator : AbstractValidator<Munni.Api.Push.SubscribeRequest>
{
    public SubscribeRequestValidator()
    {
        RuleFor(r => r.Kind).Must(k => k is "webpush" or "fcm").WithMessage("kind must be webpush or fcm");
        RuleFor(r => r.Lang).Must(l => l is null or "en" or "nl" or "tr").WithMessage("lang must be en, nl or tr");
        RuleFor(r => r.Endpoint).NotEmpty().MaximumLength(4096);
        // browser subscriptions: a real push-service URL plus its key pair
        When(r => r.Kind == "webpush", () =>
        {
            RuleFor(r => r.Endpoint)
                .MaximumLength(2048)
                .Must(url => Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps)
                .WithMessage("endpoint must be an absolute https URL");
            RuleFor(r => r.P256dh).NotEmpty().MaximumLength(256);
            RuleFor(r => r.Auth).NotEmpty().MaximumLength(128);
        });
    }
}

public sealed class CreateRequisitionRequestValidator : AbstractValidator<CreateRequisitionRequest>
{
    public CreateRequisitionRequestValidator()
    {
        RuleFor(r => r.SpaceId).NotEmpty().MaximumLength(64);
        RuleFor(r => r.InstitutionId).NotEmpty().MaximumLength(128);
        RuleFor(r => r.RedirectUrl)
            .NotEmpty()
            .Must(url => Uri.TryCreate(url, UriKind.Absolute, out var uri)
                         && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            .WithMessage("redirectUrl must be an absolute http(s) URL");
    }
}

public sealed class RegisterDeviceRequestValidator : AbstractValidator<Shopping.RegisterDeviceRequest>
{
    public RegisterDeviceRequestValidator()
    {
        RuleFor(r => r.DeviceId).NotEmpty().MaximumLength(64);
        RuleFor(r => r.PublicJwk).NotEmpty().MaximumLength(2048);
        RuleFor(r => r.Name).NotEmpty().MaximumLength(80);
    }
}

public sealed class WrapRequestValidator : AbstractValidator<Shopping.WrapRequest>
{
    public WrapRequestValidator()
    {
        RuleFor(r => r.WrappedCsk).NotEmpty().MaximumLength(4096);
    }
}

public sealed class ConnectionCipherRequestValidator : AbstractValidator<Shopping.ConnectionCipherRequest>
{
    public ConnectionCipherRequestValidator()
    {
        RuleFor(r => r.Cipher).NotEmpty().MaximumLength(16384);
    }
}
