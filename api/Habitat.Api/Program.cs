using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Habitat.Api.Auth;
using Habitat.Api.Data;
using Habitat.Api.Features.Devices;
using Habitat.Api.Features.Tends;
using Habitat.Api.Features.Households;
using Habitat.Api.Features.Members;
using Habitat.Api.Features.Rooms;
using Habitat.Api.Features.Presence;
using Habitat.Api.Features.Sync;
using Habitat.Api.Features.Wins;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

builder.Services.AddDbContext<HabitatDb>(o => o.UseSqlServer(
    config.GetConnectionString("Habitat"),
    // The free Azure SQL tier pauses after an hour idle and takes up to about a minute to resume.
    // Keep retrying for that long (roughly 90 seconds in all) rather than failing the first request.
    sql => sql.EnableRetryOnFailure(maxRetryCount: 12, maxRetryDelay: TimeSpan.FromSeconds(10), errorNumbersToAdd: null)));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHabitatAuth(config);
builder.Services.AddValidation();
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(config.GetSection("Cors:Origins").Get<string[]>() ?? [])
    .AllowAnyHeader()
    .AllowAnyMethod()));

// Container Apps terminates TLS and forwards the client address; trust only the one hop it adds.
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    var perMinute = config.GetValue("Pairing:AttemptsPerMinute", 5);
    o.AddPolicy(DeviceEndpoints.PairingRateLimit, http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = perMinute, Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();
    app.MapScalarApiReference().AllowAnonymous();
}

app.MapGet("/healthz", () => "ok").AllowAnonymous().ExcludeFromDescription();

var api = app.MapGroup("/api");
api.MapHouseholdEndpoints();
api.MapDeviceEndpoints();
api.MapMemberEndpoints();
api.MapRoomEndpoints();
api.MapTendEndpoints();
api.MapWinEndpoints();
api.MapSyncEndpoints();
api.MapPresenceEndpoints();

app.Run();

public partial class Program;
