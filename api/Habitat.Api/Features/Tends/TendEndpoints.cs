using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using Habitat.Api.Auth;
using Habitat.Api.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Habitat.Api.Features.Tends;

/// <summary>
/// Everything a device may set on a habit or quest. Kind, Tier and Status are required: nothing is
/// assumed. LastDoneAt and claims are not here: the server owns those.
/// </summary>
public record TendInput(
    TendKind? Kind,
    string Name,
    string Room,
    string? Group,
    string? Description,
    EffortTier? Tier,
    EnergyTag[]? Energy,
    /// <summary>Required for habits; must be empty for quests.</summary>
    int? FrequencyDays,
    TendStatus? Status,
    Guid? OwnerMemberId,
    /// <summary>Only used when the tend is created (e.g. by import), as its starting "last done" date.</summary>
    DateTimeOffset? SeedLastDoneAt = null,
    /// <summary>Only used when a quest is created already finished (an import marked Done).</summary>
    DateTimeOffset? CompletedAt = null);

public record BulkTend(Guid Id, TendInput Tend);

public record BulkTendsRequest([Required, MaxLength(1000)] BulkTend[] Tends);

public record BulkTendsResponse(int Saved, int Skipped);

public record ClaimRequest(Guid MemberId);

public static class TendEndpoints
{
    public static void MapTendEndpoints(this IEndpointRouteBuilder api)
    {
        var tends = api.MapGroup("/tends").RequireAuthorization(HabitatPolicies.Device);
        tends.MapPut("/{id:guid}", Put).WithSummary("Create or replace a habit or quest (including switching between them). Safe to repeat.");
        tends.MapPatch("/{id:guid}", Patch)
            // The body is raw JSON (validated field by field below); automatic validation can't walk a JsonElement.
            .DisableValidation()
            .WithSummary("Change only the fields sent, so two quick edits to different fields don't clobber each other.");
        tends.MapDelete("/{id:guid}", Delete);
        tends.MapPost("/bulk", Bulk).WithSummary("Import many at once. Each is created or replaced; removed ones are skipped. All or nothing.");
        tends.MapPost("/{id:guid}/restart", Restart).WithSummary("Takes a finished quest off the Completed shelf so it can be done again.");
        tends.MapPut("/{id:guid}/claim", Claim).WithSummary("\"I'll do this today\": holds it for one member until the household's day ends.");
        tends.MapDelete("/{id:guid}/claim", ReleaseClaim);
    }

    /// <summary>The habit/quest rules, checked before saving (the database's CHECK constraint is the backstop).</summary>
    private static Dictionary<string, string[]> Validate(Tend t)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(t.Name) || t.Name.Length > 80) errors["name"] = ["Between 1 and 80 characters."];
        if (string.IsNullOrWhiteSpace(t.Room) || t.Room.Length > 40) errors["room"] = ["Between 1 and 40 characters."];
        if (t.Group is { Length: > 40 }) errors["group"] = ["At most 40 characters."];
        if (t.Description is { Length: > TendRules.DescriptionMax }) errors["description"] = [$"At most {TendRules.DescriptionMax} characters."];
        if (t.Energy.Count != t.Energy.Distinct().Count()) errors["energy"] = ["No repeated tags."];
        switch (t.Kind)
        {
            case TendKind.Habit when t.FrequencyDays is not (>= 1 and <= TendRules.MaxFrequencyDays):
                errors["frequencyDays"] = [$"A habit needs one: every 1 to {TendRules.MaxFrequencyDays} days."];
                break;
            case TendKind.Quest when t.FrequencyDays is not null:
                errors["frequencyDays"] = ["A quest has no schedule; leave it empty."];
                break;
        }
        return errors;
    }

    /// <summary>Copies a full input onto a tend, or reports which required values are missing.</summary>
    private static Dictionary<string, string[]> Apply(Tend t, TendInput input)
    {
        var missing = new Dictionary<string, string[]>();
        if (input.Kind is null) missing["kind"] = ["Required: Habit or Quest."];
        if (input.Tier is null) missing["tier"] = ["Required: Sloth, Tortoise, Bee or Elephant."];
        if (input.Status is null) missing["status"] = ["Required: Active or Paused."];
        if (missing.Count > 0) return missing;

        t.Kind = input.Kind!.Value;
        t.Name = input.Name?.Trim() ?? "";
        t.Room = input.Room?.Trim() ?? "";
        t.Group = string.IsNullOrWhiteSpace(input.Group) ? null : input.Group.Trim();
        t.Description = string.IsNullOrWhiteSpace(input.Description) ? null : input.Description.Trim();
        t.Tier = input.Tier!.Value;
        t.Energy = [.. input.Energy ?? []];
        t.FrequencyDays = input.FrequencyDays;
        t.Status = input.Status!.Value;
        t.OwnerMemberId = input.OwnerMemberId;
        // Becoming a habit takes it off the Completed shelf: habits are never "finished".
        if (t.Kind == TendKind.Habit) t.CompletedAt = null;
        return Validate(t);
    }

    private static async Task<bool> OwnerIsValid(HabitatDb db, Guid? ownerId) =>
        ownerId is null || await db.Members.AnyAsync(m => m.Id == ownerId && m.DeletedAt == null);

    /// <summary>Finds a tend to write, creating it if new. Null means the id belongs elsewhere or was removed.</summary>
    private static async Task<(Tend? Tend, IResult? Error)> ForWrite(Guid id, HabitatDb db, ClaimsPrincipal principal, TendInput? creating)
    {
        var tend = await db.Tends.FirstOrDefaultAsync(t => t.Id == id);
        if (tend is not null)
            // Removal wins over stale edits from an offline device.
            return tend.DeletedAt is null ? (tend, null) : (null, TypedResults.Problem("That was removed.", statusCode: StatusCodes.Status410Gone));
        if (creating is null || await db.Tends.IgnoreQueryFilters().AnyAsync(t => t.Id == id)) return (null, TypedResults.NotFound());

        tend = NewTend(id, principal.HouseholdId(), creating);
        db.Tends.Add(tend);
        return (tend, null);
    }

    private static Tend NewTend(Guid id, Guid householdId, TendInput input) => new()
    {
        Id = id,
        HouseholdId = householdId,
        Name = "",
        Room = "",
        SeedLastDoneAt = input.SeedLastDoneAt,
        LastDoneAt = input.SeedLastDoneAt,
        CompletedAt = input.Kind == TendKind.Quest ? input.CompletedAt : null,
    };

    private static async Task<IResult> Put(Guid id, TendInput input, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        var (tend, error) = await ForWrite(id, db, principal, input);
        if (tend is null) return error!;

        var errors = Apply(tend, input);
        if (!await OwnerIsValid(db, tend.OwnerMemberId)) errors["ownerMemberId"] = ["Not a member of this habitat."];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        tend.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync();
        return TypedResults.NoContent();
    }

    /// <summary>Kind isn't here on purpose: switching between habit and quest is a full PUT, so both sides' fields are given.</summary>
    private static readonly HashSet<string> Patchable = ["name", "room", "group", "description", "tier", "energy", "frequencyDays", "status", "ownerMemberId"];

    private static async Task<IResult> Patch(Guid id, JsonElement body, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock, IOptions<JsonOptions> json)
    {
        if (body.ValueKind != JsonValueKind.Object) return TypedResults.BadRequest();
        var (tend, error) = await ForWrite(id, db, principal, creating: null);
        if (tend is null) return error!;

        var options = json.Value.SerializerOptions;
        var errors = new Dictionary<string, string[]>();
        foreach (var prop in body.EnumerateObject())
        {
            if (!Patchable.Contains(prop.Name))
            {
                errors[prop.Name] = [prop.Name == "kind" ? "Switch between habit and quest with a full PUT." : "Can't be changed this way."];
                continue;
            }
            try
            {
                switch (prop.Name)
                {
                    case "name": tend.Name = prop.Value.GetString()?.Trim() ?? ""; break;
                    case "room": tend.Room = prop.Value.GetString()?.Trim() ?? ""; break;
                    case "group": tend.Group = string.IsNullOrWhiteSpace(prop.Value.GetString()) ? null : prop.Value.GetString()!.Trim(); break;
                    case "description": tend.Description = string.IsNullOrWhiteSpace(prop.Value.GetString()) ? null : prop.Value.GetString()!.Trim(); break;
                    case "tier": tend.Tier = prop.Value.Deserialize<EffortTier>(options); break;
                    case "energy": tend.Energy = [.. prop.Value.Deserialize<EnergyTag[]>(options) ?? []]; break;
                    case "frequencyDays": tend.FrequencyDays = prop.Value.Deserialize<int?>(options); break;
                    case "status": tend.Status = prop.Value.Deserialize<TendStatus>(options); break;
                    case "ownerMemberId": tend.OwnerMemberId = prop.Value.Deserialize<Guid?>(options); break;
                }
            }
            catch (Exception e) when (e is JsonException or InvalidOperationException or FormatException)
            {
                errors[prop.Name] = ["Not a valid value."];
            }
        }
        foreach (var (k, v) in Validate(tend)) errors.TryAdd(k, v);
        if (!await OwnerIsValid(db, tend.OwnerMemberId)) errors["ownerMemberId"] = ["Not a member of this habitat."];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        tend.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync();
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound>> Delete(Guid id, HabitatDb db, TimeProvider clock)
    {
        var tend = await db.Tends.FirstOrDefaultAsync(t => t.Id == id);
        if (tend is null) return TypedResults.NotFound();
        if (tend.DeletedAt is null)
        {
            tend.DeletedAt = tend.UpdatedAt = clock.GetUtcNow();
            await db.SaveChangesAsync();
        }
        return TypedResults.NoContent();
    }

    private static async Task<IResult> Bulk(BulkTendsRequest req, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        if (req.Tends.Select(c => c.Id).Distinct().Count() != req.Tends.Length)
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["tends"] = ["Each one needs its own id."] });

        var now = clock.GetUtcNow();
        var householdId = principal.HouseholdId();
        var memberIds = (await db.Members.Where(m => m.DeletedAt == null).Select(m => m.Id).ToListAsync()).ToHashSet();
        var ids = req.Tends.Select(c => c.Id).ToArray();
        // One query for every id, including ones that turn out to belong elsewhere.
        var existing = await db.Tends.IgnoreQueryFilters().Where(t => ids.Contains(t.Id)).ToDictionaryAsync(t => t.Id);
        var errors = new Dictionary<string, string[]>();
        var (saved, skipped) = (0, 0);
        for (var i = 0; i < req.Tends.Length; i++)
        {
            var (id, input) = req.Tends[i];
            if (!existing.TryGetValue(id, out var tend))
            {
                tend = NewTend(id, householdId, input);
                db.Tends.Add(tend);
            }
            else if (tend.HouseholdId != householdId || tend.DeletedAt is not null)
            {
                skipped++;
                continue;
            }
            foreach (var (k, v) in Apply(tend, input)) errors[$"tends[{i}].{k}"] = v;
            if (tend.OwnerMemberId is { } owner && !memberIds.Contains(owner)) errors[$"tends[{i}].ownerMemberId"] = ["Not a member of this habitat."];
            tend.UpdatedAt = now;
            saved++;
        }
        // All or nothing: a bad row means nothing is saved.
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);
        await db.SaveChangesAsync();
        return TypedResults.Ok(new BulkTendsResponse(saved, skipped));
    }

    private static async Task<IResult> Restart(Guid id, HabitatDb db, TimeProvider clock)
    {
        var tend = await db.Tends.FirstOrDefaultAsync(t => t.Id == id && t.DeletedAt == null);
        if (tend is null) return TypedResults.NotFound();
        if (tend.Kind != TendKind.Quest) return TypedResults.Problem("Only quests can be restarted.", statusCode: StatusCodes.Status409Conflict);
        if (tend.CompletedAt is not null)
        {
            (tend.CompletedAt, tend.UpdatedAt) = (null, clock.GetUtcNow());
            await db.SaveChangesAsync();
        }
        return TypedResults.NoContent();
    }

    private static async Task<IResult> Claim(Guid id, ClaimRequest req, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        var tend = await db.Tends.FirstOrDefaultAsync(t => t.Id == id && t.DeletedAt == null);
        if (tend is null) return TypedResults.NotFound();
        if (!await db.Members.AnyAsync(m => m.Id == req.MemberId && m.DeletedAt == null))
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["memberId"] = ["Not a member of this habitat."] });

        var now = clock.GetUtcNow();
        tend.ClaimMemberId = req.MemberId;
        tend.ClaimDay = HouseholdTime.LocalDate(await db.TimeZoneOf(principal.HouseholdId()), now);
        tend.UpdatedAt = now;
        await db.SaveChangesAsync();
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound>> ReleaseClaim(Guid id, HabitatDb db, TimeProvider clock)
    {
        var tend = await db.Tends.FirstOrDefaultAsync(t => t.Id == id && t.DeletedAt == null);
        if (tend is null) return TypedResults.NotFound();
        if (tend.ClaimMemberId is not null)
        {
            (tend.ClaimMemberId, tend.ClaimDay, tend.UpdatedAt) = (null, null, clock.GetUtcNow());
            await db.SaveChangesAsync();
        }
        return TypedResults.NoContent();
    }
}
