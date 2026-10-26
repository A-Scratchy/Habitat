using Microsoft.EntityFrameworkCore;

namespace Habitat.Api.Data;

/// <summary>"Today" is the household's calendar day, not the server's or a phone's.</summary>
public static class HouseholdTime
{
    public static DateOnly LocalDate(string timeZoneId, DateTimeOffset at) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(at, TimeZoneInfo.FindSystemTimeZoneById(timeZoneId)).DateTime);

    public static async Task<string> TimeZoneOf(this HabitatDb db, Guid householdId) =>
        await db.Households.Where(h => h.Id == householdId).Select(h => h.TimeZoneId).FirstAsync();
}
