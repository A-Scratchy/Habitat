using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Habitat.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class Gifts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Gifts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    FromMemberId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ToMemberId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Acorns = table.Column<int>(type: "int", nullable: false),
                    SentAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    SeenAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false),
                    HouseholdId = table.Column<Guid>(type: "uniqueidentifier", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Gifts", x => x.Id);
                    table.CheckConstraint("CK_Gifts_NotToSelf", "[FromMemberId] <> [ToMemberId]");
                    table.ForeignKey(
                        name: "FK_Gifts_Households_HouseholdId",
                        column: x => x.HouseholdId,
                        principalTable: "Households",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Gifts_HouseholdId",
                table: "Gifts",
                column: "HouseholdId");

            migrationBuilder.CreateIndex(
                name: "IX_Gifts_RowVersion",
                table: "Gifts",
                column: "RowVersion");

            migrationBuilder.CreateIndex(
                name: "IX_Gifts_ToMemberId",
                table: "Gifts",
                column: "ToMemberId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Gifts");
        }
    }
}
