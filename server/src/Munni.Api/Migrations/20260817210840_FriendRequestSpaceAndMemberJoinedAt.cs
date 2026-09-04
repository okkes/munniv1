using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Munni.Api.Migrations
{
    /// <inheritdoc />
    public partial class FriendRequestSpaceAndMemberJoinedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "JoinedAt",
                table: "SpaceMembers",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SpaceId",
                table: "Friendships",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SpaceName",
                table: "Friendships",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SpaceRole",
                table: "Friendships",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "JoinedAt",
                table: "SpaceMembers");

            migrationBuilder.DropColumn(
                name: "SpaceId",
                table: "Friendships");

            migrationBuilder.DropColumn(
                name: "SpaceName",
                table: "Friendships");

            migrationBuilder.DropColumn(
                name: "SpaceRole",
                table: "Friendships");
        }
    }
}
