using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Habitat.Api.Auth;
using Habitat.Api.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Habitat.Api.Features.Devices;

public record CreatePairingCodeRequest(PairingKind Kind = PairingKind.Device);

public record PairingCodeResponse(string Code, PairingKind Kind, DateTimeOffset ExpiresAt, string JoinPath);

public record PairRequest(
    [Required, StringLength(20)] string Code,
    [Required, StringLength(60, MinimumLength = 1)] string DeviceName);

public record PairResponse(string DeviceToken, Guid DeviceId, string Status);

public record DeviceSelfResponse(Guid DeviceId, string Status, Guid HouseholdId, string HouseholdName);

/// <summary>JoiningAsUser names the member when this device belongs to someone joining as a user (approving it approves them too).</summary>
public record DeviceDto(Guid Id, string Name, string Status, DateTimeOffset CreatedAt, DateTimeOffset LastSeenAt, bool SignedInByUser, string? JoiningAsUser);

public static class DeviceEndpoints
{
    public const string PairingRateLimit = "pairing";

    public static void MapDeviceEndpoints(this IEndpointRouteBuilder api)
    {
        api.MapPost("/pairing-codes", CreatePairingCode)
            .RequireAuthorization(HabitatPolicies.User)
            .WithSummary("Start adding a device (or inviting another user): a short-lived, single-use code.");

        api.MapPost("/devices/pair", Pair)
            .AllowAnonymous()
            .RequireRateLimiting(PairingRateLimit)
            .WithSummary("A new device swaps a device code for a token. It stays pending until a user approves it.");

        api.MapGet("/devices/self", GetSelf)
            .RequireAuthorization(HabitatPolicies.AnyDevice)
            .WithSummary("Lets a pending device check whether it has been approved yet.");

        var managed = api.MapGroup("/devices").RequireAuthorization(HabitatPolicies.User);
        managed.MapGet("/", List).WithSummary("Devices in the habitat, including ones waiting for approval.");
        managed.MapPost("/{id:guid}/approve", Approve).WithSummary("Approves a device, and the user joining on it if there is one.");
        managed.MapDelete("/{id:guid}", Revoke).WithSummary("Revokes a device, or rejects a pending one.");
    }

    /// <summary>A new device row and its bearer token. Only the token's hash is stored.</summary>
    public static (Device Device, string Token) NewDevice(Guid householdId, string name, DateTimeOffset now, bool approved, Guid? userId = null)
    {
        var token = Secrets.NewDeviceToken();
        return (new Device
        {
            Id = Guid.CreateVersion7(),
            HouseholdId = householdId,
            Name = name.Trim(),
            TokenHash = Secrets.Hash(token),
            CreatedAt = now,
            ApprovedAt = approved ? now : null,
            LastSeenAt = now,
            UserId = userId,
        }, token);
    }

    /// <summary>One message for every failure, so the response reveals nothing about which codes exist.</summary>
    public static ProblemHttpResult InvalidCode() =>
        TypedResults.Problem("That code isn't valid or has expired.", statusCode: StatusCodes.Status400BadRequest);

    public static async Task<PairingCode?> FindUsableCode(HabitatDb db, string input, PairingKind kind, DateTimeOffset now)
    {
        var hash = Secrets.Hash(Secrets.NormalisePairingCode(input));
        var code = await db.PairingCodes.IgnoreQueryFilters().FirstOrDefaultAsync(c => c.CodeHash == hash);
        return code is null || code.Kind != kind || code.UsedAt is not null || code.ExpiresAt <= now ? null : code;
    }

    /// <summary>
    /// Marks the code used atomically, so two devices racing with the same code can't both get in.
    /// If anything after this fails the code is simply spent, and the user makes a new one.
    /// </summary>
    public static async Task<bool> ClaimCode(HabitatDb db, PairingCode code, DateTimeOffset now) =>
        await db.PairingCodes.IgnoreQueryFilters()
            .Where(c => c.Id == code.Id && c.UsedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.UsedAt, now)) == 1;

    private static async Task<Ok<PairingCodeResponse>> CreatePairingCode(CreatePairingCodeRequest? req, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        var kind = req?.Kind ?? PairingKind.Device;
        var code = Secrets.NewPairingCode();
        var expires = clock.GetUtcNow() + DeviceLifetimes.PairingCodeExpiry;
        db.PairingCodes.Add(new PairingCode
        {
            Id = Guid.CreateVersion7(),
            HouseholdId = principal.HouseholdId(),
            CodeHash = Secrets.Hash(Secrets.NormalisePairingCode(code)),
            Kind = kind,
            ExpiresAt = expires,
            CreatedByUserId = principal.UserId(),
        });
        await db.SaveChangesAsync();
        // The code goes after '#' so it never reaches server or CDN logs.
        var path = kind == PairingKind.User ? "/join/user" : "/join";
        return TypedResults.Ok(new PairingCodeResponse(code, kind, expires, $"{path}#{code}"));
    }

    private static async Task<Results<Ok<PairResponse>, ProblemHttpResult>> Pair(PairRequest req, HabitatDb db, TimeProvider clock)
    {
        var now = clock.GetUtcNow();
        var code = await FindUsableCode(db, req.Code, PairingKind.Device, now);
        if (code is null || !await ClaimCode(db, code, now)) return InvalidCode();

        var (device, token) = NewDevice(code.HouseholdId, req.DeviceName, now, approved: false);
        db.Devices.Add(device);
        code.UsedAt = now;
        code.DeviceId = device.Id;
        await db.SaveChangesAsync();

        return TypedResults.Ok(new PairResponse(token, device.Id, DeviceTokenHandler.Pending));
    }

    private static async Task<Ok<DeviceSelfResponse>> GetSelf(ClaimsPrincipal principal, HabitatDb db)
    {
        var householdId = principal.HouseholdId();
        var name = await db.Households.Where(h => h.Id == householdId).Select(h => h.Name).FirstAsync();
        return TypedResults.Ok(new DeviceSelfResponse(principal.DeviceId(), principal.FindFirstValue(HabitatClaims.DeviceStatus)!, householdId, name));
    }

    private static async Task<Ok<DeviceDto[]>> List(HabitatDb db, TimeProvider clock)
    {
        var pendingSince = clock.GetUtcNow() - DeviceLifetimes.PendingExpiry;
        var devices = await db.Devices
            .Where(d => d.RevokedAt == null && (d.ApprovedAt != null || d.CreatedAt > pendingSince))
            .OrderBy(d => d.CreatedAt)
            .Select(d => new DeviceDto(
                d.Id,
                d.Name,
                d.ApprovedAt == null ? DeviceTokenHandler.Pending : DeviceTokenHandler.Approved,
                d.CreatedAt,
                d.LastSeenAt,
                d.UserId != null,
                db.Users.Where(u => u.Id == d.UserId && u.ApprovedAt == null)
                    .Join(db.Members, u => u.MemberId, m => m.Id, (u, m) => m.Animal + " " + m.Name)
                    .FirstOrDefault()))
            .ToArrayAsync();
        return TypedResults.Ok(devices);
    }

    private static async Task<Results<NoContent, NotFound>> Approve(Guid id, HabitatDb db, IMemoryCache cache, TimeProvider clock)
    {
        var now = clock.GetUtcNow();
        var device = await db.Devices.FirstOrDefaultAsync(d => d.Id == id && d.RevokedAt == null && d.ApprovedAt == null);
        if (device is null || now - device.CreatedAt > DeviceLifetimes.PendingExpiry) return TypedResults.NotFound();

        device.ApprovedAt = now;
        if (device.UserId is { } userId && await db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.ApprovedAt == null) is { } joining)
        {
            joining.ApprovedAt = now;
            // Touch their member so devices re-sync it and see they're now a user.
            if (await db.Members.FirstOrDefaultAsync(m => m.Id == joining.MemberId) is { } member) member.UpdatedAt = now;
        }
        await db.SaveChangesAsync();
        cache.Remove(DeviceTokenHandler.CacheKey(device.TokenHash));
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound>> Revoke(Guid id, HabitatDb db, IMemoryCache cache, TimeProvider clock)
    {
        var device = await db.Devices.FirstOrDefaultAsync(d => d.Id == id && d.RevokedAt == null);
        if (device is null) return TypedResults.NotFound();

        device.RevokedAt = clock.GetUtcNow();
        // Rejecting someone's join request removes their pending user, so they can be invited again.
        if (device.UserId is { } userId && await db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.ApprovedAt == null) is { } joining)
            db.Users.Remove(joining);
        await db.SaveChangesAsync();
        cache.Remove(DeviceTokenHandler.CacheKey(device.TokenHash));
        return TypedResults.NoContent();
    }
}
