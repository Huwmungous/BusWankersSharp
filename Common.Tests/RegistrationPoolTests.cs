using System.Data;
using Autofills.Common;
using Xunit;

namespace Common.Tests;

// The Registrations tab (2026-10-04): reg number + postcode pairs read from the
// compiled workbook's "Unique Reg Numbers" tab and handed out once each. These
// tests pin down the reader (including the oddities in the real sheet) and the
// allocation rules.
public class RegistrationPoolReaderTests
{
    private static DataSet BuildDataSet(string sheetName, params string[][] rows)
    {
        var table = new DataTable(sheetName);
        var maxCols = rows.Max(r => r.Length);
        for (var c = 0; c < maxCols; c++) table.Columns.Add();
        foreach (var r in rows)
        {
            var row = table.NewRow();
            for (var c = 0; c < r.Length; c++) row[c] = r[c];
            table.Rows.Add(row);
        }

        var ds = new DataSet();
        ds.Tables.Add(table);
        return ds;
    }

    [Fact]
    public void ReadsRegNumberFromColumnAAndPostcodeFromColumnD_WhenThereIsNoHeadingRow()
    {
        // The real sheet: Reg, First, Last, Postcode, Year, Flag - no headings.
        var ds = BuildDataSet("Unique Reg Numbers",
            new[] { "37816617", "Andrew", "Best", "S702LD", "2026", "Y" },
            new[] { "79229636", "Natalie", "Allott", "S75 3TB", "2017", "Y" });

        var result = RegistrationPoolReader.Read(ds);

        Assert.Equal(new[] { "37816617", "79229636" }, result.Entries.Select(e => e.RegNumber));
        Assert.Equal(new[] { "S702LD", "S75 3TB" }, result.Entries.Select(e => e.PostCode));
    }

    [Fact]
    public void FindsColumnsByHeading_WhenAHeadingRowIsPresent()
    {
        var ds = BuildDataSet("Unique Reg Numbers",
            new[] { "Postcode", "Reg Number" },
            new[] { "S702LD", "37816617" });

        var result = RegistrationPoolReader.Read(ds);

        var only = Assert.Single(result.Entries);
        Assert.Equal("37816617", only.RegNumber);
        Assert.Equal("S702LD", only.PostCode);
    }

    [Fact]
    public void SheetNameIsMatchedTrimmedAndCaseInsensitively()
    {
        var ds = BuildDataSet("  unique reg numbers ", new[] { "37816617", "A", "B", "S702LD" });

        Assert.Single(RegistrationPoolReader.Read(ds).Entries);
    }

    [Fact]
    public void ADuplicateRegNumberKeepsTheFirstRow()
    {
        // The real sheet repeats 2825546003 on its last row with the columns
        // shifted (postcode in the first-name column, "Best" where the postcode
        // belongs). The good row comes first and must win.
        var ds = BuildDataSet("Unique Reg Numbers",
            new[] { "2825546003", "Andy", "Best", "YO225EZ", "2025", "Y" },
            new[] { "2825546003", "YO225EZ", "Andrew", "Best", "2024", "Y" });

        var result = RegistrationPoolReader.Read(ds);

        var only = Assert.Single(result.Entries);
        Assert.Equal("YO225EZ", only.PostCode);
        Assert.Equal(1, result.DuplicateRows);
    }

    [Fact]
    public void PostcodesAreUpperCasedAndTidiedButNotReSpaced()
    {
        var ds = BuildDataSet("Unique Reg Numbers",
            new[] { "3350733393", "Sam", "Jones", "s712GE" },
            new[] { "79229636", "Natalie", "Allott", "  S75   3TB " },
            new[] { "444484171", "Mattia", "Prandini", "34125" });

        var result = RegistrationPoolReader.Read(ds);

        Assert.Equal(new[] { "S712GE", "S75 3TB", "34125" }, result.Entries.Select(e => e.PostCode));
    }

    [Fact]
    public void NumericCellsDoNotBecomeScientificNotation()
    {
        var table = new DataTable("Unique Reg Numbers");
        for (var c = 0; c < 4; c++) table.Columns.Add(null, typeof(object));
        var row = table.NewRow();
        row[0] = 3983092553d; // how ExcelDataReader hands back a numeric cell
        row[3] = "YO225EZ";
        table.Rows.Add(row);
        var ds = new DataSet();
        ds.Tables.Add(table);

        Assert.Equal("3983092553", RegistrationPoolReader.Read(ds).Entries.Single().RegNumber);
    }

    [Fact]
    public void RowsWithoutAUsableRegNumberOrPostcodeAreSkippedAndCounted_BlankRowsAreNot()
    {
        var ds = BuildDataSet("Unique Reg Numbers",
            new[] { "37816617", "A", "B", "S702LD" },
            new[] { "TBC", "C", "D", "S75 3TB" },   // not a reg number
            new[] { "79229636", "E", "F", "" },     // no postcode
            new[] { "", "", "", "" });              // blank

        var result = RegistrationPoolReader.Read(ds);

        Assert.Single(result.Entries);
        Assert.Equal(2, result.SkippedRows);
    }

    [Fact]
    public void AWorkbookWithoutTheSheetIsRefusedWithAHelpfulMessage()
    {
        var ds = BuildDataSet("2026", new[] { "37816617", "A", "B", "S702LD" });

        var ex = Assert.Throws<InvalidOperationException>(() => RegistrationPoolReader.Read(ds));
        Assert.Contains("Unique Reg Numbers", ex.Message);
        Assert.Contains("2026", ex.Message);
    }

    [Fact]
    public void ASheetWithNothingUsableIsRefused()
    {
        var ds = BuildDataSet("Unique Reg Numbers", new[] { "TBC", "A", "B", "" });

        Assert.Throws<InvalidOperationException>(() => RegistrationPoolReader.Read(ds));
    }
}

public class RegistrationPoolTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 4, 9, 0, 0, TimeSpan.Zero);

    // The default hold is 15 minutes, so these sit either side of it.
    private static readonly TimeSpan StillHeld = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan Lapsed = TimeSpan.FromMinutes(16);

    private static RegistrationPool PoolOf(params string[] regs) =>
        new(regs.Select(r => new PoolEntry(r, "PC" + r)));

    private static PoolEntry Entry(RegistrationPool pool, string reg) =>
        pool.Entries.Single(e => e.RegNumber == reg);

    // ---- opening the tab holds the first available pair --------------------------

    [Fact]
    public void OpeningHoldsTheFirstAvailableEntryForTheUser()
    {
        var pool = PoolOf("1", "2", "3");

        var shown = pool.Open("alice", Now);

        Assert.Equal("1", shown!.RegNumber);
        Assert.Equal("alice", Entry(pool, "1").HeldBy);
        Assert.False(Entry(pool, "1").IsAllocated); // held is not taken
        Assert.Equal(3, pool.Remaining);
    }

    [Fact]
    public void OpeningAgainKeepsTheSameEntryAndRenewsTheHold()
    {
        var pool = PoolOf("1", "2");
        pool.Open("alice", Now);

        var again = pool.Open("alice", Now + StillHeld);

        Assert.Equal("1", again!.RegNumber);
        Assert.Equal(Now + StillHeld, Entry(pool, "1").HeldAt);
    }

    [Fact]
    public void AHeldEntryIsNotShownToAnotherUser()
    {
        var pool = PoolOf("1", "2");
        pool.Open("alice", Now);

        Assert.Equal("2", pool.Open("bob", Now.AddMinutes(1))!.RegNumber);
    }

    [Fact]
    public void AHoldThatHasLapsedIsOfferedAgain()
    {
        var pool = PoolOf("1", "2");
        pool.Open("alice", Now);

        Assert.Equal("1", pool.Open("bob", Now + Lapsed)!.RegNumber);
    }

    [Fact]
    public void WhoseHoldLapsedGetsTheFirstAvailableOneNextTime_NotSomethingNowHeldByAnother()
    {
        var pool = PoolOf("1", "2");
        pool.Open("alice", Now);
        pool.Open("bob", Now + Lapsed); // bob is now shown 1

        Assert.Equal("2", pool.Open("alice", Now + Lapsed.Add(TimeSpan.FromMinutes(1)))!.RegNumber);
    }

    [Fact]
    public void TheHoldLengthIsConfigurable()
    {
        var pool = new RegistrationPool(new[] { new PoolEntry("1", "PC1") }, holdFor: TimeSpan.FromMinutes(1));
        pool.Open("alice", Now);

        Assert.Null(pool.Open("bob", Now.AddSeconds(30)));
        Assert.Equal("1", pool.Open("bob", Now.AddMinutes(2))!.RegNumber);
    }

    // ---- copying takes it for good -------------------------------------------------

    [Fact]
    public void CopyingTakesTheHeldEntryForGood()
    {
        var pool = PoolOf("1", "2", "3");
        pool.Open("alice", Now);

        var (outcome, entry) = pool.Claim("1", "alice", Now.AddMinutes(1));

        Assert.Equal(ClaimOutcome.Claimed, outcome);
        Assert.Equal("alice", entry!.AllocatedTo);
        Assert.Null(entry.HeldBy);
        Assert.Equal(2, pool.Remaining);
    }

    [Fact]
    public void ATakenEntryIsNeverShownToAnyoneElse_NoMatterHowLongAgo()
    {
        var pool = PoolOf("1", "2", "3");
        pool.Open("alice", Now);
        pool.Claim("1", "alice", Now);

        var muchLater = Now.AddDays(30);
        Assert.Equal("2", pool.Open("bob", muchLater)!.RegNumber);          // bob holds 2
        Assert.Equal("3", pool.Next(null, "carol", muchLater)!.RegNumber);  // 1 is taken, 2 is bob's
    }

    [Fact]
    public void ATakenEntryCannotBeTakenByAnotherUser()
    {
        var pool = PoolOf("1", "2");
        pool.Claim("1", "alice", Now);

        var (outcome, entry) = pool.Claim("1", "bob", Now);

        Assert.Equal(ClaimOutcome.TakenByOther, outcome);
        Assert.Equal("alice", entry!.AllocatedTo);
    }

    [Fact]
    public void CopyingAfterTheUsersOwnHoldLapsedStillWorksIfNobodyElseWasShownIt()
    {
        var pool = PoolOf("1", "2");
        pool.Open("alice", Now);

        Assert.Equal(ClaimOutcome.Claimed, pool.Claim("1", "alice", Now + Lapsed + Lapsed).Outcome);
    }

    [Fact]
    public void CopyingIsRefusedIfTheHoldLapsedAndSomeoneElseWasShownTheEntrySince()
    {
        var pool = PoolOf("1", "2");
        pool.Open("alice", Now);
        pool.Open("bob", Now + Lapsed); // bob now holds 1

        var (outcome, entry) = pool.Claim("1", "alice", Now + Lapsed.Add(TimeSpan.FromMinutes(1)));

        Assert.Equal(ClaimOutcome.TakenByOther, outcome);
        Assert.Null(entry!.AllocatedTo);
        Assert.Equal("bob", entry.HeldBy); // and bob's hold is untouched
    }

    [Fact]
    public void TheSameUserCopyingTwiceIsHarmlessAndKeepsTheOriginalTime()
    {
        // Copying the postcode after the registration number takes the same pair again.
        var pool = PoolOf("1");
        pool.Claim("1", "alice", Now);

        var (outcome, entry) = pool.Claim("1", "alice", Now.AddMinutes(5));

        Assert.Equal(ClaimOutcome.AlreadyYours, outcome);
        Assert.Equal(Now, entry!.AllocatedAt);
        Assert.Equal(0, pool.Remaining);
    }

    [Fact]
    public void ClaimingSomethingNotInThePoolSaysSo()
    {
        Assert.Equal(ClaimOutcome.NotFound, PoolOf("1").Claim("99", "alice", Now).Outcome);
    }

    // ---- Next ----------------------------------------------------------------------

    [Fact]
    public void NextReleasesTheHeldEntryAndHoldsTheFollowingOne()
    {
        var pool = PoolOf("1", "2", "3");
        pool.Open("alice", Now);

        var shown = pool.Next("1", "alice", Now.AddMinutes(1));

        Assert.Equal("2", shown!.RegNumber);
        Assert.Null(Entry(pool, "1").HeldBy);          // back in the pool
        Assert.Equal("alice", Entry(pool, "2").HeldBy);
        Assert.Equal("1", pool.Open("bob", Now.AddMinutes(2))!.RegNumber); // and bob can have it
    }

    [Fact]
    public void ANextPressedWithoutCopyingNeverTakesAnything()
    {
        var pool = PoolOf("1", "2", "3");
        pool.Open("alice", Now);
        pool.Next("1", "alice", Now);
        pool.Next("2", "alice", Now);

        Assert.Equal(3, pool.Remaining);
        Assert.All(pool.Entries, e => Assert.False(e.IsAllocated));
    }

    [Fact]
    public void NextSkipsTakenEntriesAndEntriesHeldByOthers()
    {
        var pool = PoolOf("1", "2", "3", "4", "5");
        pool.Open("alice", Now);                 // alice holds 1
        pool.Open("bob", Now);                   // bob holds 2
        pool.Claim("3", "carol", Now);           // carol took 3

        Assert.Equal("4", pool.Next("1", "alice", Now)!.RegNumber);
    }

    [Fact]
    public void NextWrapsRoundToAnEntryThatWasSkipped()
    {
        var pool = PoolOf("1", "2", "3");
        pool.Claim("3", "bob", Now);
        pool.Open("alice", Now);                 // 1
        pool.Next("1", "alice", Now);            // 2

        Assert.Equal("1", pool.Next("2", "alice", Now)!.RegNumber);
    }

    [Fact]
    public void AUserHoldsOnlyOneEntryAtATime()
    {
        var pool = PoolOf("1", "2", "3");
        pool.Open("alice", Now);
        pool.Next("1", "alice", Now);
        pool.Next("2", "alice", Now);

        Assert.Single(pool.Entries.Where(e => e.HeldBy == "alice"));
    }

    [Fact]
    public void NextAfterCopyingKeepsWhatWasTakenAndHoldsANewOne()
    {
        var pool = PoolOf("1", "2");
        pool.Open("alice", Now);
        pool.Claim("1", "alice", Now);

        var shown = pool.Next("1", "alice", Now);

        Assert.Equal("2", shown!.RegNumber);
        Assert.Equal("alice", Entry(pool, "1").AllocatedTo); // still hers for good
        Assert.Equal("alice", Entry(pool, "2").HeldBy);
    }

    [Fact]
    public void NextChangesNothingWhenNothingIsAvailable()
    {
        var pool = PoolOf("1");
        pool.Claim("1", "bob", Now);
        var before = pool.Entries.ToList();

        Assert.Null(pool.Next(null, "alice", Now));
        Assert.Equal(before, pool.Entries);
    }

    // ---- running out ----------------------------------------------------------------

    [Fact]
    public void WhenEverythingIsTakenNothingIsOfferedAndAllAllocatedIsTrue()
    {
        var pool = PoolOf("1", "2");
        pool.Claim("1", "alice", Now);
        pool.Claim("2", "bob", Now);

        Assert.Null(pool.Open("carol", Now));
        Assert.Null(pool.Next(null, "carol", Now));
        Assert.True(pool.AllAllocated);
        Assert.Equal(0, pool.Remaining);
    }

    [Fact]
    public void WhatIsLeftBeingHeldByOthersIsNotReportedAsAllAllocated()
    {
        var pool = PoolOf("1");
        pool.Open("alice", Now);

        Assert.Null(pool.Open("bob", Now.AddMinutes(1)));
        Assert.False(pool.AllAllocated);
        Assert.Equal(1, pool.Remaining);
    }

    [Fact]
    public void AnEmptyPoolIsNotReportedAsAllAllocated()
    {
        var pool = new RegistrationPool();

        Assert.False(pool.AllAllocated);
        Assert.Null(pool.Open("alice", Now));
        Assert.Null(pool.Next(null, "alice", Now));
    }

    // ---- reloading and persistence --------------------------------------------------

    [Fact]
    public void ReplaceKeepsTakingsAndHoldsAddsNewEntriesAndFollowsTheNewOrder()
    {
        var pool = PoolOf("1", "2", "3");
        pool.Claim("2", "alice", Now);
        pool.Open("bob", Now); // bob holds 1

        var result = pool.Replace(
            new[] { new PoolRegistration("3", "PC3"), new PoolRegistration("2", "PC2"), new PoolRegistration("1", "PC1"), new PoolRegistration("4", "PC4") },
            "next.xlsx", Now.AddDays(1));

        Assert.Equal(new[] { "3", "2", "1", "4" }, pool.Entries.Select(e => e.RegNumber));
        Assert.Equal("alice", Entry(pool, "2").AllocatedTo);
        Assert.Equal("bob", Entry(pool, "1").HeldBy);
        Assert.Equal(1, result.Added);
        Assert.Equal(1, result.StillAllocated);
        Assert.Equal(0, result.DroppedAllocated);
        Assert.Equal("next.xlsx", pool.Source);
    }

    [Fact]
    public void ReplaceReportsATakenEntryThatHasLeftTheSheet()
    {
        var pool = PoolOf("1", "2");
        pool.Claim("1", "alice", Now);

        var result = pool.Replace(new[] { new PoolRegistration("2", "PC2") }, "next.xlsx", Now);

        Assert.Equal(1, result.DroppedAllocated);
        Assert.Equal(1, pool.Total);
    }

    [Fact]
    public void HoldsAndTakingsSurviveBeingSerialisedAndReadBack()
    {
        var pool = PoolOf("1", "2", "3");
        pool.Claim("1", "alice", Now);
        pool.Open("bob", Now);

        var options = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);
        var json = System.Text.Json.JsonSerializer.Serialize(pool.Entries.ToList(), options);
        var back = System.Text.Json.JsonSerializer.Deserialize<List<PoolEntry>>(json, options)!;

        Assert.Equal(pool.Entries, back);
        Assert.DoesNotContain("isAllocated", json);
    }
}

// People already in a group on a sale sheet are booked through that group, so
// they are left out of the Registrations pool (2026-10-04).
public class RegistrationPoolGroupExclusionTests
{
    private static PoolLoadResult Loaded(params string[] regs) =>
        new("Unique Reg Numbers", regs.Select(r => new PoolRegistration(r, "S1 1AA")).ToList(), 0, 0);

    private static DataTable SaleSheet(params string[][] rows)
    {
        var table = new DataTable("TestSale");
        for (var c = 0; c < 3; c++) table.Columns.Add();
        foreach (var r in new[] { new[] { "Group", "Reg Number", "Postcode" } }.Concat(rows))
        {
            var row = table.NewRow();
            for (var c = 0; c < r.Length; c++) row[c] = r[c];
            table.Rows.Add(row);
        }
        return table;
    }

    [Fact]
    public void SaleSheetRegNumbersAreEveryoneBelowTheHeader()
    {
        var sheet = SaleSheet(
            new[] { "A", "11111111", "S1 1AA" },
            new[] { "A", "22222222", "S1 1AB" },
            new[] { "", "", "" },
            new[] { "B", "33333333", "S1 1AC" });

        var regs = SheetRegistrationReader.ReadRegNumbers(sheet);

        Assert.Equal(new[] { "11111111", "22222222", "33333333" }, regs.OrderBy(r => r));
    }

    [Fact]
    public void SheetWithNoHeaderGivesNobody()
    {
        var table = new DataTable("Notes");
        table.Columns.Add();
        table.Rows.Add(table.NewRow());

        Assert.Empty(SheetRegistrationReader.ReadRegNumbers(table));
    }

    [Fact]
    public void GroupMembersAreRemovedAndCounted()
    {
        var result = RegistrationPoolReader.ExcludeGroupMembers(
            Loaded("11111111", "22222222", "33333333"),
            new HashSet<string> { "22222222", "99999999" });

        Assert.Equal(new[] { "11111111", "33333333" }, result.Entries.Select(e => e.RegNumber));
        Assert.Equal(1, result.InGroupsRows);
    }

    [Fact]
    public void ExclusionsAccumulateAcrossCalls()
    {
        var once = RegistrationPoolReader.ExcludeGroupMembers(Loaded("1", "2", "3", "4"), new HashSet<string> { "1" });
        var twice = RegistrationPoolReader.ExcludeGroupMembers(once, new HashSet<string> { "2" });

        Assert.Equal(new[] { "3", "4" }, twice.Entries.Select(e => e.RegNumber));
        Assert.Equal(2, twice.InGroupsRows);
    }

    [Fact]
    public void NothingInAGroupLeavesThePoolAlone()
    {
        var loaded = Loaded("11111111", "22222222");

        Assert.Same(loaded, RegistrationPoolReader.ExcludeGroupMembers(loaded, new HashSet<string>()));
        Assert.Same(loaded, RegistrationPoolReader.ExcludeGroupMembers(loaded, new HashSet<string> { "99999999" }));
    }

    [Fact]
    public void ThrowsAFriendlyErrorWhenEveryoneIsInAGroup()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            RegistrationPoolReader.ExcludeGroupMembers(Loaded("11111111"), new HashSet<string> { "11111111" }));

        Assert.Contains("already in a group", ex.Message);
    }
}
