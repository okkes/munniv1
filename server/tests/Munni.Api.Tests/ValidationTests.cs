using System.Text.Json;
using Munni.Api.GoCardless;
using Munni.Api.Social;
using Munni.Api.Sync;
using Munni.Api.Validation;
using Xunit;

namespace Munni.Api.Tests;

public class ValidationTests
{
    [Theory]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("Okkes", true)]
    public void UpdateMe_requires_a_display_name(string name, bool valid)
    {
        var result = new UpdateMeRequestValidator().Validate(new UpdateMeRequest(name));
        Assert.Equal(valid, result.IsValid);
    }

    [Fact]
    public void UpdateMe_rejects_names_over_100_chars()
    {
        var result = new UpdateMeRequestValidator().Validate(new UpdateMeRequest(new string('x', 101)));
        Assert.False(result.IsValid);
    }

    [Fact]
    public void UpdateMe_accepts_a_small_dataurl_picture_but_caps_it()
    {
        // client downscales uploads to ≤256px JPEG (~15-25 KB) — well under the 64 KB cap
        var small = "data:image/jpeg;base64," + new string('A', 20_000);
        Assert.True(new UpdateMeRequestValidator().Validate(new UpdateMeRequest("Okkes", small)).IsValid);

        var huge = "data:image/jpeg;base64," + new string('A', 70_000);
        Assert.False(new UpdateMeRequestValidator().Validate(new UpdateMeRequest("Okkes", huge)).IsValid);
    }

    [Fact]
    public void FriendRequest_rejects_empty_guid()
    {
        Assert.False(new SendFriendRequestValidator().Validate(new SendFriendRequest(Guid.Empty)).IsValid);
        Assert.True(new SendFriendRequestValidator().Validate(new SendFriendRequest(Guid.NewGuid())).IsValid);
    }

    [Theory]
    [InlineData("member", true)]
    [InlineData("owner", true)]
    [InlineData("admin", false)]
    [InlineData("", false)]
    public void SpaceInvite_restricts_roles(string role, bool valid)
    {
        var result = new SendSpaceInviteValidator().Validate(new SendSpaceInvite(Guid.NewGuid(), role, "Home"));
        Assert.Equal(valid, result.IsValid);
    }

    private static SyncOpDto Op(string entity = "transaction") =>
        new("op1", "space1", entity, "e1", new Dictionary<string, JsonElement>(), "0000000001-0000-dev");

    [Fact]
    public void Push_accepts_a_wellformed_request()
    {
        var result = new PushRequestValidator().Validate(new PushRequest("device-1", [Op()]));
        Assert.True(result.IsValid);
    }

    [Fact]
    public void Push_accepts_the_overlay_entities()
    {
        // the feed import pushes these — a missing whitelist entry strands
        // the owner's outbox with 400s (found by the sync-a6 e2e)
        Assert.True(new PushRequestValidator().Validate(new PushRequest("device-1", [Op(entity: "txMeta")])).IsValid);
        Assert.True(new PushRequestValidator().Validate(new PushRequest("device-1", [Op(entity: "accountLink")])).IsValid);
        // recurring costs + dismissed suggestions sync the same way
        Assert.True(new PushRequestValidator().Validate(new PushRequest("device-1", [Op(entity: "recurring")])).IsValid);
        Assert.True(new PushRequestValidator().Validate(new PushRequest("device-1", [Op(entity: "recurringDismiss")])).IsValid);
    }

    [Fact]
    public void Push_accepts_topics_and_composite_allocation_ids()
    {
        // 'topic' missing from the whitelist + a 64-char EntityId cap
        // poisoned real outboxes: `alloc:{space-uuid}:{period}:{catId}`
        // is 65+ chars and a recurring set-aside bucket adds `rec:{uuid}`
        // (user outage 2026-07-20: a hundred store receipts stuck behind
        // one rejected op, surfacing as "offline")
        Assert.True(new PushRequestValidator().Validate(new PushRequest("device-1", [Op(entity: "topic")])).IsValid);
        var allocId = $"alloc:{Guid.NewGuid()}:2026-07-01:rec:{Guid.NewGuid()}";
        Assert.True(allocId.Length > 64);
        Assert.True(new SyncOpDtoValidator().Validate(Op(entity: "allocation") with { EntityId = allocId }).IsValid);
        Assert.False(new SyncOpDtoValidator().Validate(Op() with { EntityId = new string('x', 129) }).IsValid);
    }

    [Fact]
    public void Push_accepts_the_activity_history_entity()
    {
        // per-space "who did what" rows (capped client-side at 200)
        Assert.True(new PushRequestValidator().Validate(new PushRequest("device-1", [Op(entity: "activity")])).IsValid);
    }

    [Fact]
    public void Push_accepts_the_receipts_v3_entities()
    {
        // receipts redesign: instance metadata, per-space inclusion links
        // and snapshot receipt links all travel the oplog — a missing
        // whitelist entry poisons the outbox (the 2.20.1 lesson)
        Assert.True(new PushRequestValidator().Validate(new PushRequest("device-1", [Op(entity: "storeConn")])).IsValid);
        Assert.True(new PushRequestValidator().Validate(new PushRequest("device-1", [Op(entity: "storeConnLink")])).IsValid);
        Assert.True(new PushRequestValidator().Validate(new PushRequest("device-1", [Op(entity: "receiptLink")])).IsValid);
        // the longest v3 composite id stays inside the 128 cap
        var sclinkId = $"sclink:{Guid.NewGuid()}:{Guid.NewGuid()}";
        Assert.True(new SyncOpDtoValidator().Validate(Op(entity: "storeConnLink") with { EntityId = sclinkId }).IsValid);
    }

    [Fact]
    public void Push_rejects_unknown_entities_and_missing_ids()
    {
        Assert.False(new PushRequestValidator().Validate(new PushRequest("device-1", [Op(entity: "user")])).IsValid);
        Assert.False(new PushRequestValidator().Validate(new PushRequest("", [Op()])).IsValid);
        Assert.False(new SyncOpDtoValidator().Validate(Op() with { OpId = "" }).IsValid);
        Assert.False(new SyncOpDtoValidator().Validate(Op() with { Hlc = "" }).IsValid);
    }

    [Fact]
    public void Push_caps_the_batch_size()
    {
        var ops = Enumerable.Range(0, 1001).Select(_ => Op()).ToList();
        Assert.False(new PushRequestValidator().Validate(new PushRequest("device-1", ops)).IsValid);
    }

    [Theory]
    [InlineData("https://munni.example/gc-callback", true)]
    [InlineData("http://localhost:5173/gc-callback", true)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("not a url", false)]
    [InlineData("", false)]
    public void Requisition_requires_an_absolute_http_redirect(string url, bool valid)
    {
        var result = new CreateRequisitionRequestValidator()
            .Validate(new CreateRequisitionRequest("space1", "ING_INGBNL2A", url));
        Assert.Equal(valid, result.IsValid);
    }
}
