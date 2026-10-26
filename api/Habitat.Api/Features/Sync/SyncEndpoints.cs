using Habitat.Api.Auth;
using Habitat.Api.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Habitat.Api.Features.Sync;

public record SyncRoom(Guid Id, string Name, string? Icon, int SortOrder, DateTimeOffset UpdatedAt, DateTimeOffset? DeletedAt);

public record SyncMember(Guid Id, string Name, string Animal, bool IsUser, DateTimeOffset UpdatedAt, DateTimeOffset? DeletedAt);

/// <summary>FrequencyDays is set exactly when Kind is Habit; CompletedAt only ever for quests.</summary>
public record SyncTend(
    Guid Id, TendKind Kind, string Name, Guid RoomId, string? Group, string? Description, EffortTier Tier, EcologicalImpact Impact, EnergyTag[] Energy,
    int? FrequencyDays, TendStatus Status, DateTimeOffset? CompletedAt,
    Guid? OwnerMemberId, Guid? ClaimMemberId, DateOnly? ClaimDay, DateTimeOffset? LastDoneAt, DateTimeOffset UpdatedAt, DateTimeOffset? DeletedAt);

/// <summary>MemberIds: primary first.</summary>
public record SyncWin(Guid Id, Guid TendId, string TendName, Guid RoomId, string RoomName, DateTimeOffset At, Guid[] MemberIds, DateTimeOffset? DeletedAt);

/// <summary>
/// Cursor: pass back as <c>since</c> next time. It's a string because rowversions can outgrow JavaScript numbers.
/// Full: true for a first sync (since=0), which skips removed rows and only includes recent wins.
/// </summary>
public record SyncResponse(string Cursor, bool Full, SyncRoom[] Rooms, SyncMember[] Members, SyncTend[] Tends, SyncWin[] Wins);

public static class SyncEndpoints
{
    /// <summary>A new device only needs recent wins: habits and quests carry their own last-done dates.</summary>
    public static readonly TimeSpan FirstSyncWinHistory = TimeSpan.FromDays(35);

    public static void MapSyncEndpoints(this IEndpointRouteBuilder api)
    {
        api.MapGet("/sync", Get)
            .RequireAuthorization(HabitatPolicies.Device)
            .WithSummary("Everything in the habitat that changed since the cursor, including removals.");
    }

    private static async Task<Results<Ok<SyncResponse>, ValidationProblem>> Get(string? since, HabitatDb db, TimeProvider clock)
    {
        if (!long.TryParse(since ?? "0", out var from) || from < 0)
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["since"] = ["A cursor from a previous sync, or 0."] });

        // Every row below this is committed, so nothing still in flight can be skipped; it arrives next time.
        var upper = await db.Database.SqlQueryRaw<long>("SELECT CAST(MIN_ACTIVE_ROWVERSION() AS bigint) AS [Value]").SingleAsync();
        var full = from == 0;
        var winsSince = clock.GetUtcNow() - FirstSyncWinHistory;
        var userMembers = db.Users.Where(u => u.ApprovedAt != null).Select(u => u.MemberId);

        var rooms = await db.Rooms
            .Where(r => r.RowVersion > from && r.RowVersion < upper && (!full || r.DeletedAt == null))
            .Select(r => new SyncRoom(r.Id, r.Name, r.Icon, r.SortOrder, r.UpdatedAt, r.DeletedAt))
            .ToArrayAsync();

        var members = await db.Members
            .Where(m => m.RowVersion > from && m.RowVersion < upper && (!full || m.DeletedAt == null))
            .Select(m => new SyncMember(m.Id, m.Name, m.Animal, userMembers.Contains(m.Id), m.UpdatedAt, m.DeletedAt))
            .ToArrayAsync();

        var tends = await db.Tends
            .Where(t => t.RowVersion > from && t.RowVersion < upper && (!full || t.DeletedAt == null))
            .Select(t => new SyncTend(
                t.Id, t.Kind, t.Name, t.RoomId, t.Group, t.Description, t.Tier, t.Impact, t.Energy.ToArray(),
                t.FrequencyDays, t.Status, t.CompletedAt,
                t.OwnerMemberId, t.ClaimMemberId, t.ClaimDay, t.LastDoneAt, t.UpdatedAt, t.DeletedAt))
            .ToArrayAsync();

        var wins = await db.Wins
            .Where(w => w.RowVersion > from && w.RowVersion < upper && (!full || (w.DeletedAt == null && w.At >= winsSince)))
            .Select(w => new SyncWin(
                w.Id, w.TendId, w.TendName, w.RoomId, w.RoomName, w.At,
                w.Members.OrderByDescending(m => m.IsPrimary).Select(m => m.MemberId).ToArray(),
                w.DeletedAt))
            .ToArrayAsync();

        var cursor = Math.Max(from, upper - 1);
        return TypedResults.Ok(new SyncResponse(cursor.ToString(), full, rooms, members, tends, wins));
    }
}
