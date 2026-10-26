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

/// <summary>A part of the home: kitchen, garden, Leo's room. Every habit and quest belongs to one.</summary>
public class Room : HouseholdEntity, ISynced
{
    public required string Name { get; set; }
    /// <summary>An emoji, or null for none (the app shows a plain house).</summary>
    public string? Icon { get; set; }
    /// <summary>Position in lists; lower comes first.</summary>
    public int SortOrder { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public long RowVersion { get; set; }
}

/// <summary>How much leaving it undone hurts its room. Weights room health 1 / 2 / 4.</summary>
public enum EcologicalImpact
{
    Small,
    Medium,
    Large,
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

/// <summary>Habits come back on a schedule; quests are one-offs that finish. Always stated, never derived.</summary>
public enum TendKind
{
    Habit,
    Quest,
}

public enum TendStatus
{
    Active,
    Paused,
}

/// <summary>
/// One thing that looks after the habitat. The Kind decides which of the kind-specific fields apply;
/// a database CHECK constraint enforces it: a habit always has FrequencyDays and never CompletedAt,
/// a quest never has FrequencyDays.
/// </summary>
public class Tend : HouseholdEntity, ISynced
{
    public TendKind Kind { get; set; }
    public required string Name { get; set; }
    /// <summary>Required for habits; optional for quests (e.g. "Go to tip" happens out and about).</summary>
    public Guid? RoomId { get; set; }
    public string? Group { get; set; }
    /// <summary>Notes or step-by-step instructions, one step per line.</summary>
    public string? Description { get; set; }
    public EffortTier Tier { get; set; }
    public EcologicalImpact Impact { get; set; }
    public List<EnergyTag> Energy { get; set; } = [];
    /// <summary>Habits only (required for them).</summary>
    public int? FrequencyDays { get; set; }
    public TendStatus Status { get; set; }
    /// <summary>Quests only: when it was finished. Set means it's on the Completed shelf.</summary>
    public DateTimeOffset? CompletedAt { get; set; }
    /// <summary>Habits only: "this is my zone". Quests use OpenToEveryone / AvailableTo instead.</summary>
    public Guid? OwnerMemberId { get; set; }
    /// <summary>Quests only (required for them): true when anyone can take it on.</summary>
    public bool? OpenToEveryone { get; set; }
    /// <summary>Quests only: who can take it on when it isn't open to everyone. It shows only on their Quests menu.</summary>
    public List<QuestMember> AvailableTo { get; set; } = [];
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

/// <summary>Append-only record of a habit or quest being done. Undo is a soft delete.</summary>
public class Win : HouseholdEntity, ISynced
{
    public Guid TendId { get; set; }
    /// <summary>Snapshots, so the feed still reads right if the tend or room is renamed or removed.</summary>
    public required string TendName { get; set; }
    /// <summary>Null for a quest done out and about, with no room.</summary>
    public Guid? RoomId { get; set; }
    public string? RoomName { get; set; }
    /// <summary>When it was done; may be backdated.</summary>
    public DateTimeOffset At { get; set; }
    /// <summary>When it was recorded.</summary>
    public DateTimeOffset LoggedAt { get; set; }
    public Guid LoggedByDeviceId { get; set; }
    public List<WinMember> Members { get; set; } = [];
    /// <summary>True when this win finished a quest, so undoing it puts the quest back on the open list.</summary>
    public bool CompletedQuest { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public long RowVersion { get; set; }
}

/// <summary>A member who may take on a quest that isn't open to everyone.</summary>
public class QuestMember
{
    public Guid MemberId { get; set; }
}

/// <summary>Everyone credited with a win. The first-tagged person is primary.</summary>
public class WinMember
{
    public Guid MemberId { get; set; }
    public bool IsPrimary { get; set; }
}

public static class TendRules
{
    public const int DescriptionMax = 1000;
    public const int MaxFrequencyDays = 3650;
}
