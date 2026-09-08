using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Munni.Api.Migrations
{
    /// <inheritdoc />
    public partial class AdminGrantsAndProviderQuota : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AdminGrants",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Sub = table.Column<string>(type: "text", nullable: false),
                    GrantedBySub = table.Column<string>(type: "text", nullable: false),
                    GrantedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AdminGrants", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ProviderQuotas",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Provider = table.Column<string>(type: "text", nullable: false),
                    Scope = table.Column<string>(type: "text", nullable: false),
                    Limit = table.Column<int>(type: "integer", nullable: true),
                    Remaining = table.Column<int>(type: "integer", nullable: true),
                    ResetAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CapturedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProviderQuotas", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AdminGrants_Sub",
                table: "AdminGrants",
                column: "Sub",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProviderQuotas_Provider_Scope",
                table: "ProviderQuotas",
                columns: new[] { "Provider", "Scope" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AdminGrants");

            migrationBuilder.DropTable(
                name: "ProviderQuotas");
        }
    }
}
