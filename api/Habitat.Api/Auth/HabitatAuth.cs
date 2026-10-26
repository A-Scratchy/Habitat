using System.Security.Claims;
using Habitat.Api.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace Habitat.Api.Auth;

public static class HabitatClaims
{
    public const string HouseholdId = "household_id";
    public const string DeviceId = "device_id";
    public const string DeviceStatus = "device_status";
    public const string UserId = "user_id";
    /// <summary>Entra object id: stable per person within the tenant.</summary>
    public const string EntraObjectId = "oid";
}

public static class HabitatPolicies
{
    /// <summary>Default: an approved, paired device.</summary>
    public const string Device = "device";
    /// <summary>A device token that may still be waiting for approval (only for checking its own status).</summary>
    public const string AnyDevice = "any-device";
    /// <summary>Signed in with Entra, whether or not they belong to a habitat yet.</summary>
    public const string SignedIn = "signed-in";
    /// <summary>A signed-in, approved user acting on their habitat: pairing, approving, revoking, removing members.</summary>
    public const string User = "user";
}

public static class HabitatSchemes
{
    public const string Device = "Device";
    public const string Entra = "Entra";
}

public static class IdentityProviders
{
    public const string Entra = "entra";
}

public class EntraOptions
{
    /// <summary>e.g. https://habitat.ciamlogin.com/{tenant-id}/v2.0</summary>
    public string Authority { get; set; } = "";
    /// <summary>The Habitat API app registration's client id.</summary>
    public string Audience { get; set; } = "";
    public string Scope { get; set; } = "access_as_user";
}

public static class HabitatAuthSetup
{
    public static IServiceCollection AddHabitatAuth(this IServiceCollection services, IConfiguration config)
    {
        var entra = config.GetSection("Entra").Get<EntraOptions>() ?? new EntraOptions();

        services.AddMemoryCache();
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentHousehold, CurrentHousehold>();
        services.AddScoped<IClaimsTransformation, UserClaimsTransformation>();

        services
            .AddAuthentication(HabitatSchemes.Device)
            .AddScheme<AuthenticationSchemeOptions, DeviceTokenHandler>(HabitatSchemes.Device, null)
            .AddJwtBearer(HabitatSchemes.Entra, o =>
            {
                o.Authority = string.IsNullOrEmpty(entra.Authority) ? null : entra.Authority;
                o.Audience = entra.Audience;
                o.MapInboundClaims = false;
            });

        services.AddAuthorizationBuilder()
            .AddPolicy(HabitatPolicies.Device, p => p
                .AddAuthenticationSchemes(HabitatSchemes.Device)
                .RequireClaim(HabitatClaims.DeviceStatus, DeviceTokenHandler.Approved))
            .AddPolicy(HabitatPolicies.AnyDevice, p => p
                .AddAuthenticationSchemes(HabitatSchemes.Device)
                .RequireClaim(HabitatClaims.DeviceId))
            .AddPolicy(HabitatPolicies.SignedIn, p => p
                .AddAuthenticationSchemes(HabitatSchemes.Entra)
                .RequireClaim(HabitatClaims.EntraObjectId)
                .RequireAssertion(c => HasScope(c.User, entra.Scope)))
            .AddPolicy(HabitatPolicies.User, p => p
                .AddAuthenticationSchemes(HabitatSchemes.Entra)
                .RequireClaim(HabitatClaims.UserId)
                .RequireAssertion(c => HasScope(c.User, entra.Scope)))
            .SetDefaultPolicy(ApprovedDevice())
            // Deny by default: an endpoint that forgets to say who may call it needs an approved device.
            .SetFallbackPolicy(ApprovedDevice());

        return services;
    }

    private static AuthorizationPolicy ApprovedDevice() =>
        new AuthorizationPolicyBuilder(HabitatSchemes.Device)
            .RequireClaim(HabitatClaims.DeviceStatus, DeviceTokenHandler.Approved)
            .Build();

    private static bool HasScope(ClaimsPrincipal principal, string scope) =>
        principal.FindAll("scp").Any(c => c.Value.Split(' ').Contains(scope));
}

/// <summary>Household comes from the authenticated principal, never from the request body.</summary>
public sealed class CurrentHousehold(IHttpContextAccessor http) : ICurrentHousehold
{
    public Guid? Id => Guid.TryParse(http.HttpContext?.User.FindFirstValue(HabitatClaims.HouseholdId), out var id) ? id : null;
}

/// <summary>Adds household and user claims when the signed-in person is an approved user of a habitat.</summary>
public sealed class UserClaimsTransformation(HabitatDb db) : IClaimsTransformation
{
    public async Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        var oid = principal.FindFirstValue(HabitatClaims.EntraObjectId);
        if (oid is null || principal.HasClaim(c => c.Type == HabitatClaims.UserId)) return principal;

        var user = await db.Users.IgnoreQueryFilters()
            .Where(u => u.Provider == IdentityProviders.Entra && u.Subject == oid && u.ApprovedAt != null)
            // One habitat per login for now; the oldest wins if that ever changes before a habitat switcher exists.
            .OrderBy(u => u.CreatedAt)
            .Select(u => new { u.Id, u.HouseholdId })
            .FirstOrDefaultAsync();
        if (user is null) return principal;

        var clone = principal.Clone();
        ((ClaimsIdentity)clone.Identity!).AddClaims([
            new Claim(HabitatClaims.UserId, user.Id.ToString()),
            new Claim(HabitatClaims.HouseholdId, user.HouseholdId.ToString()),
        ]);
        return clone;
    }
}

public static class ClaimsPrincipalExtensions
{
    public static Guid HouseholdId(this ClaimsPrincipal principal) => Guid.Parse(principal.FindFirstValue(HabitatClaims.HouseholdId)!);
    public static Guid DeviceId(this ClaimsPrincipal principal) => Guid.Parse(principal.FindFirstValue(HabitatClaims.DeviceId)!);
    public static Guid UserId(this ClaimsPrincipal principal) => Guid.Parse(principal.FindFirstValue(HabitatClaims.UserId)!);
    public static string EntraObjectId(this ClaimsPrincipal principal) => principal.FindFirstValue(HabitatClaims.EntraObjectId)!;
}
