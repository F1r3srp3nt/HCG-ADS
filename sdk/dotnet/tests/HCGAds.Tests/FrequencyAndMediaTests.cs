using HCG.Ads;
using Xunit;

namespace HCG.Ads.Tests;

public class FrequencyAndMediaTests
{
    private static readonly DateTimeOffset T0 = DateTimeOffset.FromUnixTimeSeconds(1_000_000);

    [Fact]
    public void CapsWithinTheWindowAndPrunesAfterIt()
    {
        var f = new FrequencyStore();
        var rule = new FrequencyRule { Count = 2, WindowHours = 1 };
        f.Record("cmp_a", rule, T0);
        Assert.Empty(f.Capped(T0));
        f.Record("cmp_a", rule, T0.AddSeconds(1));
        Assert.Equal(new[] { "cmp_a" }, f.Capped(T0.AddSeconds(2)));
        Assert.Empty(f.Capped(T0.AddSeconds(3602)));
        f.Record("cmp_b", null, T0);
        Assert.Empty(f.Capped(T0));
    }

    [Fact]
    public void PersistsOnlyWithStorageConsentAndForgetsWhenWithdrawn()
    {
        var path = Path.Combine(Path.GetTempPath(), "hcg-ads-tests-" + Guid.NewGuid(), "frequency.json");
        var f = new FrequencyStore(path, persistent: false);
        var rule = new FrequencyRule { Count = 1, WindowHours = 24 };
        f.Record("cmp_a", rule, T0);
        Assert.False(File.Exists(path));
        f.SetPersistent(true);
        f.Record("cmp_b", rule, T0);
        Assert.True(File.Exists(path));
        Assert.Equal(new[] { "cmp_b" }, new FrequencyStore(path, persistent: true).Capped(T0));
        f.SetPersistent(false);
        Assert.False(File.Exists(path));
    }

    [Fact]
    public void CorruptStorageNeverBreaksDelivery()
    {
        var path = Path.Combine(Path.GetTempPath(), "hcg-ads-tests-" + Guid.NewGuid() + ".json");
        File.WriteAllText(path, "{ not json");
        var f = new FrequencyStore(path, persistent: true);
        Assert.Empty(f.Capped(T0));
        f.Record("cmp_a", new FrequencyRule { Count = 1, WindowHours = 1 }, T0);
        Assert.Equal(new[] { "cmp_a" }, f.Capped(T0));
    }

    [Fact]
    public void CropSelectsSourcePixelsAndIsClamped()
    {
        var r = MediaMath.CropToSource(new CropRect { X = 0, Y = 0.1, Width = 1, Height = 0.8 }, 1200, 675);
        Assert.Equal(new PixelRect(0, 67.5, 1200, 540), r);
        var clamped = MediaMath.CropToSource(new CropRect { X = 0.9, Y = -1, Width = 0.5, Height = 2 }, 100, 100);
        Assert.Equal(90, clamped.X, 6);
        Assert.Equal(10, clamped.Width, 6);
        Assert.Equal(100, clamped.Height, 6);
        Assert.Equal(1.6, MediaMath.CropAspect(new AdMedia { Width = 1600, Height = 500, Crop = new CropRect { Width = 0.5, Height = 1 } })!.Value, 6);
        Assert.Null(MediaMath.CropAspect(new AdMedia { Width = 1600, Height = 500 }));
    }

    [Fact]
    public void AspectFitNeverStretches()
    {
        var wide = MediaMath.AspectFit(1920, 1080, 300, 250);
        Assert.Equal(300, wide.Width, 6);
        Assert.Equal(168.75, wide.Height, 6);
        Assert.Equal(1920.0 / 1080, wide.Width / wide.Height, 6);
        Assert.Equal(40.625, wide.Y, 6);
        var tall = MediaMath.AspectFit(1080, 1920, 300, 250);
        Assert.Equal(1080.0 / 1920, tall.Width / tall.Height, 6);
        Assert.True(tall.Height <= 250 + 1e-9 && tall.Width <= 300 + 1e-9);
        Assert.Equal(250, tall.Height, 6);
        Assert.Equal(new PixelRect(0, 0, 0, 0), MediaMath.AspectFit(0, 10, 10, 10));
    }
}
