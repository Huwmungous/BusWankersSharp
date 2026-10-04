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

    private static RegistrationPool PoolOf(params string[] regs) =>
        new(regs.Select(r => new PoolEntry(r, "PC" + r)));

    [Fact]
    public void NextIsTheFirstFreeEntryWhenNothingIsOnScreen()
    {
        var pool = PoolOf("1", "2", "3");

        Assert.Equal("1", pool.Next(null, "alice")!.RegNumber);
    }

    [Fact]
    public void NextMovesOnToTheFollowingFreeEntry_AndSkipsAllocatedOnes()
    {
        var pool = PoolOf("1", "2", "3", "4");
        pool.Claim("2", "bob", Now);

        Assert.Equal("3", pool.Next("1", "alice")!.RegNumber);
    }

    [Fact]
    public void NextWrapsRoundToAnEntryThatWasSkipped()
    {
        var pool = PoolOf("1", "2", "3");
        pool.Claim("3", "bob", Now);

        // Alice looked at 1 and pressed Next (2), then Next again: 3 is gone, so back to 1.
        Assert.Equal("1", pool.Next("2", "alice")!.RegNumber);
    }

    [Fact]
    public void NextDoesNotAllocateAnything()
    {
        var pool = PoolOf("1", "2");

        pool.Next(null, "alice");
        pool.Next("1", "alice");

        Assert.Equal(2, pool.Remaining);
    }

    [Fact]
    public void ClaimGivesTheEntryToTheClaimant()
    {
        var pool = PoolOf("1", "2");

        var (outcome, entry) = pool.Claim("1", "alice", Now);

        Assert.Equal(ClaimOutcome.Claimed, outcome);
        Assert.Equal("alice", entry!.AllocatedTo);
        Assert.Equal(1, pool.Remaining);
    }

    [Fact]
    public void AClaimedEntryCannotBeClaimedByAnotherUser()
    {
        var pool = PoolOf("1", "2");
        pool.Claim("1", "alice", Now);

        var (outcome, entry) = pool.Claim("1", "bob", Now);

        Assert.Equal(ClaimOutcome.TakenByOther, outcome);
        Assert.Equal("alice", entry!.AllocatedTo);
    }

    [Fact]
    public void AClaimedEntryIsNeverOfferedToAnotherUserAgain()
    {
        var pool = PoolOf("1", "2");
        pool.Claim("1", "alice", Now);

        Assert.Equal("2", pool.Next(null, "bob")!.RegNumber);
        Assert.Equal("2", pool.Current("bob")!.RegNumber);
    }

    [Fact]
    public void TheSameUserClaimingTwiceIsHarmlessAndKeepsTheOriginalTime()
    {
        // Copying the postcode after the registration number claims the same pair again.
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

    [Fact]
    public void WhenEverythingIsAllocatedNextIsNullAndAllAllocatedIsTrue()
    {
        var pool = PoolOf("1", "2");
        pool.Claim("1", "alice", Now);
        pool.Claim("2", "bob", Now);

        Assert.Null(pool.Next(null, "carol"));
        Assert.True(pool.AllAllocated);
        Assert.Equal(0, pool.Remaining);
    }

    [Fact]
    public void AnEmptyPoolIsNotReportedAsAllAllocated()
    {
        var pool = new RegistrationPool();

        Assert.False(pool.AllAllocated);
        Assert.Null(pool.Next(null, "alice"));
        Assert.Null(pool.Current("alice"));
    }

    [Fact]
    public void CurrentIsTheUsersOwnLatestClaim_SoAReloadDoesNotLoseThePostcode()
    {
        var pool = PoolOf("1", "2", "3");
        pool.Claim("1", "alice", Now);
        pool.Claim("3", "alice", Now.AddMinutes(1));

        Assert.Equal("3", pool.Current("alice")!.RegNumber);
        // A different user starts from the top of what's free.
        Assert.Equal("2", pool.Current("bob")!.RegNumber);
    }

    [Fact]
    public void ReplaceKeepsAllocationsAddsNewEntriesAndFollowsTheNewOrder()
    {
        var pool = PoolOf("1", "2", "3");
        pool.Claim("2", "alice", Now);

        var result = pool.Replace(
            new[] { new PoolRegistration("3", "PC3"), new PoolRegistration("2", "PC2"), new PoolRegistration("4", "PC4") },
            "next.xlsx", Now.AddDays(1));

        Assert.Equal(new[] { "3", "2", "4" }, pool.Entries.Select(e => e.RegNumber));
        Assert.Equal("alice", pool.Entries.Single(e => e.RegNumber == "2").AllocatedTo);
        Assert.Equal(1, result.Added);
        Assert.Equal(1, result.StillAllocated);
        Assert.Equal(0, result.DroppedAllocated);
        Assert.Equal("next.xlsx", pool.Source);
    }

    [Fact]
    public void ReplaceReportsAnAllocatedEntryThatHasLeftTheSheet()
    {
        var pool = PoolOf("1", "2");
        pool.Claim("1", "alice", Now);

        var result = pool.Replace(new[] { new PoolRegistration("2", "PC2") }, "next.xlsx", Now);

        Assert.Equal(1, result.DroppedAllocated);
        Assert.Equal(1, pool.Total);
    }

    [Fact]
    public void TheSameAllocationCanBeSerialisedAndReadBack()
    {
        var pool = PoolOf("1", "2");
        pool.Claim("1", "alice", Now);

        var json = System.Text.Json.JsonSerializer.Serialize(pool.Entries.ToList(), new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        var back = System.Text.Json.JsonSerializer.Deserialize<List<PoolEntry>>(json, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!;

        Assert.Equal(pool.Entries, back);
        Assert.DoesNotContain("isAllocated", json);
    }
}
