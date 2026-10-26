using System.Net;
using System.Net.Http.Json;
using Habitat.Api.Data;
using Habitat.Api.Features.Sync;
using Habitat.Api.Features.Tends;
using Habitat.Api.Features.Wins;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Habitat.Api.Tests;

[Collection(ApiCollection.Name)]
public class TendWinSyncTests(ApiFixture api)
{
    private static TendInput Bins(int every = 3, Guid? owner = null, DateTimeOffset? seed = null) =>
        new(TendKind.Habit, "Empty Bin", "Kitchen", "Empty Bins", null, EffortTier.Tortoise, [EnergyTag.Brainless], every, TendStatus.Active, owner, seed);

    private static TendInput Tip(string? description = null, DateTimeOffset? completedAt = null) =>
        new(TendKind.Quest, "Go to tip", "General", null, description, EffortTier.Elephant, [], null, TendStatus.Active, null, null, completedAt);

    /// <summary>A fresh habitat with Robin, a device client and one tend.</summary>
    private async Task<(string Entra, HttpClient Device, Guid Robin, Guid Tend)> Setup(TendInput? tend = null)
    {
        var (entra, session) = await api.NewHousehold();
        var device = api.Client(session.DeviceToken);
        var tendId = Guid.NewGuid();
        (await device.PutAsJsonAsync($"/api/tends/{tendId}", tend ?? Bins(), Json.Options)).EnsureSuccessStatusCode();
        return (entra, device, session.MemberId, tendId);
    }

    private static async Task<SyncResponse> Sync(HttpClient device, string since = "0") =>
        (await device.GetFromJsonAsync<SyncResponse>($"/api/sync?since={since}", Json.Options))!;

    private static async Task<SyncTend> Tend(HttpClient device, Guid id) => (await Sync(device)).Tends.Single(c => c.Id == id);

    private Task<HttpResponseMessage> LogWin(HttpClient device, Guid tendId, Guid[] members, DateTimeOffset? at = null, Guid? winId = null) =>
        device.PutAsJsonAsync($"/api/wins/{winId ?? Guid.NewGuid()}", new WinInput(tendId, members, at ?? api.Clock.GetUtcNow()), Json.Options);

    private static Task<HttpResponseMessage> PutRaw(HttpClient device, Guid id, string json) =>
        device.PutAsync($"/api/tends/{id}", new StringContent(json, System.Text.Encoding.UTF8, "application/json"));

    [Fact]
    public async Task Habits_and_quests_round_trip_through_sync()
    {
        var (_, device, _, habitId) = await Setup();
        var questId = Guid.NewGuid();
        (await device.PutAsJsonAsync($"/api/tends/{questId}", Tip("Take the bags\nAnd the old lamp"), Json.Options)).EnsureSuccessStatusCode();

        var h = await Tend(device, habitId);
        Assert.Equal((TendKind.Habit, "Empty Bin", "Kitchen", "Empty Bins", EffortTier.Tortoise, (int?)3, TendStatus.Active), (h.Kind, h.Name, h.Room, h.Group, h.Tier, h.FrequencyDays, h.Status));
        Assert.Equal([EnergyTag.Brainless], h.Energy);

        var q = await Tend(device, questId);
        Assert.Equal((TendKind.Quest, (int?)null, (DateTimeOffset?)null, "Take the bags\nAnd the old lamp"), (q.Kind, q.FrequencyDays, q.CompletedAt, q.Description));
    }

    [Theory]
    [InlineData("""{ "name": "X", "room": "Hall", "tier": "Bee", "status": "Active", "frequencyDays": 7 }""", "kind")]
    [InlineData("""{ "kind": "Habit", "name": "X", "room": "Hall", "status": "Active", "frequencyDays": 7 }""", "tier")]
    [InlineData("""{ "kind": "Habit", "name": "X", "room": "Hall", "tier": "Bee", "frequencyDays": 7 }""", "status")]
    [InlineData("""{ "kind": "Habit", "name": "X", "room": "Hall", "tier": "Bee", "status": "Active" }""", "frequencyDays")]
    [InlineData("""{ "kind": "Quest", "name": "X", "room": "Hall", "tier": "Bee", "status": "Active", "frequencyDays": 7 }""", "frequencyDays")]
    [InlineData("""{ "kind": "Chore", "name": "X", "room": "Hall", "tier": "Bee", "status": "Active" }""", null)]
    public async Task Nothing_is_assumed_kind_tier_status_and_schedule_must_be_right(string json, string? field)
    {
        var (_, device, _, _) = await Setup();
        var res = await PutRaw(device, Guid.NewGuid(), json);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        if (field is not null) Assert.Contains($"\"{field}\"", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task The_database_itself_rejects_a_half_habit_half_quest()
    {
        var (_, _, _, habitId) = await Setup();
        using var scope = api.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HabitatDb>();
        var raw = db.Tends.IgnoreQueryFilters().Where(t => t.Id == habitId);

        await Assert.ThrowsAnyAsync<Exception>(() => raw.ExecuteUpdateAsync(s => s.SetProperty(t => t.FrequencyDays, (int?)null)));
        await Assert.ThrowsAnyAsync<Exception>(() => raw.ExecuteUpdateAsync(s => s.SetProperty(t => t.CompletedAt, DateTimeOffset.UtcNow)));
        await Assert.ThrowsAnyAsync<Exception>(() => raw.ExecuteUpdateAsync(s => s.SetProperty(t => t.Kind, TendKind.Quest)));
    }

    [Fact]
    public async Task Switching_kind_is_a_full_replace_not_a_patch()
    {
        var (_, device, _, habitId) = await Setup();
        Assert.Equal(HttpStatusCode.BadRequest, (await device.PatchAsJsonAsync($"/api/tends/{habitId}", new { kind = "Quest" })).StatusCode);

        (await device.PutAsJsonAsync($"/api/tends/{habitId}", Bins() with { Kind = TendKind.Quest, FrequencyDays = null }, Json.Options)).EnsureSuccessStatusCode();
        var t = await Tend(device, habitId);
        Assert.Equal((TendKind.Quest, (int?)null), (t.Kind, t.FrequencyDays));
    }

    [Fact]
    public async Task Patch_changes_only_what_was_sent_and_can_clear_fields()
    {
        var (_, device, _, habitId) = await Setup();

        var res = await device.PatchAsJsonAsync($"/api/tends/{habitId}", new { frequencyDays = 14, group = (string?)null, tier = "Sloth", description = "Lid in the cupboard" });
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);

        var t = await Tend(device, habitId);
        Assert.Equal((14, (string?)null, EffortTier.Sloth, "Empty Bin", "Kitchen", "Lid in the cupboard"), (t.FrequencyDays, t.Group, t.Tier, t.Name, t.Room, t.Description));
    }

    [Theory]
    [InlineData("""{ "frequencyDays": 0 }""")]
    [InlineData("""{ "frequencyDays": null }""")]
    [InlineData("""{ "tier": "Hippo" }""")]
    [InlineData("""{ "name": "" }""")]
    [InlineData("""{ "lastDoneAt": "2026-01-01T00:00:00Z" }""")]
    [InlineData("""{ "completedAt": "2026-01-01T00:00:00Z" }""")]
    [InlineData("""{ "ownerMemberId": "00000000-0000-0000-0000-000000000001" }""")]
    public async Task Patch_rejects_bad_or_server_owned_fields(string body)
    {
        var (_, device, _, habitId) = await Setup();
        var res = await device.PatchAsync($"/api/tends/{habitId}", new StringContent(body, System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Quests_cannot_be_given_a_schedule_by_patch()
    {
        var (_, device, _, questId) = await Setup(Tip());
        Assert.Equal(HttpStatusCode.BadRequest, (await device.PatchAsJsonAsync($"/api/tends/{questId}", new { frequencyDays = 7 })).StatusCode);
    }

    [Fact]
    public async Task Doing_a_quest_finishes_it_undo_reopens_it_and_restart_brings_it_back()
    {
        var (_, device, robin, questId) = await Setup(Tip());
        var winId = Guid.NewGuid();

        (await LogWin(device, questId, [robin], winId: winId)).EnsureSuccessStatusCode();
        Assert.Equal(api.Clock.GetUtcNow(), (await Tend(device, questId)).CompletedAt);

        (await device.DeleteAsync($"/api/wins/{winId}")).EnsureSuccessStatusCode();
        Assert.Null((await Tend(device, questId)).CompletedAt);

        (await LogWin(device, questId, [robin])).EnsureSuccessStatusCode();
        Assert.NotNull((await Tend(device, questId)).CompletedAt);
        Assert.Equal(HttpStatusCode.NoContent, (await device.PostAsync($"/api/tends/{questId}/restart", null)).StatusCode);
        Assert.Null((await Tend(device, questId)).CompletedAt);
    }

    [Fact]
    public async Task Only_quests_restart_and_import_can_create_a_finished_quest()
    {
        var (_, device, _, habitId) = await Setup();
        Assert.Equal(HttpStatusCode.Conflict, (await device.PostAsync($"/api/tends/{habitId}/restart", null)).StatusCode);

        var finished = Guid.NewGuid();
        var at = api.Clock.GetUtcNow().AddDays(-5);
        (await device.PutAsJsonAsync($"/api/tends/{finished}", Tip(completedAt: at), Json.Options)).EnsureSuccessStatusCode();
        Assert.Equal(at, (await Tend(device, finished)).CompletedAt);
    }

    [Fact]
    public async Task Removed_tends_stay_removed_even_if_an_offline_edit_arrives_later()
    {
        var (_, device, _, habitId) = await Setup();
        Assert.Equal(HttpStatusCode.NoContent, (await device.DeleteAsync($"/api/tends/{habitId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Gone, (await device.PutAsJsonAsync($"/api/tends/{habitId}", Bins(), Json.Options)).StatusCode);
        Assert.Equal(HttpStatusCode.Gone, (await device.PatchAsJsonAsync($"/api/tends/{habitId}", new { frequencyDays = 2 })).StatusCode);
    }

    [Fact]
    public async Task Wins_set_last_done_and_never_move_it_backwards()
    {
        var (_, device, robin, habitId) = await Setup();
        var now = api.Clock.GetUtcNow();

        (await LogWin(device, habitId, [robin], now.AddHours(-1))).EnsureSuccessStatusCode();
        Assert.Equal(now.AddHours(-1), (await Tend(device, habitId)).LastDoneAt);

        // "Forgot to tick it off on Tuesday": logged, but it stays as recently done as it was.
        (await LogWin(device, habitId, [robin], now.AddDays(-3))).EnsureSuccessStatusCode();
        Assert.Equal(now.AddHours(-1), (await Tend(device, habitId)).LastDoneAt);
    }

    [Fact]
    public async Task Undo_puts_last_done_back_to_the_previous_win_or_the_imported_date()
    {
        var seed = api.Clock.GetUtcNow().AddDays(-10);
        var (_, device, robin, habitId) = await Setup(Bins(seed: seed));
        Assert.Equal(seed, (await Tend(device, habitId)).LastDoneAt);

        var older = Guid.NewGuid();
        var newer = Guid.NewGuid();
        (await LogWin(device, habitId, [robin], api.Clock.GetUtcNow().AddDays(-2), older)).EnsureSuccessStatusCode();
        (await LogWin(device, habitId, [robin], api.Clock.GetUtcNow(), newer)).EnsureSuccessStatusCode();

        (await device.DeleteAsync($"/api/wins/{newer}")).EnsureSuccessStatusCode();
        Assert.Equal(api.Clock.GetUtcNow().AddDays(-2), (await Tend(device, habitId)).LastDoneAt);

        (await device.DeleteAsync($"/api/wins/{older}")).EnsureSuccessStatusCode();
        Assert.Equal(seed, (await Tend(device, habitId)).LastDoneAt);
    }

    [Fact]
    public async Task Logging_the_same_win_twice_records_it_once()
    {
        var (_, device, robin, habitId) = await Setup();
        var winId = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.NoContent, (await LogWin(device, habitId, [robin], winId: winId)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await LogWin(device, habitId, [robin], winId: winId)).StatusCode);
        Assert.Single((await Sync(device)).Wins, w => w.Id == winId);
    }

    [Fact]
    public async Task Wins_credit_everyone_tagged_primary_first()
    {
        var (_, device, robin, habitId) = await Setup();
        var leo = Guid.NewGuid();
        (await device.PutAsJsonAsync($"/api/members/{leo}", new { name = "Leo", animal = "🐻" })).EnsureSuccessStatusCode();

        var winId = Guid.NewGuid();
        (await LogWin(device, habitId, [leo, robin], winId: winId)).EnsureSuccessStatusCode();
        Assert.Equal([leo, robin], (await Sync(device)).Wins.Single(w => w.Id == winId).MemberIds);
    }

    [Fact]
    public async Task Wins_are_checked()
    {
        var (_, device, robin, habitId) = await Setup();
        var (_, otherSession) = await api.NewHousehold("Elsewhere");
        var now = api.Clock.GetUtcNow();

        Assert.Equal(HttpStatusCode.BadRequest, (await LogWin(device, habitId, [otherSession.MemberId])).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await LogWin(device, habitId, [])).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await LogWin(device, habitId, [robin, robin])).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await LogWin(device, habitId, [robin], now.AddHours(1))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await LogWin(device, habitId, [robin], now.AddYears(-2))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await LogWin(device, Guid.NewGuid(), [robin])).StatusCode);
    }

    [Fact]
    public async Task Claims_last_for_the_household_day_and_doing_it_fulfils_them()
    {
        var (_, device, robin, habitId) = await Setup();
        (await device.PutAsJsonAsync($"/api/tends/{habitId}/claim", new ClaimRequest(robin), Json.Options)).EnsureSuccessStatusCode();

        var claimed = await Tend(device, habitId);
        Assert.Equal((robin, DateOnly.FromDateTime(api.Clock.GetUtcNow().UtcDateTime)), (claimed.ClaimMemberId!.Value, claimed.ClaimDay!.Value));

        (await LogWin(device, habitId, [robin])).EnsureSuccessStatusCode();
        Assert.Null((await Tend(device, habitId)).ClaimMemberId);
    }

    [Fact]
    public async Task Sync_returns_only_changes_since_the_cursor_including_removals()
    {
        var (_, device, _, habitId) = await Setup();
        var first = await Sync(device);
        Assert.True(first.Full);

        var nothing = await Sync(device, first.Cursor);
        Assert.False(nothing.Full);
        Assert.Empty(nothing.Tends);
        Assert.Empty(nothing.Wins);

        var other = Guid.NewGuid();
        (await device.PutAsJsonAsync($"/api/tends/{other}", Bins() with { Name = "Mop floor" }, Json.Options)).EnsureSuccessStatusCode();
        (await device.DeleteAsync($"/api/tends/{habitId}")).EnsureSuccessStatusCode();

        var changes = await Sync(device, first.Cursor);
        Assert.Equal(2, changes.Tends.Length);
        Assert.NotNull(changes.Tends.Single(c => c.Id == habitId).DeletedAt);
        Assert.Equal("Mop floor", changes.Tends.Single(c => c.Id == other).Name);

        // A brand-new device doesn't need tombstones.
        Assert.DoesNotContain((await Sync(device)).Tends, c => c.Id == habitId);
    }

    [Fact]
    public async Task Sync_never_leaks_another_habitat()
    {
        var (_, mine, _, myTend) = await Setup();
        var (_, theirs, _, theirTend) = await Setup();

        var sync = await Sync(mine);
        Assert.Contains(sync.Tends, c => c.Id == myTend);
        Assert.DoesNotContain(sync.Tends, c => c.Id == theirTend);
        Assert.Single(sync.Members);

        // Nor can its tends be written by id.
        Assert.Equal(HttpStatusCode.NotFound, (await mine.PatchAsJsonAsync($"/api/tends/{theirTend}", new { frequencyDays = 2 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await mine.PutAsJsonAsync($"/api/tends/{theirTend}", Bins(), Json.Options)).StatusCode);
    }

    [Fact]
    public async Task Bulk_import_is_all_or_nothing()
    {
        var (_, device, _, _) = await Setup();
        var good = Enumerable.Range(0, 50).Select(i => new BulkTend(Guid.NewGuid(), i % 2 == 0 ? Bins() with { Name = $"Habit {i}" } : Tip() with { Name = $"Quest {i}" })).ToArray();

        var ok = await device.PostAsJsonAsync("/api/tends/bulk", new BulkTendsRequest(good), Json.Options);
        Assert.Equal(50, (await ok.Content.ReadFromJsonAsync<BulkTendsResponse>(Json.Options))!.Saved);

        var bad = new[] { new BulkTend(Guid.NewGuid(), Bins() with { Name = "Fine" }), new BulkTend(Guid.NewGuid(), Tip() with { FrequencyDays = 7 }) };
        Assert.Equal(HttpStatusCode.BadRequest, (await device.PostAsJsonAsync("/api/tends/bulk", new BulkTendsRequest(bad), Json.Options)).StatusCode);
        Assert.DoesNotContain((await Sync(device)).Tends, c => c.Name == "Fine");
    }

    [Fact]
    public async Task Removing_a_member_frees_their_zones_and_needs_a_user()
    {
        var (entra, device, robin, _) = await Setup();
        var leo = Guid.NewGuid();
        (await device.PutAsJsonAsync($"/api/members/{leo}", new { name = "Leo", animal = "🐻" })).EnsureSuccessStatusCode();
        var leosHabit = Guid.NewGuid();
        (await device.PutAsJsonAsync($"/api/tends/{leosHabit}", Bins(owner: leo), Json.Options)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.Unauthorized, (await device.DeleteAsync($"/api/members/{leo}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await api.Client(entra).DeleteAsync($"/api/members/{robin}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await api.Client(entra).DeleteAsync($"/api/members/{leo}")).StatusCode);

        Assert.Null((await Tend(device, leosHabit)).OwnerMemberId);
        Assert.DoesNotContain((await Sync(device)).Members, m => m.Id == leo);
    }
}
