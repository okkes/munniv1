using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Munni.Api.Migrations
{
    /// <inheritdoc />
    public partial class PushSubscriptionKinds : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "P256dh",
                table: "PushSubscriptions",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "Auth",
                table: "PushSubscriptions",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            // every pre-existing subscription is a browser one
            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "PushSubscriptions",
                type: "text",
                nullable: false,
                defaultValue: "webpush");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Kind",
                table: "PushSubscriptions");

            migrationBuilder.AlterColumn<string>(
                name: "P256dh",
                table: "PushSubscriptions",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Auth",
                table: "PushSubscriptions",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);
        }
    }
}
