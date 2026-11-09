using System.Security.Claims;
using Habitat.Api.Auth;
using Habitat.Api.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;

namespace Habitat.Api.Features.Gifts;

/// <summary>Acorns: what it cost the sender. The app sets prices; the server only keeps them sensible.</summary>
public record GiftInput(GiftKind Kind, Guid FromMemberId, Guid ToMemberId, int Acorns, DateTimeOffset SentAt);

public static class GiftEndpoints
{
    public const int MaxAcorns = 50;
    private static readonly TimeSpan ClockSkew = TimeSpan.FromMinutes(5);

    public static void MapGiftEndpoints(this IEndpointRouteBuilder api)
    {
        var gifts = api.MapGroup("/gifts").RequireAuthorization(HabitatPolicies.Device);
        gifts.MapPut("/{id:guid}", Put).WithSummary("Send a hug, high-five or thank you. Safe to repeat: the same id is only ever sent once.");
        gifts.MapPost("/{id:guid}/seen", Seen).WithSummary("The person it was for has seen it, so it isn't shown again.");
    }

    private static async Task<IResult> Put(Guid id, GiftInput input, ClaimsPrincipal principal, HabitatDb db, TimeProvider clock)
    {
        var existing = await db.Gifts.IgnoreQueryFilters().Where(g => g.Id == id).Select(g => g.HouseholdId).ToListAsync();
        if (existing.Count > 0)
            // An outbox retry of a gift we already have: nothing to do.
            return existing[0] == principal.HouseholdId() ? TypedResults.NoContent() : TypedResults.NotFound();

        var now = clock.GetUtcNow();
        var errors = new Dictionary<string, string[]>();
        if (!Enum.IsDefined(input.Kind)) errors["kind"] = ["A hug, high-five or thank you."];
        if (input.Acorns is < 1 or > MaxAcorns) errors["acorns"] = [$"Between 1 and {MaxAcorns} acorns."];
        if (input.FromMemberId == input.ToMemberId) errors["toMemberId"] = ["Send it to someone else in the pack."];
        else if (await db.Members.CountAsync(m => (m.Id == input.FromMemberId || m.Id == input.ToMemberId) && m.DeletedAt == null) != 2)
            errors["memberIds"] = ["Both must be in this habitat's pack."];
        if (input.SentAt > now + ClockSkew) errors["sentAt"] = ["Can't be in the future."];
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        db.Gifts.Add(new Gift
        {
            Id = id,
            HouseholdId = principal.HouseholdId(),
            Kind = input.Kind,
            FromMemberId = input.FromMemberId,
            ToMemberId = input.ToMemberId,
            Acorns = input.Acorns,
            SentAt = input.SentAt,
            UpdatedAt = now,
        });
        await db.SaveChangesAsync();
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound>> Seen(Guid id, HabitatDb db, TimeProvider clock)
    {
        var gift = await db.Gifts.FirstOrDefaultAsync(g => g.Id == id && g.DeletedAt == null);
        if (gift is null) return TypedResults.NotFound();
        if (gift.SeenAt is null)
        {
            var now = clock.GetUtcNow();
            (gift.SeenAt, gift.UpdatedAt) = (now, now);
            await db.SaveChangesAsync();
        }
        return TypedResults.NoContent();
    }
}
