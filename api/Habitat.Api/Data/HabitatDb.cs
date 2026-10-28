using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Habitat.Api.Data;

/// <summary>Which household the current request belongs to, if any.</summary>
public interface ICurrentHousehold
{
    Guid? Id { get; }
}

public class HabitatDb(DbContextOptions<HabitatDb> options, ICurrentHousehold? current = null) : DbContext(options)
{
    public DbSet<Household> Households => Set<Household>();
    public DbSet<Member> Members => Set<Member>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<PairingCode> PairingCodes => Set<PairingCode>();
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<Tend> Tends => Set<Tend>();
    public DbSet<Win> Wins => Set<Win>();

    /// <summary>Read by the query filters on every query, so it must stay a property of the context.</summary>
    public Guid? CurrentHouseholdId => current?.Id;

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Household>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.TimeZoneId).HasMaxLength(64);
        });

        b.Entity<Member>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(40);
            e.Property(x => x.Animal).HasMaxLength(16);
            e.Property(x => x.Sound).HasConversion<string>().HasMaxLength(16);
        });

        b.Entity<User>(e =>
        {
            e.Property(x => x.Provider).HasMaxLength(32);
            e.Property(x => x.Subject).HasMaxLength(128);
            e.Property(x => x.Email).HasMaxLength(256);
            // Unique per household, not globally, so one login could later belong to several habitats.
            e.HasIndex(x => new { x.HouseholdId, x.Provider, x.Subject }).IsUnique();
            e.HasIndex(x => new { x.Provider, x.Subject });
        });

        b.Entity<Device>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(60);
            e.Property(x => x.TokenHash).HasMaxLength(64).IsFixedLength();
            e.HasIndex(x => x.TokenHash).IsUnique();
        });

        b.Entity<PairingCode>(e =>
        {
            e.Property(x => x.CodeHash).HasMaxLength(64).IsFixedLength();
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(16);
            e.HasIndex(x => x.CodeHash).IsUnique();
        });

        b.Entity<Room>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(40);
            e.Property(x => x.Icon).HasMaxLength(16);
            // Room names are unique within a habitat (removed rooms don't count).
            e.HasIndex(x => new { x.HouseholdId, x.Name }).IsUnique().HasFilter("[DeletedAt] IS NULL");
        });

        b.Entity<Tend>(e =>
        {
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(8);
            e.Property(x => x.Name).HasMaxLength(80);
            e.HasOne<Room>().WithMany().HasForeignKey(x => x.RoomId).OnDelete(DeleteBehavior.NoAction);
            e.Property(x => x.Impact).HasConversion<string>().HasMaxLength(8);
            e.Property(x => x.Group).HasMaxLength(40);
            e.Property(x => x.Description).HasMaxLength(TendRules.DescriptionMax);
            e.Property(x => x.Tier).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            e.PrimitiveCollection(x => x.Energy).ElementType().HasConversion<string>();
            e.OwnsMany(x => x.AvailableTo, m =>
            {
                m.ToTable("QuestMembers");
                m.WithOwner().HasForeignKey("TendId");
                m.HasKey("TendId", nameof(QuestMember.MemberId));
                m.HasIndex(x => x.MemberId);
            });
            // The habit/quest rules live in the database too, so no code path can store a half-and-half tend.
            // "IS NOT NULL" is spelled out: SQL treats a CHECK that evaluates to unknown (NULL BETWEEN ...) as passing.
            e.ToTable(t => t.HasCheckConstraint(
                "CK_Tends_KindFields",
                "([Kind] = 'Habit' AND [RoomId] IS NOT NULL AND [FrequencyDays] IS NOT NULL AND [FrequencyDays] BETWEEN 1 AND 3650 AND [CompletedAt] IS NULL AND [OpenToEveryone] IS NULL) OR ([Kind] = 'Quest' AND [FrequencyDays] IS NULL AND [OpenToEveryone] IS NOT NULL AND [OwnerMemberId] IS NULL)"));
        });

        b.Entity<Win>(e =>
        {
            e.Property(x => x.TendName).HasMaxLength(80);
            e.Property(x => x.RoomName).HasMaxLength(40);
            e.HasIndex(x => new { x.TendId, x.At });
            e.OwnsMany(x => x.Members, m =>
            {
                m.ToTable("WinMembers");
                m.WithOwner().HasForeignKey("WinId");
                m.HasKey("WinId", nameof(WinMember.MemberId));
                m.HasIndex(x => x.MemberId);
            });
        });

        foreach (var type in b.Model.GetEntityTypes().Where(t => typeof(HouseholdEntity).IsAssignableFrom(t.ClrType)))
        {
            b.Entity(type.ClrType).HasOne(typeof(Household)).WithMany().HasForeignKey(nameof(HouseholdEntity.HouseholdId)).OnDelete(DeleteBehavior.Cascade);
            b.Entity(type.ClrType).HasIndex(nameof(HouseholdEntity.HouseholdId));
            b.Entity(type.ClrType).HasQueryFilter(HouseholdFilter(type.ClrType));
        }

        foreach (var type in b.Model.GetEntityTypes().Where(t => typeof(ISynced).IsAssignableFrom(t.ClrType)))
        {
            // Stored as rowversion; read as a big-endian number so "changed since" is a plain comparison.
            b.Entity(type.ClrType).Property(nameof(ISynced.RowVersion)).IsRowVersion().HasConversion<byte[]>();
            b.Entity(type.ClrType).HasIndex(nameof(ISynced.RowVersion));
        }
    }

    /// <summary>Builds <c>e => e.HouseholdId == CurrentHouseholdId</c> for one entity type.</summary>
    private LambdaExpression HouseholdFilter(Type type)
    {
        var e = Expression.Parameter(type, "e");
        var householdId = Expression.Convert(Expression.Property(e, nameof(HouseholdEntity.HouseholdId)), typeof(Guid?));
        var current = Expression.Property(Expression.Constant(this), nameof(CurrentHouseholdId));
        return Expression.Lambda(Expression.Equal(householdId, current), e);
    }
}

/// <summary>Lets <c>dotnet ef</c> build the model without the web host.</summary>
public class DesignTimeFactory : IDesignTimeDbContextFactory<HabitatDb>
{
    public HabitatDb CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<HabitatDb>().UseSqlServer("Server=(localdb)\\MSSQLLocalDB;Database=Habitat").Options);
}
