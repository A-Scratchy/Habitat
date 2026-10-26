using System.Net;
using System.Net.Http.Json;
using Habitat.Api.Data;
using Habitat.Api.Features.Chores;
using Habitat.Api.Features.Sync;
using Habitat.Api.Features.Wins;

namespace Habitat.Api.Tests;

[Collection(ApiCollection.Name)]
public class ChoreWinSyncTests(ApiFixture api)
{
    private static ChoreInput Bins(int? every = 3, Guid? owner = null, DateTimeOffset? seed = null) =>
        new("Empty Bin", "Kitchen", "Empty Bins", EffortTier.Tortoise, [EnergyTag.Brainless], every, ChoreStatus.Active, owner, seed);

    /// <summary>A fresh habitat with Robin, a device client and one chore.</summary>
    private async Task<(string Entra, HttpClient Device, Guid Robin, Guid Chore)> Setup(ChoreInput? chore = null)
    {
        var (entra, session) = await api.NewHousehold();
        var device = api.Client(session.DeviceToken);
        var choreId = Guid.NewGuid();
        (await device.PutAsJsonAsync($"/api/chores/{choreId}", chore ?? Bins(), Json.Options)).EnsureSuccessStatusCode();
        return (entra, device, session.MemberId, choreId);
    }

    private static async Task<SyncResponse> Sync(HttpClient device, string since = "0") =>
        (await device.GetFromJsonAsync<SyncResponse>($"/api/sync?since={since}", Json.Options))!;

    private static async Task<SyncChore> Chore(HttpClient device, Guid id) => (await Sync(device)).Chores.Single(c => c.Id == id);

    private Task<HttpResponseMessage> LogWin(HttpClient device, Guid choreId, Guid[] members, DateTimeOffset? at = null, Guid? winId = null) =>
        device.PutAsJsonAsync($"/api/wins/{winId ?? Guid.NewGuid()}", new WinInput(choreId, members, at ?? api.Clock.GetUtcNow()), Json.Options);

    [Fact]
    public async Task Chores_round_trip_through_sync()
    {
        var (_, device, robin, choreId) = await Setup();
        var c = await Chore(device, choreId);
        Assert.Equal(("Empty Bin", "Kitchen", "Empty Bins", EffortTier.Tortoise, 3, ChoreStatus.Active), (c.Name, c.Room, c.Group, c.Tier, c.FrequencyDays, c.Status));
        Assert.Equal([EnergyTag.Brainless], c.Energy);
        Assert.Null(c.LastDoneAt);
    }

    [Fact]
    public async Task Patch_changes_only_what_was_sent_and_can_clear_fields()
    {
        var (_, device, _, choreId) = await Setup();

        var res = await device.PatchAsJsonAsync($"/api/chores/{choreId}", new { frequencyDays = 14, group = (string?)null, tier = "Sloth" });
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);

        var c = await Chore(device, choreId);
        Assert.Equal((14, (string?)null, EffortTier.Sloth, "Empty Bin", "Kitchen"), (c.FrequencyDays, c.Group, c.Tier, c.Name, c.Room));
    }

    [Theory]
    [InlineData("""{ "frequencyDays": 0 }""")]
    [InlineData("""{ "tier": "Hippo" }""")]
    [InlineData("""{ "name": "" }""")]
    [InlineData("""{ "lastDoneAt": "2026-01-01T00:00:00Z" }""")]
    [InlineData("""{ "ownerMemberId": "00000000-0000-0000-0000-000000000001" }""")]
    public async Task Patch_rejects_bad_or_server_owned_fields(string body)
    {
        var (_, device, _, choreId) = await Setup();
        var res = await device.PatchAsync($"/api/chores/{choreId}", new StringContent(body, System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Removed_chores_stay_removed_even_if_an_offline_edit_arrives_later()
    {
        var (_, device, _, choreId) = await Setup();
        Assert.Equal(HttpStatusCode.NoContent, (await device.DeleteAsync($"/api/chores/{choreId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Gone, (await device.PutAsJsonAsync($"/api/chores/{choreId}", Bins(), Json.Options)).StatusCode);
        Assert.Equal(HttpStatusCode.Gone, (await device.PatchAsJsonAsync($"/api/chores/{choreId}", new { frequencyDays = 2 })).StatusCode);
    }

    [Fact]
    public async Task Wins_set_last_done_and_never_move_it_backwards()
    {
        var (_, device, robin, choreId) = await Setup();
        var now = api.Clock.GetUtcNow();

        (await LogWin(device, choreId, [robin], now.AddHours(-1))).EnsureSuccessStatusCode();
        Assert.Equal(now.AddHours(-1), (await Chore(device, choreId)).LastDoneAt);

        // "Forgot to tick it off on Tuesday": logged, but the chore stays as recently done as it was.
        (await LogWin(device, choreId, [robin], now.AddDays(-3))).EnsureSuccessStatusCode();
        Assert.Equal(now.AddHours(-1), (await Chore(device, choreId)).LastDoneAt);
    }

    [Fact]
    public async Task Undo_puts_last_done_back_to_the_previous_win_or_the_imported_date()
    {
        var seed = api.Clock.GetUtcNow().AddDays(-10);
        var (_, device, robin, choreId) = await Setup(Bins(seed: seed));
        Assert.Equal(seed, (await Chore(device, choreId)).LastDoneAt);

        var older = Guid.NewGuid();
        var newer = Guid.NewGuid();
        (await LogWin(device, choreId, [robin], api.Clock.GetUtcNow().AddDays(-2), older)).EnsureSuccessStatusCode();
        (await LogWin(device, choreId, [robin], api.Clock.GetUtcNow(), newer)).EnsureSuccessStatusCode();

        (await device.DeleteAsync($"/api/wins/{newer}")).EnsureSuccessStatusCode();
        Assert.Equal(api.Clock.GetUtcNow().AddDays(-2), (await Chore(device, choreId)).LastDoneAt);

        (await device.DeleteAsync($"/api/wins/{older}")).EnsureSuccessStatusCode();
        Assert.Equal(seed, (await Chore(device, choreId)).LastDoneAt);
    }

    [Fact]
    public async Task Logging_the_same_win_twice_records_it_once()
    {
        var (_, device, robin, choreId) = await Setup();
        var winId = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.NoContent, (await LogWin(device, choreId, [robin], winId: winId)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await LogWin(device, choreId, [robin], winId: winId)).StatusCode);
        Assert.Single((await Sync(device)).Wins, w => w.Id == winId);
    }

    [Fact]
    public async Task Wins_credit_everyone_tagged_primary_first()
    {
        var (_, device, robin, choreId) = await Setup();
        var leo = Guid.NewGuid();
        (await device.PutAsJsonAsync($"/api/members/{leo}", new { name = "Leo", animal = "🐻" })).EnsureSuccessStatusCode();

        var winId = Guid.NewGuid();
        (await LogWin(device, choreId, [leo, robin], winId: winId)).EnsureSuccessStatusCode();
        Assert.Equal([leo, robin], (await Sync(device)).Wins.Single(w => w.Id == winId).MemberIds);
    }

    [Fact]
    public async Task Wins_are_checked()
    {
        var (_, device, robin, choreId) = await Setup();
        var (_, otherSession) = await api.NewHousehold("Elsewhere");
        var now = api.Clock.GetUtcNow();

        Assert.Equal(HttpStatusCode.BadRequest, (await LogWin(device, choreId, [otherSession.MemberId])).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await LogWin(device, choreId, [])).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await LogWin(device, choreId, [robin, robin])).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await LogWin(device, choreId, [robin], now.AddHours(1))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await LogWin(device, choreId, [robin], now.AddYears(-2))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await LogWin(device, Guid.NewGuid(), [robin])).StatusCode);
    }

    [Fact]
    public async Task Claims_last_for_the_household_day_and_doing_the_chore_fulfils_them()
    {
        var (_, device, robin, choreId) = await Setup();
        (await device.PutAsJsonAsync($"/api/chores/{choreId}/claim", new ClaimRequest(robin), Json.Options)).EnsureSuccessStatusCode();

        var claimed = await Chore(device, choreId);
        Assert.Equal((robin, DateOnly.FromDateTime(api.Clock.GetUtcNow().UtcDateTime)), (claimed.ClaimMemberId!.Value, claimed.ClaimDay!.Value));

        (await LogWin(device, choreId, [robin])).EnsureSuccessStatusCode();
        Assert.Null((await Chore(device, choreId)).ClaimMemberId);
    }

    [Fact]
    public async Task Sync_returns_only_changes_since_the_cursor_including_removals()
    {
        var (_, device, robin, choreId) = await Setup();
        var first = await Sync(device);
        Assert.True(first.Full);

        var nothing = await Sync(device, first.Cursor);
        Assert.False(nothing.Full);
        Assert.Empty(nothing.Chores);
        Assert.Empty(nothing.Wins);

        var other = Guid.NewGuid();
        (await device.PutAsJsonAsync($"/api/chores/{other}", Bins() with { Name = "Mop floor" }, Json.Options)).EnsureSuccessStatusCode();
        (await device.DeleteAsync($"/api/chores/{choreId}")).EnsureSuccessStatusCode();

        var changes = await Sync(device, first.Cursor);
        Assert.Equal(2, changes.Chores.Length);
        Assert.NotNull(changes.Chores.Single(c => c.Id == choreId).DeletedAt);
        Assert.Equal("Mop floor", changes.Chores.Single(c => c.Id == other).Name);

        // A brand-new device doesn't need tombstones.
        Assert.DoesNotContain((await Sync(device)).Chores, c => c.Id == choreId);
    }

    [Fact]
    public async Task Sync_never_leaks_another_habitat()
    {
        var (_, mine, _, myChore) = await Setup();
        var (_, theirs, _, theirChore) = await Setup();

        var sync = await Sync(mine);
        Assert.Contains(sync.Chores, c => c.Id == myChore);
        Assert.DoesNotContain(sync.Chores, c => c.Id == theirChore);
        Assert.Single(sync.Members);

        // Nor can its chores be written by id.
        Assert.Equal(HttpStatusCode.NotFound, (await mine.PatchAsJsonAsync($"/api/chores/{theirChore}", new { frequencyDays = 2 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await mine.PutAsJsonAsync($"/api/chores/{theirChore}", Bins(), Json.Options)).StatusCode);
    }

    [Fact]
    public async Task Bulk_import_is_all_or_nothing()
    {
        var (_, device, _, _) = await Setup();
        var good = Enumerable.Range(0, 50).Select(i => new BulkChore(Guid.NewGuid(), Bins() with { Name = $"Chore {i}" })).ToArray();

        var ok = await device.PostAsJsonAsync("/api/chores/bulk", new BulkChoresRequest(good), Json.Options);
        Assert.Equal(50, (await ok.Content.ReadFromJsonAsync<BulkChoresResponse>(Json.Options))!.Saved);

        var bad = new[] { new BulkChore(Guid.NewGuid(), Bins() with { Name = "Fine" }), new BulkChore(Guid.NewGuid(), Bins(every: 0)) };
        Assert.Equal(HttpStatusCode.BadRequest, (await device.PostAsJsonAsync("/api/chores/bulk", new BulkChoresRequest(bad), Json.Options)).StatusCode);
        Assert.DoesNotContain((await Sync(device)).Chores, c => c.Name == "Fine");
    }

    [Fact]
    public async Task Removing_a_member_frees_their_zones_and_needs_a_user()
    {
        var (entra, device, robin, _) = await Setup();
        var leo = Guid.NewGuid();
        (await device.PutAsJsonAsync($"/api/members/{leo}", new { name = "Leo", animal = "🐻" })).EnsureSuccessStatusCode();
        var leosChore = Guid.NewGuid();
        (await device.PutAsJsonAsync($"/api/chores/{leosChore}", Bins(owner: leo), Json.Options)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.Unauthorized, (await device.DeleteAsync($"/api/members/{leo}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await api.Client(entra).DeleteAsync($"/api/members/{robin}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await api.Client(entra).DeleteAsync($"/api/members/{leo}")).StatusCode);

        Assert.Null((await Chore(device, leosChore)).OwnerMemberId);
        Assert.DoesNotContain((await Sync(device)).Members, m => m.Id == leo);
    }
}
