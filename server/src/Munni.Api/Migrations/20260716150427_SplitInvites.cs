using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Munni.Api.Migrations
{
    /// <inheritdoc />
    public partial class SplitInvites : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SplitInvites",
                columns: table => new
                {
                    Token = table.Column<string>(type: "text", nullable: false),
                    SplitId = table.Column<string>(type: "text", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SplitInvites", x => x.Token);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SplitInvites_SplitId",
                table: "SplitInvites",
                column: "SplitId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SplitInvites");
        }
    }
}
