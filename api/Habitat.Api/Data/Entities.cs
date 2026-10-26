namespace Habitat.Api.Data;

/// <summary>Anything that belongs to one household. Queries are filtered to the caller's household.</summary>
public abstract class HouseholdEntity
{
    public Guid Id { get; set; }
    public Guid HouseholdId { get; set; }
}

/// <summary>Rows that devices sync. Deletes are soft so other devices learn about them.</summary>
public interface ISynced
{
    DateTimeOffset UpdatedAt { get; set; }
    DateTimeOffset? DeletedAt { get; set; }
    /// <summary>SQL Server rowversion, read as a number: the sync cursor.</summary>
    long RowVersion { get; set; }
}

/// <summary>A habitat: one home and everyone in it.</summary>
public class Household
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    /// <summary>IANA zone, e.g. Europe/London. Defines when "today" starts for claims.</summary>
    public required string TimeZoneId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Everyone who is part of a habitat: a name and an animal. Some members are also users.</summary>
public class Member : HouseholdEntity, ISynced
{
    public required string Name { get; set; }
    public required string Animal { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public long RowVersion { get; set; }
}

/// <summary>
/// A member who signs in with an email and can manage the habitat: devices, approvals, invites.
/// The model allows one login in several habitats; "one habitat per email" is endpoint policy, not schema.
/// </summary>
public class User : HouseholdEntity
{
    public required string Provider { get; set; }
    /// <summary>Stable id from the identity provider (Entra object id).</summary>
    public required string Subject { get; set; }
    public string? Email { get; set; }
    public Guid MemberId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    /// <summary>Null for someone who joined by invite and hasn't been approved yet. Unapproved users can't manage anything.</summary>
    public DateTimeOffset? ApprovedAt { get; set; }
}

public class Device : HouseholdEntity
{
    public required string Name { get; set; }
    /// <summary>SHA-256 of the bearer token. The token itself is never stored.</summary>
    public required string TokenHash { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    /// <summary>Null while waiting for a user to approve it.</summary>
    public DateTimeOffset? ApprovedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
    /// <summary>Set when a user signed in on this device rather than it being paired.</summary>
    public Guid? UserId { get; set; }
}

public enum PairingKind
{
    /// <summary>Any device joins; no sign-in needed.</summary>
    Device,
    /// <summary>Someone joins as a user, signing in with their own email.</summary>
    User,
}

public class PairingCode : HouseholdEntity
{
    public required string CodeHash { get; set; }
    public PairingKind Kind { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? UsedAt { get; set; }
    public Guid CreatedByUserId { get; set; }
    public Guid? DeviceId { get; set; }
}

public enum EffortTier
{
    Sloth,
    Tortoise,
    Bee,
    Elephant,
}

public enum EnergyTag
{
    Micro,
    Brainless,
    Transition,
    Sensory,
}

public enum ChoreStatus
{
    Active,
    Paused,
    OnDemand,
}

/// <summary>Named Chore, not Task, to stay clear of System.Threading.Tasks.Task.</summary>
public class Chore : HouseholdEntity, ISynced
{
    public required string Name { get; set; }
    public required string Room { get; set; }
    public string? Group { get; set; }
    public EffortTier Tier { get; set; }
    public List<EnergyTag> Energy { get; set; } = [];
    public int? FrequencyDays { get; set; }
    public ChoreStatus Status { get; set; }
    public Guid? OwnerMemberId { get; set; }
    public Guid? ClaimMemberId { get; set; }
    /// <summary>Household-local date the claim is for. A claim from another day has lapsed.</summary>
    public DateOnly? ClaimDay { get; set; }
    /// <summary>A "last done" date brought in by import, before any wins existed.</summary>
    public DateTimeOffset? SeedLastDoneAt { get; set; }
    /// <summary>Owned by the server: the later of the seed date and the latest non-deleted win. Devices never write it.</summary>
    public DateTimeOffset? LastDoneAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public long RowVersion { get; set; }
}

/// <summary>Append-only record of a chore being done. Undo is a soft delete.</summary>
public class Win : HouseholdEntity, ISynced
{
    public Guid ChoreId { get; set; }
    /// <summary>Snapshot, so the feed still reads right if the chore is renamed or removed.</summary>
    public required string ChoreName { get; set; }
    public required string Room { get; set; }
    /// <summary>When it was done; may be backdated.</summary>
    public DateTimeOffset At { get; set; }
    /// <summary>When it was recorded.</summary>
    public DateTimeOffset LoggedAt { get; set; }
    public Guid LoggedByDeviceId { get; set; }
    public List<WinMember> Members { get; set; } = [];
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public long RowVersion { get; set; }
}

/// <summary>Everyone credited with a win. The first-tagged person is primary.</summary>
public class WinMember
{
    public Guid MemberId { get; set; }
    public bool IsPrimary { get; set; }
}
