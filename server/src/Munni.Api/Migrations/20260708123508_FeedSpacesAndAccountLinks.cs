using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Munni.Api.Migrations
{
    /// <inheritdoc />
    public partial class FeedSpacesAndAccountLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FeedSpaces",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    OwnerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountRef = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FeedSpaces", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SpaceAccountLinks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SpaceId = table.Column<string>(type: "text", nullable: false),
                    FeedSpaceId = table.Column<string>(type: "text", nullable: false),
                    AccountId = table.Column<string>(type: "text", nullable: false),
                    AttachedBy = table.Column<Guid>(type: "uuid", nullable: false),
                    HistoryFrom = table.Column<string>(type: "text", nullable: true),
                    Archived = table.Column<bool>(type: "boolean", nullable: false),
                    ArchivedAtSeq = table.Column<long>(type: "bigint", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SpaceAccountLinks", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FeedSpaces_OwnerUserId",
                table: "FeedSpaces",
                column: "OwnerUserId");

            migrationBuilder.CreateIndex(
                name: "IX_SpaceAccountLinks_FeedSpaceId",
                table: "SpaceAccountLinks",
                column: "FeedSpaceId");

            migrationBuilder.CreateIndex(
                name: "IX_SpaceAccountLinks_SpaceId_FeedSpaceId_AccountId",
                table: "SpaceAccountLinks",
                columns: new[] { "SpaceId", "FeedSpaceId", "AccountId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FeedSpaces");

            migrationBuilder.DropTable(
                name: "SpaceAccountLinks");
        }
    }
}
