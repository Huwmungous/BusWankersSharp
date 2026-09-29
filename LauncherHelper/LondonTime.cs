using System.Globalization;

namespace Autofills.LauncherHelper;

/// <summary>
/// UK civil time, implemented by hand rather than through TimeZoneInfo: the published
/// helper runs with invariant globalization (no ICU), where looking up "Europe/London"
/// is not dependable on every operating system. The rule has been stable since 1996:
/// British Summer Time (UTC+1) runs from 01:00 UTC on the last Sunday of March to
/// 01:00 UTC on the last Sunday of October; otherwise it is GMT (UTC+0).
///
/// The sale time on the page is entered as a London wall-clock time, so the helper
/// takes the same thing and converts it here.
/// </summary>
public static class LondonTime
{
    private static readonly TimeSpan Bst = TimeSpan.FromHours(1);

    public static DateTime BstStartUtc(int year) => LastSunday(year, 3).AddHours(1);

    public static DateTime BstEndUtc(int year) => LastSunday(year, 10).AddHours(1);

    public static bool IsBst(DateTime utc)
    {
        var start = BstStartUtc(utc.Year);
        var end = BstEndUtc(utc.Year);
        return utc >= start && utc < end;
    }

    public static TimeSpan OffsetAt(DateTime utc) => IsBst(utc) ? Bst : TimeSpan.Zero;

    /// <summary>
    /// Converts a London wall-clock time to UTC. False when the time does not exist
    /// (the hour skipped when the clocks go forward, 01:00-02:00 on that Sunday). An
    /// ambiguous time (the hour repeated when they go back) takes the first, BST, one.
    /// </summary>
    public static bool TryWallToUtc(DateTime wall, out DateTimeOffset utc)
    {
        var asGmt = DateTime.SpecifyKind(wall, DateTimeKind.Utc);
        var asBst = asGmt - Bst;

        if (OffsetAt(asBst) == Bst)
        {
            utc = new DateTimeOffset(asBst, TimeSpan.Zero);
            return true;
        }

        if (OffsetAt(asGmt) == TimeSpan.Zero)
        {
            utc = new DateTimeOffset(asGmt, TimeSpan.Zero);
            return true;
        }

        utc = default;
        return false;
    }

    /// <summary>"01 Oct 2026 09:00:00.000 BST" - a UTC instant shown as London time.</summary>
    public static string Format(DateTimeOffset utc)
    {
        var instant = utc.UtcDateTime;
        var offset = OffsetAt(instant);
        var local = instant + offset;
        var zone = offset == Bst ? "BST" : "GMT";
        return local.ToString("dd MMM yyyy HH:mm:ss.fff", CultureInfo.InvariantCulture) + " " + zone;
    }

    private static DateTime LastSunday(int year, int month)
    {
        var lastDay = new DateTime(year, month, DateTime.DaysInMonth(year, month), 0, 0, 0, DateTimeKind.Utc);
        return lastDay.AddDays(-(int)lastDay.DayOfWeek);
    }
}
