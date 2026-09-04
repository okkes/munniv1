using System.Text.Json;
using Munni.Api.Sync;

namespace Munni.Api.Tests;

public class LwwMergeTests
{
    private static JsonElement J(string s) => JsonSerializer.SerializeToElement(s);

    private static string Hlc(long wallMs, string device = "a", int counter = 0) =>
        // mirrors apps/web/src/sync/hlc.ts encoding: base36 wall (9) + counter (4) + device
        $"{ToBase36(wallMs).PadLeft(9, '0')}-{ToBase36(counter).PadLeft(4, '0')}-{device}";

    private static string ToBase36(long value)
    {
        const string chars = "0123456789abcdefghijklmnopqrstuvwxyz";
        if (value == 0) return "0";
        var s = "";
        while (value > 0) { s = chars[(int)(value % 36)] + s; value /= 36; }
        return s;
    }

    private static SyncOpDto Op(string hlc, Dictionary<string, JsonElement>? fields = null, bool deleted = false) =>
        new(Guid.NewGuid().ToString(), "s1", "category", "c1", fields ?? new(), hlc, deleted);

    private static EntityState ApplyAll(EntityState? local, IEnumerable<SyncOpDto> ops)
    {
        var state = local;
        foreach (var op in ops) state = LwwMerge.Apply(state, op).State;
        return state!;
    }

    [Fact]
    public void CreatesRowFromFirstOp()
    {
        var (state, changed) = LwwMerge.Apply(null, Op(Hlc(100), new() { ["name"] = J("Food") }));
        Assert.True(changed);
        Assert.Equal("Food", state.Data["name"].GetString());
        Assert.False(state.Deleted);
    }

    [Fact]
    public void ConcurrentEditsToDifferentFieldsBothSurvive()
    {
        var s0 = ApplyAll(null, new[] { Op(Hlc(100), new() { ["name"] = J("Food"), ["color"] = J("red") }) });
        var s1 = ApplyAll(s0, new[]
        {
            Op(Hlc(200, "phone"), new() { ["name"] = J("Groceries") }),
            Op(Hlc(150, "laptop"), new() { ["color"] = J("green") }),
        });
        Assert.Equal("Groceries", s1.Data["name"].GetString());
        Assert.Equal("green", s1.Data["color"].GetString());
    }

    [Fact]
    public void SameFieldLaterHlcWinsRegardlessOfArrivalOrder()
    {
        var baseState = ApplyAll(null, new[] { Op(Hlc(100), new() { ["name"] = J("Food") }) });
        var early = Op(Hlc(150, "phone"), new() { ["name"] = J("Eten") });
        var late = Op(Hlc(200, "laptop"), new() { ["name"] = J("Yemek") });

        var a = ApplyAll(baseState, new[] { late, early });
        var b = ApplyAll(baseState, new[] { early, late });
        Assert.Equal("Yemek", a.Data["name"].GetString());
        Assert.Equal("Yemek", b.Data["name"].GetString());
    }

    [Fact]
    public void StaleOpIsNoOp()
    {
        var baseState = ApplyAll(null, new[] { Op(Hlc(200), new() { ["name"] = J("Food") }) });
        var (state, changed) = LwwMerge.Apply(baseState, Op(Hlc(100, "z"), new() { ["name"] = J("Old") }));
        Assert.False(changed);
        Assert.Equal("Food", state.Data["name"].GetString());
    }

    [Fact]
    public void DeleteThenNewerEditRevives_OrderIndependent()
    {
        var create = Op(Hlc(100), new() { ["name"] = J("Food") });
        var delete = Op(Hlc(130), deleted: true);
        var edit = Op(Hlc(140, "q"), new() { ["name"] = J("Back") });

        var a = ApplyAll(null, new[] { create, delete, edit });
        var b = ApplyAll(null, new[] { create, edit, delete });
        Assert.False(a.Deleted);
        Assert.False(b.Deleted);
        Assert.Equal("Back", a.Data["name"].GetString());
    }

    [Fact]
    public void OlderEditCannotResurrectTombstone()
    {
        var state = ApplyAll(null, new[]
        {
            Op(Hlc(100), new() { ["name"] = J("Food") }),
            Op(Hlc(300), deleted: true),
            Op(Hlc(200, "phone"), new() { ["name"] = J("Zombie") }),
        });
        Assert.True(state.Deleted);
    }

    [Fact]
    public void ConvergenceAcrossAllPermutations()
    {
        var ops = new[]
        {
            Op(Hlc(100, "p"), new() { ["name"] = J("A"), ["color"] = J("red") }),
            Op(Hlc(120, "q"), new() { ["name"] = J("B") }),
            Op(Hlc(110, "r"), new() { ["color"] = J("blue") }),
            Op(Hlc(130, "p"), deleted: true),
            Op(Hlc(140, "q"), new() { ["name"] = J("C") }),
        };

        var outcomes = new HashSet<string>();
        foreach (var perm in Permutations(ops))
        {
            var state = ApplyAll(null, perm);
            outcomes.Add(JsonSerializer.Serialize(new
            {
                data = state.Data.OrderBy(kv => kv.Key).ToDictionary(kv => kv.Key, kv => kv.Value.ToString()),
                versions = state.FieldVersions.OrderBy(kv => kv.Key).ToDictionary(kv => kv.Key, kv => kv.Value),
                deleted = state.Deleted,
            }));
        }

        Assert.Single(outcomes);
        var final = ApplyAll(null, ops);
        Assert.False(final.Deleted);
        Assert.Equal("C", final.Data["name"].GetString());
        Assert.Equal("blue", final.Data["color"].GetString());
    }

    private static IEnumerable<SyncOpDto[]> Permutations(SyncOpDto[] items)
    {
        if (items.Length <= 1) { yield return items; yield break; }
        for (var i = 0; i < items.Length; i++)
        {
            var rest = items.Where((_, idx) => idx != i).ToArray();
            foreach (var perm in Permutations(rest))
                yield return new[] { items[i] }.Concat(perm).ToArray();
        }
    }
}
