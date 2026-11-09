using System.Security.Claims;
using Habitat.Api.Auth;
using Habitat.Api.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Habitat.Api.Features.Sync;

public record SyncRoom(Guid Id, string Name, string? Icon, int SortOrder, DateTimeOffset UpdatedAt, DateTimeOffset? DeletedAt);

public record SyncMember(Guid Id, string Name, string Animal, CompletionSound Sound, bool IsUser, DateTimeOffset UpdatedAt, DateTimeOffset? DeletedAt);

/// <summary>RoomId and Schedule are always set for habits, and FrequencyDays when the schedule is Every; quests have neither and may have no room.</summary>
public record SyncTend(
    Guid Id, TendKind Kind, string Name, Guid? RoomId, string? Group, string? Description, EffortTier Tier, EcologicalImpact Impact, EnergyTag[] Energy,
    HabitSchedule? Schedule, int? FrequencyDays, TendStatus Status, DateTimeOffset? CompletedAt,
    Guid? OwnerMemberId, bool? OpenToEveryone, Guid[] AvailableTo, Guid? ClaimMemberId, DateOnly? ClaimDay, int? BountyAcorns, DateTimeOffset? BountyPostedAt, DateTimeOffset? LastDoneAt, DateTimeOffset UpdatedAt, DateTimeOffset? DeletedAt);

/// <summary>MemberIds: primary first.</summary>
public record SyncWin(Guid Id, Guid TendId, string TendName, Guid? RoomId, string? RoomName, EffortTier Tier, int BountyAcorns, DateTimeOffset At, Guid[] MemberIds, DateTimeOffset? DeletedAt);

/// <summary>Every gift ever sent is synced (they're few), so purses can take off what was spent.</summary>
public record SyncGift(Guid Id, GiftKind Kind, Guid FromMemberId, Guid ToMemberId, int Acorns, DateTimeOffset SentAt, DateTimeOffset? SeenAt, DateTimeOffset? DeletedAt);

/// <summary>How many wins at a tier, all told (the pack's berries).</summary>
public record TierCount(EffortTier Tier, int Count);

/// <summary>One member's part of the wins at a tier: a win done by several counts as an equal fraction for each.</summary>
public record MemberTierShare(Guid MemberId, EffortTier Tier, double Share);

/// <summary>One member's part of the bounties paid: split equally between everyone on the win.</summary>
public record MemberBounty(Guid MemberId, double Acorns);

/// <summary>
/// Totals for the wins a first sync leaves out (older than its history), so acorn purses and the berry
/// jar count everything ever done. The app applies its own tier weights, so the weights live in one place.
/// </summary>
public record SyncEarlier(TierCount[] Tiers, MemberTierShare[] Shares, MemberBounty[] Bounties);

/// <summary>
/// Cursor: pass back as <c>since</c> next time. It's a string because rowversions can outgrow JavaScript numbers.
/// Full: true for a first sync (since=0), which skips removed rows and only includes recent wins.
/// OwnerMemberId: who started the habitat; always sent, since it isn't a synced row.
/// Earlier: on a full sync only, totals for the older wins it leaves out.
/// </summary>
public record SyncResponse(string Cursor, bool Full, Guid OwnerMemberId, SyncEarlier? Earlier, SyncRoom[] Rooms, SyncMember[] Members, SyncTend[] Tends, SyncWin[] Wins, SyncGift[] Gifts);

public static class SyncEndpoints
{
    /// <summary>A new device only needs recent wins (habits and quests carry their own last-done dates), but enough for six months of reports.</summary>
    public static readonly TimeSpan FirstSyncWinHistory = TimeSpan.FromDays(190);

    public static void MapSyncEndpoints(this IEndpointRouteBuilder api)
    {
        api.MapGet("/sync", Get)
            .RequireAuthorization(HabitatPolicies.Device)
            .WithSummary("Everything in the habitat that changed since the cursor, including removals.");
    }

    private static async Task<Results<Ok<SyncResponse>, ValidationProblem>> Get(string? since, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
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
            .Select(m => new SyncMember(m.Id, m.Name, m.Animal, m.Sound, userMembers.Contains(m.Id), m.UpdatedAt, m.DeletedAt))
            .ToArrayAsync();

        var tends = await db.Tends
            .Where(t => t.RowVersion > from && t.RowVersion < upper && (!full || t.DeletedAt == null))
            .Select(t => new SyncTend(
                t.Id, t.Kind, t.Name, t.RoomId, t.Group, t.Description, t.Tier, t.Impact, t.Energy.ToArray(),
                t.Schedule, t.FrequencyDays, t.Status, t.CompletedAt,
                t.OwnerMemberId, t.OpenToEveryone, t.AvailableTo.Select(a => a.MemberId).ToArray(), t.ClaimMemberId, t.ClaimDay, t.BountyAcorns, t.BountyPostedAt, t.LastDoneAt, t.UpdatedAt, t.DeletedAt))
            .ToArrayAsync();

        var wins = await db.Wins
            .Where(w => w.RowVersion > from && w.RowVersion < upper && (!full || (w.DeletedAt == null && w.At >= winsSince)))
            .Select(w => new SyncWin(
                w.Id, w.TendId, w.TendName, w.RoomId, w.RoomName, w.Tier, w.BountyAcorns, w.At,
                w.Members.OrderByDescending(m => m.IsPrimary).Select(m => m.MemberId).ToArray(),
                w.DeletedAt))
            .ToArrayAsync();

        var gifts = await db.Gifts
            .Where(g => g.RowVersion > from && g.RowVersion < upper && (!full || g.DeletedAt == null))
            .Select(g => new SyncGift(g.Id, g.Kind, g.FromMemberId, g.ToMemberId, g.Acorns, g.SentAt, g.SeenAt, g.DeletedAt))
            .ToArrayAsync();

        var householdId = principal.HouseholdId();
        var owner = await db.Households.Where(h => h.Id == householdId).Select(h => h.OwnerMemberId).FirstAsync();
        var cursor = Math.Max(from, upper - 1);
        var earlier = full ? await Earlier(db, winsSince, upper) : null;
        return TypedResults.Ok(new SyncResponse(cursor.ToString(), full, owner, earlier, rooms, members, tends, wins, gifts));
    }

    /// <summary>Totals for the wins a full sync leaves out. Added up here, since a habitat's older wins are few enough to read once per new device.</summary>
    private static async Task<SyncEarlier> Earlier(HabitatDb db, DateTimeOffset before, long upper)
    {
        var older = await db.Wins
            .Where(w => w.DeletedAt == null && w.At < before && w.RowVersion < upper)
            .Select(w => new { w.Tier, w.BountyAcorns, MemberIds = w.Members.Select(m => m.MemberId).ToArray() })
            .ToArrayAsync();
        var credits = older.SelectMany(w => w.MemberIds.Select(m => (MemberId: m, w.Tier, Share: 1.0 / w.MemberIds.Length, Bounty: (double)w.BountyAcorns / w.MemberIds.Length))).ToArray();
        return new SyncEarlier(
            [.. older.GroupBy(w => w.Tier).Select(g => new TierCount(g.Key, g.Count()))],
            [.. credits.GroupBy(c => (c.MemberId, c.Tier)).Select(g => new MemberTierShare(g.Key.MemberId, g.Key.Tier, g.Sum(c => c.Share)))],
            [.. credits.Where(c => c.Bounty > 0).GroupBy(c => c.MemberId).Select(g => new MemberBounty(g.Key, g.Sum(c => c.Bounty)))]);
    }
}
