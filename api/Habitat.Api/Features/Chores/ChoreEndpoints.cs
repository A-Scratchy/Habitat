using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using Habitat.Api.Auth;
using Habitat.Api.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Habitat.Api.Features.Chores;

/// <summary>Everything a device may set on a chore. LastDoneAt and claims are not here: the server owns those.</summary>
public record ChoreInput(
    string Name,
    string Room,
    string? Group,
    EffortTier Tier,
    EnergyTag[]? Energy,
    int? FrequencyDays,
    ChoreStatus Status,
    Guid? OwnerMemberId,
    /// <summary>Only used when the chore is created (e.g. by import), as its starting "last done" date.</summary>
    DateTimeOffset? SeedLastDoneAt = null);

public record BulkChore(Guid Id, ChoreInput Chore);

public record BulkChoresRequest([Required, MaxLength(1000)] BulkChore[] Chores);

public record BulkChoresResponse(int Saved, int Skipped);

public record ClaimRequest(Guid MemberId);

public static class ChoreEndpoints
{
    public static void MapChoreEndpoints(this IEndpointRouteBuilder api)
    {
        var chores = api.MapGroup("/chores").RequireAuthorization(HabitatPolicies.Device);
        chores.MapPut("/{id:guid}", Put).WithSummary("Create or replace a chore. Safe to repeat.");
        chores.MapPatch("/{id:guid}", Patch)
            // The body is raw JSON (validated field by field below); automatic validation can't walk a JsonElement.
            .DisableValidation()
            .WithSummary("Change only the fields sent, so two quick edits to different fields don't clobber each other.");
        chores.MapDelete("/{id:guid}", Delete);
        chores.MapPost("/bulk", Bulk).WithSummary("Import many chores at once. Each is created or replaced; removed ones are skipped.");
        chores.MapPut("/{id:guid}/claim", Claim).WithSummary("\"I'll do this today\": holds the chore for one member until the household's day ends.");
        chores.MapDelete("/{id:guid}/claim", ReleaseClaim);
    }

    private static Dictionary<string, string[]> Validate(Chore c)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(c.Name) || c.Name.Length > 80) errors["name"] = ["Between 1 and 80 characters."];
        if (string.IsNullOrWhiteSpace(c.Room) || c.Room.Length > 40) errors["room"] = ["Between 1 and 40 characters."];
        if (c.Group is { Length: > 40 }) errors["group"] = ["At most 40 characters."];
        if (c.FrequencyDays is < 1 or > 3650) errors["frequencyDays"] = ["Between 1 and 3650 days, or empty for no schedule."];
        if (c.Energy.Count != c.Energy.Distinct().Count()) errors["energy"] = ["No repeated tags."];
        return errors;
    }

    private static void Apply(Chore c, ChoreInput input)
    {
        c.Name = input.Name?.Trim() ?? "";
        c.Room = input.Room?.Trim() ?? "";
        c.Group = string.IsNullOrWhiteSpace(input.Group) ? null : input.Group.Trim();
        c.Tier = input.Tier;
        c.Energy = [.. input.Energy ?? []];
        c.FrequencyDays = input.FrequencyDays;
        c.Status = input.Status;
        c.OwnerMemberId = input.OwnerMemberId;
    }

    private static async Task<bool> OwnerIsValid(HabitatDb db, Guid? ownerId) =>
        ownerId is null || await db.Members.AnyAsync(m => m.Id == ownerId && m.DeletedAt == null);

    /// <summary>Finds a chore to write, creating it if new. Null result means the id belongs elsewhere or was removed.</summary>
    private static async Task<(Chore? Chore, IResult? Error)> ForWrite(Guid id, HabitatDb db, ClaimsPrincipal principal, ChoreInput? creating)
    {
        var chore = await db.Chores.FirstOrDefaultAsync(c => c.Id == id);
        if (chore is not null)
            // Removal wins over stale edits from an offline device.
            return chore.DeletedAt is null ? (chore, null) : (null, TypedResults.Problem("That chore was removed.", statusCode: StatusCodes.Status410Gone));
        if (creating is null || await db.Chores.IgnoreQueryFilters().AnyAsync(c => c.Id == id)) return (null, TypedResults.NotFound());

        chore = new Chore { Id = id, HouseholdId = principal.HouseholdId(), Name = "", Room = "", SeedLastDoneAt = creating.SeedLastDoneAt, LastDoneAt = creating.SeedLastDoneAt };
        db.Chores.Add(chore);
        return (chore, null);
    }

    private static async Task<IResult> Put(Guid id, ChoreInput input, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        var (chore, error) = await ForWrite(id, db, principal, input);
        if (chore is null) return error!;

        Apply(chore, input);
        var errors = Validate(chore);
        if (!await OwnerIsValid(db, chore.OwnerMemberId)) errors["ownerMemberId"] = ["Not a member of this habitat."];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        chore.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync();
        return TypedResults.NoContent();
    }

    private static readonly HashSet<string> Patchable = ["name", "room", "group", "tier", "energy", "frequencyDays", "status", "ownerMemberId"];

    private static async Task<IResult> Patch(Guid id, JsonElement body, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock, IOptions<JsonOptions> json)
    {
        if (body.ValueKind != JsonValueKind.Object) return TypedResults.BadRequest();
        var (chore, error) = await ForWrite(id, db, principal, creating: null);
        if (chore is null) return error!;

        var options = json.Value.SerializerOptions;
        var errors = new Dictionary<string, string[]>();
        foreach (var prop in body.EnumerateObject())
        {
            if (!Patchable.Contains(prop.Name))
            {
                errors[prop.Name] = ["Can't be changed this way."];
                continue;
            }
            try
            {
                switch (prop.Name)
                {
                    case "name": chore.Name = prop.Value.GetString()?.Trim() ?? ""; break;
                    case "room": chore.Room = prop.Value.GetString()?.Trim() ?? ""; break;
                    case "group": chore.Group = string.IsNullOrWhiteSpace(prop.Value.GetString()) ? null : prop.Value.GetString()!.Trim(); break;
                    case "tier": chore.Tier = prop.Value.Deserialize<EffortTier>(options); break;
                    case "energy": chore.Energy = [.. prop.Value.Deserialize<EnergyTag[]>(options) ?? []]; break;
                    case "frequencyDays": chore.FrequencyDays = prop.Value.Deserialize<int?>(options); break;
                    case "status": chore.Status = prop.Value.Deserialize<ChoreStatus>(options); break;
                    case "ownerMemberId": chore.OwnerMemberId = prop.Value.Deserialize<Guid?>(options); break;
                }
            }
            catch (Exception e) when (e is JsonException or InvalidOperationException or FormatException)
            {
                errors[prop.Name] = ["Not a valid value."];
            }
        }
        foreach (var (k, v) in Validate(chore)) errors.TryAdd(k, v);
        if (!await OwnerIsValid(db, chore.OwnerMemberId)) errors["ownerMemberId"] = ["Not a member of this habitat."];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        chore.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync();
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound>> Delete(Guid id, HabitatDb db, TimeProvider clock)
    {
        var chore = await db.Chores.FirstOrDefaultAsync(c => c.Id == id);
        if (chore is null) return TypedResults.NotFound();
        if (chore.DeletedAt is null)
        {
            chore.DeletedAt = chore.UpdatedAt = clock.GetUtcNow();
            await db.SaveChangesAsync();
        }
        return TypedResults.NoContent();
    }

    private static async Task<IResult> Bulk(BulkChoresRequest req, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        if (req.Chores.Select(c => c.Id).Distinct().Count() != req.Chores.Length)
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["chores"] = ["Each chore needs its own id."] });

        var now = clock.GetUtcNow();
        var householdId = principal.HouseholdId();
        var memberIds = (await db.Members.Where(m => m.DeletedAt == null).Select(m => m.Id).ToListAsync()).ToHashSet();
        var ids = req.Chores.Select(c => c.Id).ToArray();
        // One query for every id, including ones that turn out to belong elsewhere.
        var existing = await db.Chores.IgnoreQueryFilters().Where(c => ids.Contains(c.Id)).ToDictionaryAsync(c => c.Id);
        var errors = new Dictionary<string, string[]>();
        var (saved, skipped) = (0, 0);
        for (var i = 0; i < req.Chores.Length; i++)
        {
            var (id, input) = req.Chores[i];
            if (!existing.TryGetValue(id, out var chore))
            {
                chore = new Chore { Id = id, HouseholdId = householdId, Name = "", Room = "", SeedLastDoneAt = input.SeedLastDoneAt, LastDoneAt = input.SeedLastDoneAt };
                db.Chores.Add(chore);
            }
            else if (chore.HouseholdId != householdId || chore.DeletedAt is not null)
            {
                skipped++;
                continue;
            }
            Apply(chore, input);
            foreach (var (k, v) in Validate(chore)) errors[$"chores[{i}].{k}"] = v;
            if (chore.OwnerMemberId is { } owner && !memberIds.Contains(owner)) errors[$"chores[{i}].ownerMemberId"] = ["Not a member of this habitat."];
            chore.UpdatedAt = now;
            saved++;
        }
        // All or nothing: a bad row means nothing is saved.
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);
        await db.SaveChangesAsync();
        return TypedResults.Ok(new BulkChoresResponse(saved, skipped));
    }

    private static async Task<IResult> Claim(Guid id, ClaimRequest req, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        var chore = await db.Chores.FirstOrDefaultAsync(c => c.Id == id && c.DeletedAt == null);
        if (chore is null) return TypedResults.NotFound();
        if (!await db.Members.AnyAsync(m => m.Id == req.MemberId && m.DeletedAt == null))
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["memberId"] = ["Not a member of this habitat."] });

        var now = clock.GetUtcNow();
        chore.ClaimMemberId = req.MemberId;
        chore.ClaimDay = HouseholdTime.LocalDate(await db.TimeZoneOf(principal.HouseholdId()), now);
        chore.UpdatedAt = now;
        await db.SaveChangesAsync();
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound>> ReleaseClaim(Guid id, HabitatDb db, TimeProvider clock)
    {
        var chore = await db.Chores.FirstOrDefaultAsync(c => c.Id == id && c.DeletedAt == null);
        if (chore is null) return TypedResults.NotFound();
        if (chore.ClaimMemberId is not null)
        {
            (chore.ClaimMemberId, chore.ClaimDay, chore.UpdatedAt) = (null, null, clock.GetUtcNow());
            await db.SaveChangesAsync();
        }
        return TypedResults.NoContent();
    }
}
