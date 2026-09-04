using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Munni.Api.Migrations
{
    /// <inheritdoc />
    public partial class SplitEventAttachment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AttachedEventId",
                table: "SplitMembers",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AttachedEventId",
                table: "SplitMembers");
        }
    }
}
