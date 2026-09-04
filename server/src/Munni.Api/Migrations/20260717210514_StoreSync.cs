using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Munni.Api.Migrations
{
    /// <inheritdoc />
    public partial class StoreSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "StoreConnCiphers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Store = table.Column<string>(type: "text", nullable: false),
                    Cipher = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoreConnCiphers", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "StoreSyncDevices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    DeviceId = table.Column<string>(type: "text", nullable: false),
                    PublicJwk = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    WrappedCsk = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoreSyncDevices", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_StoreConnCiphers_UserId_Store",
                table: "StoreConnCiphers",
                columns: new[] { "UserId", "Store" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StoreSyncDevices_UserId_DeviceId",
                table: "StoreSyncDevices",
                columns: new[] { "UserId", "DeviceId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "StoreConnCiphers");

            migrationBuilder.DropTable(
                name: "StoreSyncDevices");
        }
    }
}
