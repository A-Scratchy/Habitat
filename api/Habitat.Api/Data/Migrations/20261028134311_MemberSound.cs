using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Habitat.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class MemberSound : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Sound",
                table: "Members",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: false,
                // Everyone already in a habitat starts on the soft Chime, the agreed default; they can change it.
                defaultValue: "Chime");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Sound",
                table: "Members");
        }
    }
}
