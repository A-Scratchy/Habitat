using System.Net;
using System.Net.Http.Json;
using Habitat.Api.Features.Presence;

namespace Habitat.Api.Tests;

[Collection(ApiCollection.Name)]
public class PresenceTests(ApiFixture api)
{
    private static async Task<Guid[]> Here(HttpClient device, Guid? memberId)
    {
        var res = await device.PutAsJsonAsync("/api/presence", new PresenceInput(memberId), Json.Options);
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<PresenceResponse>(Json.Options))!.Active;
    }

    [Fact]
    public async Task Everyone_using_the_app_on_any_device_shows_as_active()
    {
        var (entra, session) = await api.NewHousehold();
        var phone = api.Client(session.DeviceToken);
        var tablet = await api.ApprovedDevice(entra);
        var leo = Guid.NewGuid();
        (await phone.PutAsJsonAsync($"/api/members/{leo}", new { name = "Leo", animal = "🐻", sound = "Bell" })).EnsureSuccessStatusCode();

        Assert.Equal([session.MemberId], await Here(phone, session.MemberId));
        Assert.Equal(new[] { leo, session.MemberId }.Order(), (await Here(tablet, leo)).Order());

        // Putting the app away (or switching who's using the device) takes effect straight away.
        Assert.Equal([leo], await Here(phone, null));
    }

    [Fact]
    public async Task Someone_fades_out_once_their_device_stops_checking_in()
    {
        var (entra, session) = await api.NewHousehold();
        var phone = api.Client(session.DeviceToken);
        var tablet = await api.ApprovedDevice(entra);
        await Here(phone, session.MemberId);

        api.Clock.Advance(PresenceEndpoints.ActiveWindow + TimeSpan.FromSeconds(1));
        Assert.Empty(await Here(tablet, null));
    }

    [Fact]
    public async Task Presence_stays_inside_the_habitat()
    {
        var (_, ours) = await api.NewHousehold();
        var (_, theirs) = await api.NewHousehold("The Sett", "Sam");
        await Here(api.Client(theirs.DeviceToken), theirs.MemberId);

        Assert.Empty(await Here(api.Client(ours.DeviceToken), null));
        var res = await api.Client(ours.DeviceToken).PutAsJsonAsync("/api/presence", new PresenceInput(theirs.MemberId), Json.Options);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }
}
