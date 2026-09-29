using Autofills.LauncherHelper;
using Xunit;

namespace LauncherHelper.Tests;

public class LaunchOptionsTests
{
    [Fact]
    public void AtWithNothingElse_TakesTheDefaults()
    {
        var options = LaunchOptions.Parse(["--at", "2026-10-01T09:00"]);

        Assert.Equal(LaunchOptions.DefaultUrl, options.Url);
        Assert.Equal(200, options.LeadMs);
        Assert.Equal(300, options.StaggerMs);
        Assert.Equal(45, options.WarmSeconds);
        Assert.Null(options.RehearseSeconds);
        Assert.Empty(options.Only);
        Assert.Equal(LaunchOptions.DefaultNtpServers, options.NtpServers);
    }

    [Fact]
    public void TheSaleTimeIsUkTime_SoNineOnFirstOctoberIsEightUtc()
    {
        var options = LaunchOptions.Parse(["--at", "2026-10-01T09:00"]);
        Assert.Equal(new DateTimeOffset(2026, 10, 1, 8, 0, 0, TimeSpan.Zero), options.SaleAtUtc);
    }

    [Theory]
    [InlineData("2026-10-01T09:00")]
    [InlineData("2026-10-01T09:00:00")]
    [InlineData("2026-10-01 09:00")]
    [InlineData("2026-10-01 09:00:00")]
    public void TheSaleTimeAcceptsTheFormatsThePageAndAPersonWouldType(string text)
    {
        var options = LaunchOptions.Parse(["--at", text]);
        Assert.Equal(new DateTimeOffset(2026, 10, 1, 8, 0, 0, TimeSpan.Zero), options.SaleAtUtc);
    }

    [Fact]
    public void OptionsAcceptEqualsAsWellAsASeparateValue()
    {
        var options = LaunchOptions.Parse(["--at=2026-10-01T09:00", "--lead=-50", "--stagger", "0", "--warm=0"]);
        Assert.Equal(-50, options.LeadMs);
        Assert.Equal(0, options.StaggerMs);
        Assert.Equal(0, options.WarmSeconds);
    }

    [Fact]
    public void OnlyAndNtpAreCommaSeparatedLists()
    {
        var options = LaunchOptions.Parse(["--rehearse", "30", "--only", "Chrome, Firefox", "--ntp", "a.example,b.example"]);
        Assert.Equal(["chrome", "firefox"], options.Only);
        Assert.Equal(["a.example", "b.example"], options.NtpServers);
    }

    [Fact]
    public void RehearseAloneIsEnough()
    {
        var options = LaunchOptions.Parse(["--rehearse", "30"]);
        Assert.Equal(30, options.RehearseSeconds);
        Assert.Null(options.SaleAtUtc);
    }

    [Fact]
    public void ListAndHelpNeedNoTime()
    {
        Assert.True(LaunchOptions.Parse(["--list"]).List);
        Assert.True(LaunchOptions.Parse(["--help"]).Help);
        Assert.True(LaunchOptions.Parse(["-h"]).Help);
    }

    [Fact]
    public void FlagsSwitchThingsOn()
    {
        var options = LaunchOptions.Parse(["--rehearse", "30", "--dry-run", "--verbose"]);
        Assert.True(options.DryRun);
        Assert.True(options.Verbose);
    }

    [Fact]
    public void NoTimeAtAll_IsAnError_ThatSaysHowToGiveOne()
    {
        var error = Assert.Throws<OptionsException>(() => LaunchOptions.Parse(["--url", "https://example.com/"]));
        Assert.Contains("--at", error.Message);
        Assert.Contains("--rehearse", error.Message);
    }

    [Theory]
    [InlineData("ftp://example.com/")]
    [InlineData("glastonbury.seetickets.com")]
    [InlineData("")]
    public void TheUrlMustBeAFullHttpAddress(string url)
    {
        Assert.Throws<OptionsException>(() => LaunchOptions.Parse(["--url", url, "--rehearse", "30"]));
    }

    [Fact]
    public void ABadSaleTime_IsRejected()
    {
        Assert.Throws<OptionsException>(() => LaunchOptions.Parse(["--at", "tomorrow"]));
        Assert.Throws<OptionsException>(() => LaunchOptions.Parse(["--at", "01/10/2026 09:00"]));
    }

    [Fact]
    public void ATimeThatDoesNotExistInUkTime_IsRejected()
    {
        var error = Assert.Throws<OptionsException>(() => LaunchOptions.Parse(["--at", "2026-03-29T01:30"]));
        Assert.Contains("does not exist", error.Message);
    }

    [Theory]
    [InlineData("--lead", "60001")]
    [InlineData("--lead", "-60001")]
    [InlineData("--stagger", "-1")]
    [InlineData("--stagger", "10001")]
    [InlineData("--warm", "601")]
    [InlineData("--rehearse", "4")]
    [InlineData("--lead", "soon")]
    public void NumbersOutOfRangeOrNotNumbers_AreRejected(string option, string value)
    {
        Assert.Throws<OptionsException>(() => LaunchOptions.Parse(["--at", "2026-10-01T09:00", option, value]));
    }

    [Fact]
    public void AnOptionMissingItsValue_IsRejected()
    {
        var error = Assert.Throws<OptionsException>(() => LaunchOptions.Parse(["--at"]));
        Assert.Contains("needs a value", error.Message);
    }

    [Fact]
    public void UnknownOptionsAndStrayWords_AreRejected()
    {
        Assert.Throws<OptionsException>(() => LaunchOptions.Parse(["--at", "2026-10-01T09:00", "--frobnicate"]));
        Assert.Throws<OptionsException>(() => LaunchOptions.Parse(["2026-10-01T09:00"]));
    }
}
