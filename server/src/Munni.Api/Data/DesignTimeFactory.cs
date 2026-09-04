using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Munni.Api.Data;

/// <summary>Design-time context for `dotnet ef migrations` (never used at runtime).</summary>
public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            // placeholder for schema generation only — no real database uses it
            .UseNpgsql("Host=localhost;Database=munni_design;Username=munni;Password=design") // NOSONAR(S2068)
            .Options);
}
