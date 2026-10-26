using System.Net;
using System.Net.Http.Json;
using Habitat.Api.Data;
using Habitat.Api.Features.Devices;
using Habitat.Api.Features.Households;
using Microsoft.AspNetCore.Mvc;

namespace Habitat.Api.Tests;

[Collection(ApiCollection.Name)]
public class HouseholdTests(ApiFixture api)
{
    private static string NewPerson() => TestEntra.Token(Guid.NewGuid().ToString());

    private async Task<string?> ProblemType(HttpResponseMessage res) =>
        (await res.Content.ReadFromJsonAsync<ProblemDetails>(Json.Options))?.Type;

    [Fact]
    public async Task Starting_a_habitat_creates_it_with_the_person_as_a_user()
    {
        var (_, session) = await api.NewHousehold("The Sett", "Robin");

        Assert.Equal("approved", session.Status);
        Assert.StartsWith("hab_dev_", session.DeviceToken);

        var me = await api.Client(session.DeviceToken).GetFromJsonAsync<MeResponse>("/api/me", Json.Options);
        Assert.Equal("The Sett", me!.Household.Name);
        var robin = Assert.Single(me.Members);
        Assert.Equal((session.MemberId, "Robin", "🦊", true), (robin.Id, robin.Name, robin.Animal, robin.IsUser));
    }

    [Fact]
    public async Task One_habitat_per_email_for_now()
    {
        var (entra, _) = await api.NewHousehold();
        var res = await api.Client(entra).PostAsJsonAsync("/api/households", new CreateHouseholdRequest("Laptop", "Second home", "Robin", "🦊"));
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        Assert.Equal(HouseholdProblems.AlreadyInHabitat, await ProblemType(res));
    }

    [Fact]
    public async Task Signing_in_on_another_device_joins_the_same_habitat()
    {
        var (entra, first) = await api.NewHousehold();
        var res = await api.Client(entra).PostAsJsonAsync("/api/auth/sign-in", new SignInRequest("Laptop"));
        var second = await res.Content.ReadFromJsonAsync<SessionResponse>(Json.Options);

        Assert.Equal(first.Household.Id, second!.Household.Id);
        Assert.Equal(first.MemberId, second.MemberId);
        Assert.NotEqual(first.DeviceToken, second.DeviceToken);
    }

    [Fact]
    public async Task Signing_in_without_a_habitat_says_so_rather_than_creating_one()
    {
        var res = await api.Client(NewPerson()).PostAsJsonAsync("/api/auth/sign-in", new SignInRequest("Phone"));
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        Assert.Equal(HouseholdProblems.NoHabitat, await ProblemType(res));
    }

    [Fact]
    public async Task Starting_a_habitat_needs_its_details()
    {
        var res = await api.Client(NewPerson()).PostAsJsonAsync("/api/households", new { deviceName = "Phone" });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Unknown_time_zone_is_rejected()
    {
        var res = await api.Client(NewPerson()).PostAsJsonAsync("/api/households", new CreateHouseholdRequest("Phone", "Home", "Sam", "🦉", "Mars/Olympus"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Entra_token_without_the_api_scope_is_forbidden()
    {
        var res = await api.Client(TestEntra.Token(Guid.NewGuid().ToString(), scope: "openid"))
            .PostAsJsonAsync("/api/households", new CreateHouseholdRequest("Phone", "Home", "Sam", "🦉"));
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("hab_dev_not-a-real-token")]
    [InlineData("eyJhbGciOiJub25lIn0.e30.")]
    public async Task Me_needs_a_real_device_token(string? bearer)
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.Client(bearer).GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task An_entra_token_is_not_a_device_token()
    {
        var (entra, _) = await api.NewHousehold();
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.Client(entra).GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task Device_tokens_expire_after_90_days_unused_but_not_while_used()
    {
        var (_, session) = await api.NewHousehold();
        var client = api.Client(session.DeviceToken);

        api.Clock.Advance(TimeSpan.FromDays(80));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/me")).StatusCode);
        api.Clock.Advance(TimeSpan.FromDays(80));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/me")).StatusCode);

        api.Clock.Advance(TimeSpan.FromDays(91));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task Invited_user_can_manage_the_habitat_only_once_approved()
    {
        var (robin, _) = await api.NewHousehold();
        var invite = await api.NewCode(robin, PairingKind.User);
        Assert.StartsWith("/join/user#", invite.JoinPath);

        var sam = NewPerson();
        var joined = await (await api.Client(sam).PostAsJsonAsync("/api/auth/join", new JoinRequest(invite.Code, "Sam's phone", MemberName: "Sam", Animal: "🦉")))
            .Content.ReadFromJsonAsync<SessionResponse>(Json.Options);
        Assert.Equal("pending", joined!.Status);

        // Pending: no user rights, and signing in elsewhere says they're waiting.
        Assert.Equal(HttpStatusCode.Forbidden, (await api.Client(sam).PostAsJsonAsync("/api/pairing-codes", new { })).StatusCode);
        var waiting = await api.Client(sam).PostAsJsonAsync("/api/auth/sign-in", new SignInRequest("Laptop"));
        Assert.Equal(HouseholdProblems.AwaitingApproval, await ProblemType(waiting));

        var devices = await api.Client(robin).GetFromJsonAsync<DeviceDto[]>("/api/devices", Json.Options);
        Assert.Equal("🦉 Sam", devices!.Single(d => d.Id == joined.DeviceId).JoiningAsUser);

        (await api.Client(robin).PostAsync($"/api/devices/{joined.DeviceId}/approve", null)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.OK, (await api.Client(sam).PostAsJsonAsync("/api/pairing-codes", new { })).StatusCode);
        var me = await api.Client(joined.DeviceToken).GetFromJsonAsync<MeResponse>("/api/me", Json.Options);
        Assert.True(me!.Members.Single(m => m.Name == "Sam").IsUser);
    }

    [Fact]
    public async Task Rejecting_a_join_removes_the_pending_user()
    {
        var (robin, _) = await api.NewHousehold();
        var sam = NewPerson();
        var joined = await (await api.Client(sam).PostAsJsonAsync("/api/auth/join", new JoinRequest((await api.NewCode(robin, PairingKind.User)).Code, "Phone", MemberName: "Sam", Animal: "🦉")))
            .Content.ReadFromJsonAsync<SessionResponse>(Json.Options);

        (await api.Client(robin).DeleteAsync($"/api/devices/{joined!.DeviceId}")).EnsureSuccessStatusCode();

        var again = await api.Client(sam).PostAsJsonAsync("/api/auth/sign-in", new SignInRequest("Phone"));
        Assert.Equal(HouseholdProblems.NoHabitat, await ProblemType(again));
    }

    [Fact]
    public async Task Invite_codes_and_device_codes_are_not_interchangeable()
    {
        var (robin, _) = await api.NewHousehold();

        var userCode = await api.NewCode(robin, PairingKind.User);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.Client().PostAsJsonAsync("/api/devices/pair", new PairRequest(userCode.Code, "Tablet"))).StatusCode);

        var deviceCode = await api.NewCode(robin);
        var res = await api.Client(NewPerson()).PostAsJsonAsync("/api/auth/join", new JoinRequest(deviceCode.Code, "Phone", MemberName: "Sam", Animal: "🦉"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Someone_already_in_a_habitat_cannot_join_another()
    {
        var (robin, _) = await api.NewHousehold();
        var (other, _) = await api.NewHousehold("Elsewhere");
        var res = await api.Client(other).PostAsJsonAsync("/api/auth/join", new JoinRequest((await api.NewCode(robin, PairingKind.User)).Code, "Phone", MemberName: "X", Animal: "🦉"));
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
    }

    [Fact]
    public async Task Joining_as_an_existing_member_links_to_them()
    {
        var (robin, session) = await api.NewHousehold();
        var tablet = api.Client(session.DeviceToken);
        var jo = Guid.NewGuid();
        (await tablet.PutAsJsonAsync($"/api/members/{jo}", new { name = "Jo", animal = "🐻" })).EnsureSuccessStatusCode();

        var joined = await (await api.Client(NewPerson()).PostAsJsonAsync("/api/auth/join", new JoinRequest((await api.NewCode(robin, PairingKind.User)).Code, "Jo's phone", MemberId: jo)))
            .Content.ReadFromJsonAsync<SessionResponse>(Json.Options);
        Assert.Equal(jo, joined!.MemberId);

        // Robin is already a user, so nobody else can join as Robin.
        var asRobin = await api.Client(NewPerson()).PostAsJsonAsync("/api/auth/join", new JoinRequest((await api.NewCode(robin, PairingKind.User)).Code, "Phone", MemberId: session.MemberId));
        Assert.Equal(HttpStatusCode.BadRequest, asRobin.StatusCode);
    }
}
