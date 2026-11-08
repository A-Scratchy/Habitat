using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Habitat.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class OwnerAndWinTier : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Tier",
                table: "Wins",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<Guid>(
                name: "OwnerMemberId",
                table: "Households",
                type: "uniqueidentifier",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            // In EXEC so the idempotent script compiles before the columns exist.
            // Every win takes its tend's tier (removed tends are only soft-deleted, so all are found).
            migrationBuilder.Sql("EXEC(N'UPDATE w SET w.[Tier] = t.[Tier] FROM [Wins] w JOIN [Tends] t ON t.[Id] = w.[TendId]')");
            // The owner is whoever started the habitat: its first approved user.
            migrationBuilder.Sql("""
                EXEC(N'UPDATE h SET h.[OwnerMemberId] = (
                    SELECT TOP 1 u.[MemberId] FROM [Users] u WHERE u.[HouseholdId] = h.[Id] AND u.[ApprovedAt] IS NOT NULL ORDER BY u.[CreatedAt])
                FROM [Households] h WHERE EXISTS (SELECT 1 FROM [Users] u WHERE u.[HouseholdId] = h.[Id] AND u.[ApprovedAt] IS NOT NULL)')
                """);
            // Nothing is guessed: stop if anything couldn't be filled in.
            migrationBuilder.Sql("""
                EXEC(N'IF EXISTS (SELECT 1 FROM [Wins] WHERE LEN([Tier]) = 0) OR EXISTS (SELECT 1 FROM [Households] WHERE [OwnerMemberId] = ''00000000-0000-0000-0000-000000000000'')
                    THROW 50000, ''A win without a tier or a habitat without an owner; nothing changed.'', 1;')
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Tier",
                table: "Wins");

            migrationBuilder.DropColumn(
                name: "OwnerMemberId",
                table: "Households");
        }
    }
}
