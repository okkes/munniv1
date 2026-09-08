using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Munni.Api.Migrations
{
    /// <inheritdoc />
    public partial class MultiOwnerFeedsAndFetchDiagnostics : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "LastFetchDropped",
                table: "GcLinkedAccounts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LastFetchReceived",
                table: "GcLinkedAccounts",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "FeedOwners",
                columns: table => new
                {
                    FeedSpaceId = table.Column<string>(type: "text", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequisitionId = table.Column<Guid>(type: "uuid", nullable: true),
                    GcAccountId = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FeedOwners", x => new { x.FeedSpaceId, x.UserId });
                });

            migrationBuilder.CreateIndex(
                name: "IX_FeedOwners_UserId",
                table: "FeedOwners",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FeedOwners");

            migrationBuilder.DropColumn(
                name: "LastFetchDropped",
                table: "GcLinkedAccounts");

            migrationBuilder.DropColumn(
                name: "LastFetchReceived",
                table: "GcLinkedAccounts");
        }
    }
}
