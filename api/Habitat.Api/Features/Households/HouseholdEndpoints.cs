using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Habitat.Api.Auth;
using Habitat.Api.Data;
using Habitat.Api.Features.Devices;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Habitat.Api.Features.Households;

public record CreateHouseholdRequest(
    [Required, StringLength(60, MinimumLength = 1)] string DeviceName,
    [Required, StringLength(80, MinimumLength = 1)] string HouseholdName,
    [Required, StringLength(40, MinimumLength = 1)] string MemberName,
    [Required, StringLength(16, MinimumLength = 1)] string Animal,
    [StringLength(64)] string? TimeZoneId = null);

public record SignInRequest([Required, StringLength(60, MinimumLength = 1)] string DeviceName);

public record JoinRequest(
    [Required, StringLength(20)] string Code,
    [Required, StringLength(60, MinimumLength = 1)] string DeviceName,
    Guid? MemberId = null,
    [StringLength(40)] string? MemberName = null,
    [StringLength(16)] string? Animal = null);

public record HouseholdDto(Guid Id, string Name, string TimeZoneId);

public record MemberDto(Guid Id, string Name, string Animal, bool IsUser);

/// <summary>A device token plus where it belongs. Status is "approved", or "pending" until a user approves it.</summary>
public record SessionResponse(string DeviceToken, Guid DeviceId, string Status, HouseholdDto Household, Guid MemberId);

public record MeResponse(Guid DeviceId, HouseholdDto Household, MemberDto[] Members);

/// <summary>Problem "type" values the app branches on.</summary>
public static class HouseholdProblems
{
    public const string NoHabitat = "no-habitat";
    public const string AwaitingApproval = "awaiting-approval";
    public const string AlreadyInHabitat = "already-in-habitat";
}

public static class HouseholdEndpoints
{
    public const string DefaultTimeZone = "Europe/London";

    public static void MapHouseholdEndpoints(this IEndpointRouteBuilder api)
    {
        api.MapPost("/households", Create)
            .RequireAuthorization(HabitatPolicies.SignedIn)
            .WithSummary("Start a new habitat: creates it, the signed-in person's member and user, and this device.");

        api.MapPost("/auth/sign-in", SignIn)
            .RequireAuthorization(HabitatPolicies.SignedIn)
            .WithSummary("A user signs in on another device of their habitat.");

        api.MapPost("/auth/join", Join)
            .RequireAuthorization(HabitatPolicies.SignedIn)
            .RequireRateLimiting(DeviceEndpoints.PairingRateLimit)
            .WithSummary("Join a habitat as a user with an invite code. Stays pending until an existing user approves.");

        api.MapGet("/me", GetMe)
            .RequireAuthorization(HabitatPolicies.Device)
            .WithSummary("The calling device's habitat and its members.");
    }

    private static async Task<Results<Ok<SessionResponse>, ValidationProblem, ProblemHttpResult>> Create(
        CreateHouseholdRequest req, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        var oid = principal.EntraObjectId();
        if (await db.Users.IgnoreQueryFilters().AnyAsync(u => u.Provider == IdentityProviders.Entra && u.Subject == oid))
            return TypedResults.Problem("This email already belongs to a habitat.", statusCode: StatusCodes.Status409Conflict, type: HouseholdProblems.AlreadyInHabitat);

        var zone = req.TimeZoneId ?? DefaultTimeZone;
        if (!TimeZoneInfo.TryFindSystemTimeZoneById(zone, out _))
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { [nameof(req.TimeZoneId)] = ["Unknown time zone."] });

        var now = clock.GetUtcNow();
        var household = new Household { Id = Guid.CreateVersion7(), Name = req.HouseholdName.Trim(), TimeZoneId = zone, CreatedAt = now };
        var member = new Member { Id = Guid.CreateVersion7(), HouseholdId = household.Id, Name = req.MemberName.Trim(), Animal = req.Animal, UpdatedAt = now };
        var user = NewUser(household.Id, member.Id, principal, now, approved: true);
        var (device, token) = DeviceEndpoints.NewDevice(household.Id, req.DeviceName, now, approved: true, userId: user.Id);
        db.AddRange(household, member, user, device);
        // One SaveChanges, so one transaction.
        await db.SaveChangesAsync();

        return TypedResults.Ok(new SessionResponse(token, device.Id, DeviceTokenHandler.Approved, ToDto(household), member.Id));
    }

    private static async Task<Results<Ok<SessionResponse>, ProblemHttpResult>> SignIn(
        SignInRequest req, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        // UserClaimsTransformation only adds a user id for approved users.
        if (principal.FindFirstValue(HabitatClaims.UserId) is null)
        {
            var oid = principal.EntraObjectId();
            var pending = await db.Users.IgnoreQueryFilters().AnyAsync(u => u.Provider == IdentityProviders.Entra && u.Subject == oid);
            return pending
                ? TypedResults.Problem("Waiting for someone in your habitat to approve you.", statusCode: StatusCodes.Status403Forbidden, type: HouseholdProblems.AwaitingApproval)
                : TypedResults.Problem("This email isn't part of a habitat yet.", statusCode: StatusCodes.Status404NotFound, type: HouseholdProblems.NoHabitat);
        }

        var userId = principal.UserId();
        var user = await db.Users.FirstAsync(u => u.Id == userId);
        var (device, token) = DeviceEndpoints.NewDevice(user.HouseholdId, req.DeviceName, clock.GetUtcNow(), approved: true, userId: user.Id);
        db.Devices.Add(device);
        await db.SaveChangesAsync();

        var household = await db.Households.FirstAsync(h => h.Id == user.HouseholdId);
        return TypedResults.Ok(new SessionResponse(token, device.Id, DeviceTokenHandler.Approved, ToDto(household), user.MemberId));
    }

    private static async Task<Results<Ok<SessionResponse>, ValidationProblem, ProblemHttpResult>> Join(
        JoinRequest req, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        var now = clock.GetUtcNow();
        var oid = principal.EntraObjectId();
        var code = await DeviceEndpoints.FindUsableCode(db, req.Code, PairingKind.User, now);
        if (code is null) return DeviceEndpoints.InvalidCode();

        if (await db.Users.IgnoreQueryFilters().AnyAsync(u => u.Provider == IdentityProviders.Entra && u.Subject == oid))
            return TypedResults.Problem("This email already belongs to a habitat.", statusCode: StatusCodes.Status409Conflict, type: HouseholdProblems.AlreadyInHabitat);

        Member? member;
        if (req.MemberId is { } memberId)
        {
            // Joining as someone already in the pack, e.g. a partner a user added earlier.
            member = await db.Members.IgnoreQueryFilters().FirstOrDefaultAsync(m => m.Id == memberId && m.HouseholdId == code.HouseholdId && m.DeletedAt == null);
            var taken = await db.Users.IgnoreQueryFilters().AnyAsync(u => u.MemberId == memberId);
            if (member is null || taken)
                return TypedResults.ValidationProblem(new Dictionary<string, string[]> { [nameof(req.MemberId)] = ["Pick someone in the pack who doesn't sign in yet."] });
        }
        else
        {
            if (string.IsNullOrWhiteSpace(req.MemberName) || string.IsNullOrWhiteSpace(req.Animal))
                return TypedResults.ValidationProblem(new Dictionary<string, string[]> { [nameof(req.MemberName)] = ["Choose who you are, or give a name and animal."] });
            member = new Member { Id = Guid.CreateVersion7(), HouseholdId = code.HouseholdId, Name = req.MemberName.Trim(), Animal = req.Animal, UpdatedAt = now };
            db.Members.Add(member);
        }

        if (!await DeviceEndpoints.ClaimCode(db, code, now)) return DeviceEndpoints.InvalidCode();

        var user = NewUser(code.HouseholdId, member.Id, principal, now, approved: false);
        var (device, token) = DeviceEndpoints.NewDevice(code.HouseholdId, req.DeviceName, now, approved: false, userId: user.Id);
        db.AddRange(user, device);
        code.UsedAt = now;
        code.DeviceId = device.Id;
        await db.SaveChangesAsync();

        var household = await db.Households.FirstAsync(h => h.Id == code.HouseholdId);
        return TypedResults.Ok(new SessionResponse(token, device.Id, DeviceTokenHandler.Pending, ToDto(household), member.Id));
    }

    private static async Task<Ok<MeResponse>> GetMe(ClaimsPrincipal principal, HabitatDb db)
    {
        var householdId = principal.HouseholdId();
        var household = await db.Households.FirstAsync(h => h.Id == householdId);
        var userMembers = db.Users.Where(u => u.ApprovedAt != null).Select(u => u.MemberId);
        var members = await db.Members
            .Where(m => m.DeletedAt == null)
            .OrderBy(m => m.Name)
            .Select(m => new MemberDto(m.Id, m.Name, m.Animal, userMembers.Contains(m.Id)))
            .ToArrayAsync();
        return TypedResults.Ok(new MeResponse(principal.DeviceId(), ToDto(household), members));
    }

    private static User NewUser(Guid householdId, Guid memberId, ClaimsPrincipal principal, DateTimeOffset now, bool approved) => new()
    {
        Id = Guid.CreateVersion7(),
        HouseholdId = householdId,
        Provider = IdentityProviders.Entra,
        Subject = principal.EntraObjectId(),
        Email = principal.FindFirstValue("email") ?? principal.FindFirstValue("preferred_username"),
        MemberId = memberId,
        CreatedAt = now,
        ApprovedAt = approved ? now : null,
    };

    private static HouseholdDto ToDto(Household h) => new(h.Id, h.Name, h.TimeZoneId);
}
