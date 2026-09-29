using Autofills.LauncherHelper;
using Xunit;

namespace LauncherHelper.Tests;

public class LondonTimeTests
{
    [Fact]
    public void BstStartsOnTheLastSundayOfMarch_AtOneUtc()
    {
        // 2026: 29 March is the last Sunday of March.
        Assert.Equal(new DateTime(2026, 3, 29, 1, 0, 0, DateTimeKind.Utc), LondonTime.BstStartUtc(2026));
    }

    [Fact]
    public void BstEndsOnTheLastSundayOfOctober_AtOneUtc()
    {
        // 2026: 25 October is the last Sunday of October.
        Assert.Equal(new DateTime(2026, 10, 25, 1, 0, 0, DateTimeKind.Utc), LondonTime.BstEndUtc(2026));
    }

    [Fact]
    public void WhenTheLastDayOfTheMonthIsASunday_ThatIsTheDay()
    {
        // 31 March 2024 was a Sunday.
        Assert.Equal(new DateTime(2024, 3, 31, 1, 0, 0, DateTimeKind.Utc), LondonTime.BstStartUtc(2024));
    }

    [Fact]
    public void SaleMorningInOctober_IsBst_SoLondonNineIsEightUtc()
    {
        // The Glastonbury sale mornings: 09:00 in London on 1 October is BST (UTC+1).
        Assert.True(LondonTime.TryWallToUtc(new DateTime(2026, 10, 1, 9, 0, 0), out var utc));
        Assert.Equal(new DateTimeOffset(2026, 10, 1, 8, 0, 0, TimeSpan.Zero), utc);
    }

    [Fact]
    public void WinterTime_IsGmt_SoLondonAndUtcAgree()
    {
        Assert.True(LondonTime.TryWallToUtc(new DateTime(2026, 12, 25, 12, 0, 0), out var utc));
        Assert.Equal(new DateTimeOffset(2026, 12, 25, 12, 0, 0, TimeSpan.Zero), utc);
    }

    [Fact]
    public void TheHourSkippedWhenClocksGoForward_DoesNotExist()
    {
        Assert.False(LondonTime.TryWallToUtc(new DateTime(2026, 3, 29, 1, 30, 0), out _));
    }

    [Fact]
    public void TheHourRepeatedWhenClocksGoBack_TakesTheFirstOne()
    {
        Assert.True(LondonTime.TryWallToUtc(new DateTime(2026, 10, 25, 1, 30, 0), out var utc));
        // 01:30 BST = 00:30 UTC, the earlier of the two 01:30s.
        Assert.Equal(new DateTimeOffset(2026, 10, 25, 0, 30, 0, TimeSpan.Zero), utc);
    }

    [Fact]
    public void JustAfterTheClocksGoBack_IsGmt()
    {
        Assert.True(LondonTime.TryWallToUtc(new DateTime(2026, 10, 25, 2, 0, 0), out var utc));
        Assert.Equal(new DateTimeOffset(2026, 10, 25, 2, 0, 0, TimeSpan.Zero), utc);
    }

    [Fact]
    public void Format_ShowsLondonTimeWithItsZone()
    {
        var bst = new DateTimeOffset(2026, 10, 1, 8, 0, 0, 250, TimeSpan.Zero);
        Assert.Equal("01 Oct 2026 09:00:00.250 BST", LondonTime.Format(bst));

        var gmt = new DateTimeOffset(2026, 12, 25, 12, 0, 0, TimeSpan.Zero);
        Assert.Equal("25 Dec 2026 12:00:00.000 GMT", LondonTime.Format(gmt));
    }
}
