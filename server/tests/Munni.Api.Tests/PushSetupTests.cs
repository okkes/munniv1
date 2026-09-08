using Munni.Api.Push;

namespace Munni.Api.Tests;

public class PushSetupTests
{
    [Fact]
    public void A_complete_service_account_json_is_accepted()
    {
        var json = """{"project_id":"munni","client_email":"push@munni.iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n"}""";
        Assert.True(PushSetup.IsValidFcmConfig(json));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not json at all")]
    [InlineData("""{"project_id":"munni"}""")] // missing client_email + private_key
    [InlineData("""{"project_id":"","client_email":"x","private_key":"y"}""")] // empty field
    public void Malformed_or_partial_keys_are_rejected(string? json)
    {
        Assert.False(PushSetup.IsValidFcmConfig(json));
    }
}
