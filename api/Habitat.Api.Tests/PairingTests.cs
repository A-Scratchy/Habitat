using System.Net;
using System.Net.Http.Json;
using Habitat.Api.Features.Devices;

namespace Habitat.Api.Tests;

[Collection(ApiCollection.Name)]
public class PairingTests(ApiFixture api)
{
    private Task<PairingCodeResponse> NewCode(string entra) => api.NewCode(entra);

    private Task<HttpResponseMessage> Pair(string code, string name = "Kitchen tablet") =>
        api.Client().PostAsJsonAsync("/api/devices/pair", new PairRequest(code, name));

    private async Task<PairResponse> PairOk(string code)
    {
        var res = await Pair(code);
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<PairResponse>(Json.Options))!;
    }

    [Fact]
    public async Task Paired_device_is_pending_until_a_user_approves_it()
    {
        var (entra, session) = await api.NewHousehold();
        var code = await NewCode(entra);
        Assert.Matches("^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$", code.Code);
        Assert.Equal($"/join#{code.Code}", code.JoinPath);

        var paired = await PairOk(code.Code);
        var tablet = api.Client(paired.DeviceToken);
        Assert.Equal("pending", paired.Status);

        // Pending: may check its own status, nothing else.
        Assert.Equal(HttpStatusCode.Forbidden, (await tablet.GetAsync("/api/me")).StatusCode);
        var self = await tablet.GetFromJsonAsync<DeviceSelfResponse>("/api/devices/self", Json.Options);
        Assert.Equal(("pending", session.Household.Id), (self!.Status, self.HouseholdId));

        var devices = await api.Client(entra).GetFromJsonAsync<DeviceDto[]>("/api/devices", Json.Options);
        Assert.Contains(devices!, d => d.Id == paired.DeviceId && d.Status == "pending");

        Assert.Equal(HttpStatusCode.NoContent, (await api.Client(entra).PostAsync($"/api/devices/{paired.DeviceId}/approve", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await tablet.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task Codes_are_single_use()
    {
        var (entra, _) = await api.NewHousehold();
        var code = await NewCode(entra);
        await PairOk(code.Code);
        Assert.Equal(HttpStatusCode.BadRequest, (await Pair(code.Code)).StatusCode);
    }

    [Fact]
    public async Task Codes_ignore_case_spaces_and_dashes()
    {
        var (entra, _) = await api.NewHousehold();
        var code = await NewCode(entra);
        var sloppy = " " + code.Code.Replace("-", " ").ToLowerInvariant() + " ";
        Assert.Equal(HttpStatusCode.OK, (await Pair(sloppy)).StatusCode);
    }

    [Fact]
    public async Task Codes_expire_after_ten_minutes()
    {
        var (entra, _) = await api.NewHousehold();
        var code = await NewCode(entra);
        api.Clock.Advance(TimeSpan.FromMinutes(11));
        Assert.Equal(HttpStatusCode.BadRequest, (await Pair(code.Code)).StatusCode);
    }

    [Fact]
    public async Task Unapproved_devices_lapse_after_ten_minutes()
    {
        var (entra, _) = await api.NewHousehold();
        var paired = await PairOk((await NewCode(entra)).Code);

        api.Clock.Advance(TimeSpan.FromMinutes(11));

        Assert.Equal(HttpStatusCode.Unauthorized, (await api.Client(paired.DeviceToken).GetAsync("/api/devices/self")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.Client(entra).PostAsync($"/api/devices/{paired.DeviceId}/approve", null)).StatusCode);
    }

    [Fact]
    public async Task Unknown_codes_get_the_same_answer_as_expired_ones()
    {
        var res = await Pair("ZZZZ-ZZZZ");
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("isn't valid or has expired", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Pair_request_is_validated()
    {
        var res = await api.Client().PostAsJsonAsync("/api/devices/pair", new { code = "ABCD-EFGH", deviceName = "" });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("DeviceName", await res.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Device_tokens_cannot_manage_the_habitat()
    {
        var (_, session) = await api.NewHousehold();
        var device = api.Client(session.DeviceToken);

        Assert.Equal(HttpStatusCode.Unauthorized, (await device.PostAsync("/api/pairing-codes", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await device.GetAsync("/api/devices")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await device.DeleteAsync($"/api/devices/{session.DeviceId}")).StatusCode);
    }

    [Fact]
    public async Task Revoked_devices_are_cut_off_immediately()
    {
        var (entra, session) = await api.NewHousehold();
        var phone = api.Client(session.DeviceToken);
        Assert.Equal(HttpStatusCode.OK, (await phone.GetAsync("/api/me")).StatusCode); // now cached

        Assert.Equal(HttpStatusCode.NoContent, (await api.Client(entra).DeleteAsync($"/api/devices/{session.DeviceId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await phone.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task Households_cannot_touch_each_others_devices()
    {
        var (entraA, _) = await api.NewHousehold("A");
        var (entraB, _) = await api.NewHousehold("B");
        var pairedToA = await PairOk((await NewCode(entraA)).Code);

        Assert.Equal(HttpStatusCode.NotFound, (await api.Client(entraB).PostAsync($"/api/devices/{pairedToA.DeviceId}/approve", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await api.Client(entraB).DeleteAsync($"/api/devices/{pairedToA.DeviceId}")).StatusCode);
        var bDevices = await api.Client(entraB).GetFromJsonAsync<DeviceDto[]>("/api/devices", Json.Options);
        Assert.DoesNotContain(bDevices!, d => d.Id == pairedToA.DeviceId);
    }

    [Fact]
    public async Task Pairing_is_rate_limited()
    {
        await using var strict = new HabitatFactory(api.ConnectionString, api.Clock, pairingAttemptsPerMinute: 2);
        var client = strict.CreateClient();
        var attempt = () => client.PostAsJsonAsync("/api/devices/pair", new PairRequest("ZZZZ-ZZZZ", "Guesser"));

        Assert.Equal(HttpStatusCode.BadRequest, (await attempt()).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await attempt()).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await attempt()).StatusCode);
    }
}
