using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Habitat.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class Bounties : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "BountyAcorns",
                table: "Wins",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "BountyAcorns",
                table: "Tends",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "BountyPostedAt",
                table: "Tends",
                type: "datetimeoffset",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BountyAcorns",
                table: "Wins");

            migrationBuilder.DropColumn(
                name: "BountyAcorns",
                table: "Tends");

            migrationBuilder.DropColumn(
                name: "BountyPostedAt",
                table: "Tends");
        }
    }
}
