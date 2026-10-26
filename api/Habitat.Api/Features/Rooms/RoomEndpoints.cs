using System.Security.Claims;
using Habitat.Api.Auth;
using Habitat.Api.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Habitat.Api.Features.Rooms;

/// <summary>Name is required and unique in the habitat; SortOrder is required; Icon is an emoji or null for none.</summary>
public record RoomInput(string Name, string? Icon, int? SortOrder);

public static class RoomEndpoints
{
    public static void MapRoomEndpoints(this IEndpointRouteBuilder api)
    {
        var rooms = api.MapGroup("/rooms").RequireAuthorization(HabitatPolicies.Device);
        rooms.MapPut("/{id:guid}", Put).WithSummary("Add a room, or rename, re-icon or reorder one. Safe to repeat.");
        rooms.MapDelete("/{id:guid}", Delete).WithSummary("Remove an empty room. A room that still has habits or quests can't be removed.");
    }

    private static async Task<IResult> Put(Guid id, RoomInput input, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        var errors = new Dictionary<string, string[]>();
        var name = input.Name?.Trim() ?? "";
        if (name.Length is 0 or > 40) errors["name"] = ["Between 1 and 40 characters."];
        if (input.Icon is { Length: > 16 }) errors["icon"] = ["One emoji."];
        if (input.SortOrder is null) errors["sortOrder"] = ["Required."];
        if (errors.Count == 0 && await db.Rooms.AnyAsync(r => r.Id != id && r.DeletedAt == null && r.Name == name))
            errors["name"] = ["There's already a room with that name."];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        var room = await db.Rooms.FirstOrDefaultAsync(r => r.Id == id);
        if (room is null)
        {
            // A GUID that already exists in another household is never ours to touch.
            if (await db.Rooms.IgnoreQueryFilters().AnyAsync(r => r.Id == id)) return TypedResults.NotFound();
            room = new Room { Id = id, HouseholdId = principal.HouseholdId(), Name = name };
            db.Rooms.Add(room);
        }
        else if (room.DeletedAt is not null)
        {
            return TypedResults.Problem("That room was removed.", statusCode: StatusCodes.Status410Gone);
        }

        room.Name = name;
        room.Icon = string.IsNullOrWhiteSpace(input.Icon) ? null : input.Icon.Trim();
        room.SortOrder = input.SortOrder!.Value;
        room.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync();
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> Delete(Guid id, HabitatDb db, TimeProvider clock)
    {
        var room = await db.Rooms.FirstOrDefaultAsync(r => r.Id == id);
        if (room is null) return TypedResults.NotFound();
        if (room.DeletedAt is not null) return TypedResults.NoContent();

        var inUse = await db.Tends.CountAsync(t => t.RoomId == id && t.DeletedAt == null);
        if (inUse > 0)
            return TypedResults.Problem($"Move or remove its {inUse} habits and quests first.", statusCode: StatusCodes.Status409Conflict);

        room.DeletedAt = room.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync();
        return TypedResults.NoContent();
    }
}
