using System.Security.Claims;
using System.Text.Encodings.Web;
using Habitat.Api.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace Habitat.Api.Auth;

public static class DeviceLifetimes
{
    /// <summary>A device nobody has used for this long has to pair again.</summary>
    public static readonly TimeSpan UnusedExpiry = TimeSpan.FromDays(90);
    /// <summary>How long a newly paired device may wait for a grown-up to approve it.</summary>
    public static readonly TimeSpan PendingExpiry = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan PairingCodeExpiry = TimeSpan.FromMinutes(10);
    /// <summary>LastSeenAt is only written this often, to avoid a database write per request.</summary>
    public static readonly TimeSpan LastSeenInterval = TimeSpan.FromHours(1);
    /// <summary>Approve/revoke clear the cache entry, so this only bounds staleness across server instances.</summary>
    public static readonly TimeSpan CacheFor = TimeSpan.FromMinutes(1);
}

/// <summary>
/// Authenticates "Authorization: Bearer hab_dev_…" (or ?access_token= on the SignalR hub, since
/// browsers can't set headers on WebSockets). Tokens are looked up by hash, so revocation is immediate.
/// </summary>
public sealed class DeviceTokenHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    HabitatDb db,
    IMemoryCache cache,
    TimeProvider clock) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string Approved = "approved";
    public const string Pending = "pending";

    private sealed record CachedDevice(Guid Id, Guid HouseholdId, DateTimeOffset CreatedAt, DateTimeOffset? ApprovedAt, DateTimeOffset? RevokedAt, DateTimeOffset LastSeenAt);

    public static string CacheKey(string tokenHash) => $"device:{tokenHash}";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var token = ReadToken();
        if (token is null) return AuthenticateResult.NoResult();

        var hash = Secrets.Hash(token);
        var device = await cache.GetOrCreateAsync(CacheKey(hash), async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = DeviceLifetimes.CacheFor;
            return await db.Devices.IgnoreQueryFilters()
                .Where(d => d.TokenHash == hash)
                .Select(d => new CachedDevice(d.Id, d.HouseholdId, d.CreatedAt, d.ApprovedAt, d.RevokedAt, d.LastSeenAt))
                .FirstOrDefaultAsync();
        });

        var now = clock.GetUtcNow();
        if (device is null || device.RevokedAt is not null) return AuthenticateResult.Fail("Unknown or revoked device.");
        if (device.ApprovedAt is null && now - device.CreatedAt > DeviceLifetimes.PendingExpiry) return AuthenticateResult.Fail("Pairing was not approved in time.");
        if (now - device.LastSeenAt > DeviceLifetimes.UnusedExpiry) return AuthenticateResult.Fail("Device unused for too long.");

        if (now - device.LastSeenAt > DeviceLifetimes.LastSeenInterval)
        {
            await db.Devices.IgnoreQueryFilters().Where(d => d.Id == device.Id).ExecuteUpdateAsync(s => s.SetProperty(d => d.LastSeenAt, now));
            cache.Remove(CacheKey(hash));
        }

        var identity = new ClaimsIdentity(
            [
                new Claim(HabitatClaims.DeviceId, device.Id.ToString()),
                new Claim(HabitatClaims.HouseholdId, device.HouseholdId.ToString()),
                new Claim(HabitatClaims.DeviceStatus, device.ApprovedAt is null ? Pending : Approved),
            ],
            Scheme.Name);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name));
    }

    private string? ReadToken()
    {
        var header = Request.Headers.Authorization.ToString();
        if (header.StartsWith("Bearer " + Secrets.DeviceTokenPrefix, StringComparison.Ordinal)) return header["Bearer ".Length..];

        if (Request.Path.StartsWithSegments("/hub") && Request.Query["access_token"].ToString() is { } q && q.StartsWith(Secrets.DeviceTokenPrefix, StringComparison.Ordinal))
            return q;

        return null;
    }
}
