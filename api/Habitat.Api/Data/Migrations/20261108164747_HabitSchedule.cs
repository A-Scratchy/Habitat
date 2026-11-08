using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Habitat.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class HabitSchedule : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Tends_KindFields",
                table: "Tends");

            migrationBuilder.AddColumn<string>(
                name: "Schedule",
                table: "Tends",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            // Every habit until now had a frequency, so every one of them is on an Every schedule.
            // EXEC so the column is only looked up when this runs, after it's been added.
            migrationBuilder.Sql("EXEC(N'UPDATE [Tends] SET [Schedule] = ''Every'' WHERE [Kind] = ''Habit''')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Tends_KindFields",
                table: "Tends",
                sql: "([Kind] = 'Habit' AND [RoomId] IS NOT NULL AND [CompletedAt] IS NULL AND [OpenToEveryone] IS NULL AND [Schedule] IS NOT NULL AND (([Schedule] = 'Every' AND [FrequencyDays] IS NOT NULL AND [FrequencyDays] BETWEEN 1 AND 3650) OR ([Schedule] = 'WhenNeeded' AND [FrequencyDays] IS NULL))) OR ([Kind] = 'Quest' AND [Schedule] IS NULL AND [FrequencyDays] IS NULL AND [OpenToEveryone] IS NOT NULL AND [OwnerMemberId] IS NULL)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Tends_KindFields",
                table: "Tends");

            // The old rules can't hold a habit without a frequency, so refuse rather than lose them.
            migrationBuilder.Sql("EXEC(N'IF EXISTS (SELECT 1 FROM [Tends] WHERE [Schedule] = ''WhenNeeded'' AND [DeletedAt] IS NULL) THROW 50000, ''Habits done when needed exist; change them first.'', 1')");

            migrationBuilder.DropColumn(
                name: "Schedule",
                table: "Tends");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Tends_KindFields",
                table: "Tends",
                sql: "([Kind] = 'Habit' AND [RoomId] IS NOT NULL AND [FrequencyDays] IS NOT NULL AND [FrequencyDays] BETWEEN 1 AND 3650 AND [CompletedAt] IS NULL AND [OpenToEveryone] IS NULL) OR ([Kind] = 'Quest' AND [FrequencyDays] IS NULL AND [OpenToEveryone] IS NOT NULL AND [OwnerMemberId] IS NULL)");
        }
    }
}
