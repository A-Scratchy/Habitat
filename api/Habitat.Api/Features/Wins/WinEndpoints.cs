using System.Security.Claims;
using Habitat.Api.Auth;
using Habitat.Api.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Habitat.Api.Features.Wins;

/// <summary>MemberIds: everyone who did it, primary first. At: when it was done (may be backdated).</summary>
public record WinInput(Guid ChoreId, Guid[] MemberIds, DateTimeOffset At);

public static class WinEndpoints
{
    /// <summary>Phones' clocks drift; allow a little "future".</summary>
    private static readonly TimeSpan ClockSkew = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan OldestBackdate = TimeSpan.FromDays(366);
    private const int MaxMembers = 12;

    public static void MapWinEndpoints(this IEndpointRouteBuilder api)
    {
        var wins = api.MapGroup("/wins").RequireAuthorization(HabitatPolicies.Device);
        wins.MapPut("/{id:guid}", Put).WithSummary("Log a win. Safe to repeat: the same id is only ever logged once.");
        wins.MapDelete("/{id:guid}", Delete).WithSummary("Undo a win. The chore's last-done date goes back to what it was.");
    }

    private static async Task<IResult> Put(Guid id, WinInput input, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        var existing = await db.Wins.IgnoreQueryFilters().Where(w => w.Id == id).Select(w => w.HouseholdId).ToListAsync();
        if (existing.Count > 0)
            // An outbox retry of a win we already have: nothing to do.
            return existing[0] == principal.HouseholdId() ? TypedResults.NoContent() : TypedResults.NotFound();

        var now = clock.GetUtcNow();
        var errors = new Dictionary<string, string[]>();
        var memberIds = input.MemberIds ?? [];
        if (memberIds.Length is 0 or > MaxMembers || memberIds.Distinct().Count() != memberIds.Length)
            errors["memberIds"] = [$"Between 1 and {MaxMembers} different members."];
        else if (await db.Members.CountAsync(m => memberIds.Contains(m.Id) && m.DeletedAt == null) != memberIds.Length)
            errors["memberIds"] = ["Everyone must be a member of this habitat."];
        if (input.At > now + ClockSkew) errors["at"] = ["Can't be in the future."];
        if (input.At < now - OldestBackdate) errors["at"] = ["Can't be more than a year ago."];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        var chore = await db.Chores.FirstOrDefaultAsync(c => c.Id == input.ChoreId && c.DeletedAt == null);
        if (chore is null) return TypedResults.NotFound();

        db.Wins.Add(new Win
        {
            Id = id,
            HouseholdId = chore.HouseholdId,
            ChoreId = chore.Id,
            ChoreName = chore.Name,
            Room = chore.Room,
            At = input.At,
            LoggedAt = now,
            LoggedByDeviceId = principal.DeviceId(),
            Members = [.. memberIds.Select((m, i) => new WinMember { MemberId = m, IsPrimary = i == 0 })],
            UpdatedAt = now,
        });

        // Only ever forward: a backdated win can't make a chore look more overdue than it is.
        if (chore.LastDoneAt is null || input.At > chore.LastDoneAt) chore.LastDoneAt = input.At;
        // Doing a claimed chore today fulfils the claim.
        if (chore.ClaimDay is { } claimDay)
        {
            var zone = await db.TimeZoneOf(chore.HouseholdId);
            if (claimDay == HouseholdTime.LocalDate(zone, now) && HouseholdTime.LocalDate(zone, input.At) == claimDay)
                (chore.ClaimMemberId, chore.ClaimDay) = (null, null);
        }
        chore.UpdatedAt = now;

        await db.SaveChangesAsync();
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound>> Delete(Guid id, HabitatDb db, TimeProvider clock)
    {
        var win = await db.Wins.FirstOrDefaultAsync(w => w.Id == id);
        if (win is null) return TypedResults.NotFound();
        if (win.DeletedAt is not null) return TypedResults.NoContent();

        var now = clock.GetUtcNow();
        win.DeletedAt = win.UpdatedAt = now;

        var chore = await db.Chores.FirstOrDefaultAsync(c => c.Id == win.ChoreId);
        if (chore is not null)
        {
            var latestWin = await db.Wins
                .Where(w => w.ChoreId == chore.Id && w.Id != id && w.DeletedAt == null)
                .MaxAsync(w => (DateTimeOffset?)w.At);
            var lastDone = new[] { chore.SeedLastDoneAt, latestWin }.Max();
            if (lastDone != chore.LastDoneAt) (chore.LastDoneAt, chore.UpdatedAt) = (lastDone, now);
        }

        await db.SaveChangesAsync();
        return TypedResults.NoContent();
    }
}
