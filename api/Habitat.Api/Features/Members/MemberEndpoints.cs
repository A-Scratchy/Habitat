using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Habitat.Api.Auth;
using Habitat.Api.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Habitat.Api.Features.Members;

public record MemberInput(
    [Required, StringLength(40, MinimumLength = 1)] string Name,
    [Required, StringLength(16, MinimumLength = 1)] string Animal);

public static class MemberEndpoints
{
    public static void MapMemberEndpoints(this IEndpointRouteBuilder api)
    {
        api.MapPut("/members/{id:guid}", Put)
            .RequireAuthorization(HabitatPolicies.Device)
            .WithSummary("Add someone to the pack, or change their name or animal. Safe to repeat.");

        api.MapDelete("/members/{id:guid}", Delete)
            .RequireAuthorization(HabitatPolicies.User)
            .WithSummary("Remove someone from the pack. Their past wins stay.");
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> Put(Guid id, MemberInput input, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        var member = await db.Members.FirstOrDefaultAsync(m => m.Id == id);
        if (member is null)
        {
            // A GUID that already exists in another household is never ours to touch.
            if (await db.Members.IgnoreQueryFilters().AnyAsync(m => m.Id == id)) return TypedResults.NotFound();
            member = new Member { Id = id, HouseholdId = principal.HouseholdId(), Name = "", Animal = "" };
            db.Members.Add(member);
        }
        else if (member.DeletedAt is not null)
        {
            return TypedResults.Problem("That member was removed.", statusCode: StatusCodes.Status410Gone);
        }

        member.Name = input.Name.Trim();
        member.Animal = input.Animal;
        member.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync();
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> Delete(Guid id, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        var member = await db.Members.FirstOrDefaultAsync(m => m.Id == id);
        if (member is null) return TypedResults.NotFound();
        if (member.DeletedAt is not null) return TypedResults.NoContent();

        var callerId = principal.UserId();
        if (await db.Users.AnyAsync(u => u.Id == callerId && u.MemberId == id))
            return TypedResults.Problem("You can't remove yourself.", statusCode: StatusCodes.Status409Conflict);

        var now = clock.GetUtcNow();
        member.DeletedAt = now;
        member.UpdatedAt = now;
        // Their login (if any) goes with them, and their zones and claims are freed up.
        db.Users.RemoveRange(await db.Users.Where(u => u.MemberId == id).ToListAsync());
        foreach (var tend in await db.Tends.Where(c => c.OwnerMemberId == id || c.ClaimMemberId == id).ToListAsync())
        {
            if (tend.OwnerMemberId == id) tend.OwnerMemberId = null;
            if (tend.ClaimMemberId == id) (tend.ClaimMemberId, tend.ClaimDay) = (null, null);
            tend.UpdatedAt = now;
        }
        await db.SaveChangesAsync();
        return TypedResults.NoContent();
    }
}
