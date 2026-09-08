using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Munni.Api.Migrations
{
    /// <inheritdoc />
    public partial class GcPendingAndRateBudget : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DailySuccessLimit",
                table: "GcLinkedAccounts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "RateResetAt",
                table: "GcLinkedAccounts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SuccessRemaining",
                table: "GcLinkedAccounts",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "GcPendingTxs",
                columns: table => new
                {
                    GcAccountId = table.Column<string>(type: "text", nullable: false),
                    EntityId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GcPendingTxs", x => new { x.GcAccountId, x.EntityId });
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GcPendingTxs");

            migrationBuilder.DropColumn(
                name: "DailySuccessLimit",
                table: "GcLinkedAccounts");

            migrationBuilder.DropColumn(
                name: "RateResetAt",
                table: "GcLinkedAccounts");

            migrationBuilder.DropColumn(
                name: "SuccessRemaining",
                table: "GcLinkedAccounts");
        }
    }
}
