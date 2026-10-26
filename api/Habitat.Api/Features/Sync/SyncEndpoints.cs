using Habitat.Api.Auth;
using Habitat.Api.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Habitat.Api.Features.Sync;

public record SyncMember(Guid Id, string Name, string Animal, bool IsUser, DateTimeOffset UpdatedAt, DateTimeOffset? DeletedAt);

public record SyncChore(
    Guid Id, string Name, string Room, string? Group, EffortTier Tier, EnergyTag[] Energy, int? FrequencyDays, ChoreStatus Status,
    Guid? OwnerMemberId, Guid? ClaimMemberId, DateOnly? ClaimDay, DateTimeOffset? LastDoneAt, DateTimeOffset UpdatedAt, DateTimeOffset? DeletedAt);

/// <summary>MemberIds: primary first.</summary>
public record SyncWin(Guid Id, Guid ChoreId, string ChoreName, string Room, DateTimeOffset At, Guid[] MemberIds, DateTimeOffset? DeletedAt);

/// <summary>
/// Cursor: pass back as <c>since</c> next time. It's a string because rowversions can outgrow JavaScript numbers.
/// Full: true for a first sync (since=0), which skips removed rows and only includes recent wins.
/// </summary>
public record SyncResponse(string Cursor, bool Full, SyncMember[] Members, SyncChore[] Chores, SyncWin[] Wins);

public static class SyncEndpoints
{
    /// <summary>A new device only needs recent wins: chores carry their own last-done dates.</summary>
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

        var members = await db.Members
            .Where(m => m.RowVersion > from && m.RowVersion < upper && (!full || m.DeletedAt == null))
            .Select(m => new SyncMember(m.Id, m.Name, m.Animal, userMembers.Contains(m.Id), m.UpdatedAt, m.DeletedAt))
            .ToArrayAsync();

        var chores = await db.Chores
            .Where(c => c.RowVersion > from && c.RowVersion < upper && (!full || c.DeletedAt == null))
            .Select(c => new SyncChore(
                c.Id, c.Name, c.Room, c.Group, c.Tier, c.Energy.ToArray(), c.FrequencyDays, c.Status,
                c.OwnerMemberId, c.ClaimMemberId, c.ClaimDay, c.LastDoneAt, c.UpdatedAt, c.DeletedAt))
            .ToArrayAsync();

        var wins = await db.Wins
            .Where(w => w.RowVersion > from && w.RowVersion < upper && (!full || (w.DeletedAt == null && w.At >= winsSince)))
            .Select(w => new SyncWin(
                w.Id, w.ChoreId, w.ChoreName, w.Room, w.At,
                w.Members.OrderByDescending(m => m.IsPrimary).Select(m => m.MemberId).ToArray(),
                w.DeletedAt))
            .ToArrayAsync();

        var cursor = Math.Max(from, upper - 1);
        return TypedResults.Ok(new SyncResponse(cursor.ToString(), full, members, chores, wins));
    }
}
