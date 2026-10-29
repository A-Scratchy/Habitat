using System.Security.Claims;
using Habitat.Api.Auth;
using Habitat.Api.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Habitat.Api.Features.Presence;

/// <summary>MemberId: who is using the app on this device now, or null when they've stopped (the app was put away).</summary>
public record PresenceInput(Guid? MemberId);

/// <summary>Everyone in the habitat using the app right now, on any device.</summary>
public record PresenceResponse(Guid[] Active);

/// <summary>
/// "Who's around": each device says who is using it every so often while the app is open, and gets back
/// everyone active in the habitat. Kept apart from sync on purpose: it changes constantly and isn't data
/// anyone needs to keep, so it never touches the synced rows or their cursor.
/// </summary>
public static class PresenceEndpoints
{
    /// <summary>How long someone counts as active after their device last checked in. Devices check in every 30 seconds.</summary>
    public static readonly TimeSpan ActiveWindow = TimeSpan.FromSeconds(90);

    public static void MapPresenceEndpoints(this IEndpointRouteBuilder api)
    {
        api.MapPut("/presence", Put)
            .RequireAuthorization(HabitatPolicies.Device)
            .WithSummary("Say who is using this device right now (or nobody), and see who's active in the habitat.");
    }

    private static async Task<Results<Ok<PresenceResponse>, ValidationProblem>> Put(PresenceInput input, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        if (input.MemberId is { } memberId && !await db.Members.AnyAsync(m => m.Id == memberId && m.DeletedAt == null))
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["memberId"] = ["Not a member of this habitat."] });

        var now = clock.GetUtcNow();
        var deviceId = principal.DeviceId();
        await db.Devices
            .Where(d => d.Id == deviceId)
            .ExecuteUpdateAsync(s => s.SetProperty(d => d.ActiveMemberId, input.MemberId).SetProperty(d => d.ActiveAt, input.MemberId == null ? null : now));

        var since = now - ActiveWindow;
        var active = await db.Devices
            .Where(d => d.ActiveMemberId != null && d.ActiveAt >= since && d.RevokedAt == null)
            .Select(d => d.ActiveMemberId!.Value)
            .Distinct()
            // Someone removed from the pack disappears even if their device still says they're here.
            .Where(id => db.Members.Any(m => m.Id == id && m.DeletedAt == null))
            .ToArrayAsync();
        return TypedResults.Ok(new PresenceResponse(active));
    }
}
