using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using Habitat.Api.Auth;
using Habitat.Api.Data;
using Habitat.Api.Features.Devices;
using Habitat.Api.Features.Households;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Testcontainers.MsSql;

namespace Habitat.Api.Tests;

/// <summary>Stands in for the Entra external tenant: signs tokens the API is configured to trust in tests.</summary>
public static class TestEntra
{
    public const string Issuer = "https://test.ciamlogin.example/tenant/v2.0";
    public const string Audience = "habitat-api-test";
    public static readonly SymmetricSecurityKey Key = new("habitat-tests-signing-key-0123456789abcdef"u8.ToArray());

    public static string Token(string oid, string scope = "access_as_user", string? email = null) =>
        new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            // Wide validity window: tests move the app's clock forward by months.
            NotBefore = DateTime.UtcNow.AddYears(-1),
            Expires = DateTime.UtcNow.AddYears(5),
            Subject = new ClaimsIdentity([new Claim("oid", oid), new Claim("scp", scope), new Claim("email", email ?? $"{oid}@example.com")]),
            SigningCredentials = new SigningCredentials(Key, SecurityAlgorithms.HmacSha256),
        });
}

public class HabitatFactory(string connectionString, FakeTimeProvider clock, int pairingAttemptsPerMinute = 1000) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Habitat", connectionString);
        builder.UseSetting("Pairing:AttemptsPerMinute", pairingAttemptsPerMinute.ToString());
        builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<TimeProvider>(clock);
            services.PostConfigure<JwtBearerOptions>(HabitatSchemes.Entra, o =>
            {
                o.Authority = null;
                o.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidIssuer = TestEntra.Issuer,
                    ValidAudience = TestEntra.Audience,
                    IssuerSigningKey = TestEntra.Key,
                };
            });
        });
    }
}

/// <summary>One SQL Server container and one migrated database for the whole test run.</summary>
public sealed class ApiFixture : IAsyncLifetime
{
    private readonly MsSqlContainer _sql = new MsSqlBuilder().WithImage("mcr.microsoft.com/mssql/server:2022-CU14-ubuntu-22.04").Build();

    public FakeTimeProvider Clock { get; } = new(new DateTimeOffset(2026, 10, 26, 12, 0, 0, TimeSpan.Zero));
    public HabitatFactory Factory { get; private set; } = null!;
    public string ConnectionString => _sql.GetConnectionString();

    public async Task InitializeAsync()
    {
        await _sql.StartAsync();
        Factory = new HabitatFactory(ConnectionString, Clock);
        using var scope = Factory.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<HabitatDb>().Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        await Factory.DisposeAsync();
        await _sql.DisposeAsync();
    }

    public HttpClient Client(string? bearer = null)
    {
        var client = Factory.CreateClient();
        if (bearer is not null) client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        return client;
    }

    /// <summary>Someone signs in for the first time and starts a habitat. Returns their Entra token and session.</summary>
    public async Task<(string Entra, SessionResponse Session)> NewHousehold(string name = "The Burrow", string memberName = "Robin")
    {
        var entra = TestEntra.Token(Guid.NewGuid().ToString());
        var res = await Client(entra).PostAsJsonAsync("/api/households", new CreateHouseholdRequest("Robin's phone", name, memberName, "🦊", "Europe/London"));
        res.EnsureSuccessStatusCode();
        return (entra, (await res.Content.ReadFromJsonAsync<SessionResponse>(Json.Options))!);
    }

    public async Task<PairingCodeResponse> NewCode(string entra, PairingKind kind = PairingKind.Device)
    {
        var res = await Client(entra).PostAsJsonAsync("/api/pairing-codes", new CreatePairingCodeRequest(kind), Json.Options);
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<PairingCodeResponse>(Json.Options))!;
    }

    /// <summary>Pairs and approves a second device, returning a client that uses its token.</summary>
    public async Task<HttpClient> ApprovedDevice(string entra, string name = "Kitchen tablet")
    {
        var res = await Client().PostAsJsonAsync("/api/devices/pair", new PairRequest((await NewCode(entra)).Code, name));
        var paired = (await res.Content.ReadFromJsonAsync<PairResponse>(Json.Options))!;
        (await Client(entra).PostAsync($"/api/devices/{paired.DeviceId}/approve", null)).EnsureSuccessStatusCode();
        return Client(paired.DeviceToken);
    }
}

[CollectionDefinition(Name)]
public class ApiCollection : ICollectionFixture<ApiFixture>
{
    public const string Name = "api";
}

public static class Json
{
    public static readonly System.Text.Json.JsonSerializerOptions Options = new(System.Text.Json.JsonSerializerDefaults.Web)
    {
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() },
    };
}
