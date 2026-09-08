using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Munni.Api.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EntityRows",
                columns: table => new
                {
                    SpaceId = table.Column<string>(type: "text", nullable: false),
                    Entity = table.Column<string>(type: "text", nullable: false),
                    EntityId = table.Column<string>(type: "text", nullable: false),
                    Deleted = table.Column<bool>(type: "boolean", nullable: false),
                    DataJson = table.Column<string>(type: "text", nullable: false),
                    FieldVersionsJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EntityRows", x => new { x.SpaceId, x.Entity, x.EntityId });
                });

            migrationBuilder.CreateTable(
                name: "GcLinkedAccounts",
                columns: table => new
                {
                    GcAccountId = table.Column<string>(type: "text", nullable: false),
                    SpaceId = table.Column<string>(type: "text", nullable: false),
                    AccountEntityId = table.Column<string>(type: "text", nullable: false),
                    Iban = table.Column<string>(type: "text", nullable: false),
                    Currency = table.Column<string>(type: "text", nullable: false),
                    RequisitionId = table.Column<Guid>(type: "uuid", nullable: false),
                    LastFetchAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GcLinkedAccounts", x => x.GcAccountId);
                });

            migrationBuilder.CreateTable(
                name: "GcRequisitions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SpaceId = table.Column<string>(type: "text", nullable: false),
                    InstitutionId = table.Column<string>(type: "text", nullable: false),
                    RequisitionId = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GcRequisitions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SpaceMembers",
                columns: table => new
                {
                    SpaceId = table.Column<string>(type: "text", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Role = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SpaceMembers", x => new { x.SpaceId, x.UserId });
                });

            migrationBuilder.CreateTable(
                name: "Spaces",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    LastSeq = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Spaces", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SyncOps",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SpaceId = table.Column<string>(type: "text", nullable: false),
                    Seq = table.Column<long>(type: "bigint", nullable: false),
                    OpId = table.Column<string>(type: "text", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Entity = table.Column<string>(type: "text", nullable: false),
                    EntityId = table.Column<string>(type: "text", nullable: false),
                    Hlc = table.Column<string>(type: "text", nullable: false),
                    PayloadJson = table.Column<string>(type: "text", nullable: false),
                    Deleted = table.Column<bool>(type: "boolean", nullable: false),
                    ReceivedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SyncOps", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Sub = table.Column<string>(type: "text", nullable: false),
                    Email = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GcLinkedAccounts_SpaceId",
                table: "GcLinkedAccounts",
                column: "SpaceId");

            migrationBuilder.CreateIndex(
                name: "IX_SpaceMembers_UserId",
                table: "SpaceMembers",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_SyncOps_SpaceId_OpId",
                table: "SyncOps",
                columns: new[] { "SpaceId", "OpId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SyncOps_SpaceId_Seq",
                table: "SyncOps",
                columns: new[] { "SpaceId", "Seq" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_Sub",
                table: "Users",
                column: "Sub",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EntityRows");

            migrationBuilder.DropTable(
                name: "GcLinkedAccounts");

            migrationBuilder.DropTable(
                name: "GcRequisitions");

            migrationBuilder.DropTable(
                name: "SpaceMembers");

            migrationBuilder.DropTable(
                name: "Spaces");

            migrationBuilder.DropTable(
                name: "SyncOps");

            migrationBuilder.DropTable(
                name: "Users");
        }
    }
}
