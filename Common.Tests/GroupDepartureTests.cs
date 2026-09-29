using System.Data;
using Autofills.Common;
using Xunit;

namespace Common.Tests;

// Departure (2026-09-29): the Coach sheet's "Depart" column is repeated on every
// member's row but belongs to the GROUP - see RegistrationGroup.Departure and
// SheetRegistrationReader.ResolveDeparture. These pin down the once-per-group
// resolution: agreement, blanks, disagreement, ties, casing, header spellings,
// sheets with no such column, and that the Lead Booker reordering leaves it alone.
public class GroupDepartureTests
{
    private static DataTable BuildSheet(params string[][] rows)
    {
        var table = new DataTable();
        var maxCols = rows.Max(r => r.Length);
        for (var c = 0; c < maxCols; c++) table.Columns.Add();
        foreach (var r in rows)
        {
            var row = table.NewRow();
            for (var c = 0; c < r.Length; c++) row[c] = r[c];
            table.Rows.Add(row);
        }
        return table;
    }

    // Warnings about departure only - the reader also warns about Lead Bookers
    // and .xls colour detection, which these tests aren't about.
    private static List<string> DepartureWarnings(IEnumerable<string> warnings) =>
        warnings.Where(w => w.Contains("departure", StringComparison.OrdinalIgnoreCase)).ToList();

    [Fact]
    public void AgreeingValuesBecomeTheGroupsDeparture()
    {
        var sheet = BuildSheet(
            new[] { "Group", "Reg Number", "Postcode", "Depart" },
            new[] { "A", "1001", "AB1 2CD", "Sheffield" },
            new[] { "A", "1002", "AB1 2CD", "Sheffield" },
            new[] { "A", "1003", "AB1 2CD", "Sheffield" });

        var (groups, warnings) = SheetRegistrationReader.ReadGroups(sheet, 6, null);

        var group = Assert.Single(groups);
        Assert.Equal("Sheffield", group.Departure);
        Assert.Empty(DepartureWarnings(warnings));
    }

    [Fact]
    public void BlankCellsAreIgnored()
    {
        var sheet = BuildSheet(
            new[] { "Group", "Reg Number", "Postcode", "Depart" },
            new[] { "A", "1001", "AB1 2CD", "" },
            new[] { "A", "1002", "AB1 2CD", "Sheffield" },
            new[] { "A", "1003", "AB1 2CD", "  " });

        var (groups, warnings) = SheetRegistrationReader.ReadGroups(sheet, 6, null);

        Assert.Equal("Sheffield", Assert.Single(groups).Departure);
        Assert.Empty(DepartureWarnings(warnings));
    }

    [Fact]
    public void DisagreeingValuesUseTheMostCommonAndWarn()
    {
        var sheet = BuildSheet(
            new[] { "Group", "Reg Number", "Postcode", "Depart" },
            new[] { "A", "1001", "AB1 2CD", "Leeds" },
            new[] { "A", "1002", "AB1 2CD", "Sheffield" },
            new[] { "A", "1003", "AB1 2CD", "Sheffield" });

        var (groups, warnings) = SheetRegistrationReader.ReadGroups(sheet, 6, null);

        Assert.Equal("Sheffield", Assert.Single(groups).Departure);
        var warning = Assert.Single(DepartureWarnings(warnings));
        Assert.Contains("Group A", warning);
        Assert.Contains("Leeds", warning);
        Assert.Contains("Sheffield", warning);
    }

    [Fact]
    public void ATieUsesTheFirstListed()
    {
        var sheet = BuildSheet(
            new[] { "Group", "Reg Number", "Postcode", "Depart" },
            new[] { "A", "1001", "AB1 2CD", "Leeds" },
            new[] { "A", "1002", "AB1 2CD", "Sheffield" });

        var (groups, warnings) = SheetRegistrationReader.ReadGroups(sheet, 6, null);

        Assert.Equal("Leeds", Assert.Single(groups).Departure);
        Assert.Single(DepartureWarnings(warnings));
    }

    [Fact]
    public void DifferentCasingIsTheSameValueAndKeepsTheFirstSpelling()
    {
        var sheet = BuildSheet(
            new[] { "Group", "Reg Number", "Postcode", "Depart" },
            new[] { "A", "1001", "AB1 2CD", "Sheffield" },
            new[] { "A", "1002", "AB1 2CD", "sheffield" });

        var (groups, warnings) = SheetRegistrationReader.ReadGroups(sheet, 6, null);

        Assert.Equal("Sheffield", Assert.Single(groups).Departure);
        Assert.Empty(DepartureWarnings(warnings));
    }

    [Fact]
    public void EachGroupKeepsItsOwnDeparture()
    {
        var sheet = BuildSheet(
            new[] { "Group", "Reg Number", "Postcode", "Depart" },
            new[] { "A", "1001", "AB1 2CD", "Sheffield" },
            new[] { "A", "1002", "AB1 2CD", "Sheffield" },
            new[] { "B", "2001", "EF3 4GH", "Leeds" },
            new[] { "B", "2002", "EF3 4GH", "Leeds" });

        var (groups, _) = SheetRegistrationReader.ReadGroups(sheet, 6, null);

        Assert.Equal(new[] { "Sheffield", "Leeds" }, groups.Select(g => g.Departure));
    }

    [Fact]
    public void ASheetWithNoDepartureColumnLeavesItEmptyWithoutWarning()
    {
        // The General sheets have no "Depart" column.
        var sheet = BuildSheet(
            new[] { "Group", "Reg Number", "Postcode" },
            new[] { "A", "1001", "AB1 2CD" },
            new[] { "A", "1002", "AB1 2CD" });

        var (groups, warnings) = SheetRegistrationReader.ReadGroups(sheet, 6, null);

        Assert.Equal(string.Empty, Assert.Single(groups).Departure);
        Assert.Empty(DepartureWarnings(warnings));
    }

    [Fact]
    public void ADepartureColumnThatIsBlankThroughoutLeavesItEmptyWithoutWarning()
    {
        // A group not yet allocated a departure point is normal, not a mistake.
        var sheet = BuildSheet(
            new[] { "Group", "Reg Number", "Postcode", "Depart" },
            new[] { "A", "1001", "AB1 2CD", "" },
            new[] { "A", "1002", "AB1 2CD", "" });

        var (groups, warnings) = SheetRegistrationReader.ReadGroups(sheet, 6, null);

        Assert.Equal(string.Empty, Assert.Single(groups).Departure);
        Assert.Empty(DepartureWarnings(warnings));
    }

    [Theory]
    [InlineData("Depart")]
    [InlineData("depart")]
    [InlineData("Departs")]
    [InlineData("Departure")]
    [InlineData("Departure Point")]
    [InlineData("Departure Location")]
    public void AcceptedHeaderSpellings(string header)
    {
        var sheet = BuildSheet(
            new[] { "Group", "Reg Number", "Postcode", header },
            new[] { "A", "1001", "AB1 2CD", "Sheffield" });

        var (groups, _) = SheetRegistrationReader.ReadGroups(sheet, 6, null);

        Assert.Equal("Sheffield", Assert.Single(groups).Departure);
    }

    [Fact]
    public void ColumnOrderDoesNotMatter()
    {
        var sheet = BuildSheet(
            new[] { "Depart", "Postcode", "Reg Number", "Group" },
            new[] { "Sheffield", "AB1 2CD", "1001", "A" },
            new[] { "Sheffield", "AB1 2CD", "1002", "A" });

        var (groups, _) = SheetRegistrationReader.ReadGroups(sheet, 6, null);

        var group = Assert.Single(groups);
        Assert.Equal("Sheffield", group.Departure);
        Assert.Equal(new[] { "1001", "1002" }, group.Members.Select(m => m.RegistrationId));
    }

    [Fact]
    public void SlicedGroupsWithNoLettersEachGetTheirDeparture()
    {
        // No group letters at all: groups are sliced top to bottom in fixed sizes.
        var sheet = BuildSheet(
            new[] { "Group", "Reg Number", "Postcode", "Depart" },
            new[] { "", "1001", "AB1 2CD", "Sheffield" },
            new[] { "", "1002", "AB1 2CD", "Sheffield" },
            new[] { "", "1003", "EF3 4GH", "Leeds" },
            new[] { "", "1004", "EF3 4GH", "Leeds" });

        var (groups, _) = SheetRegistrationReader.ReadGroups(sheet, 2, null);

        Assert.Equal(new[] { "Sheffield", "Leeds" }, groups.Select(g => g.Departure));
    }

    [Fact]
    public void LeadBookerReorderingKeepsTheDeparture()
    {
        var sheet = BuildSheet(
            new[] { "Group", "Reg Number", "Postcode", "Depart" },
            new[] { "A", "1001", "AB1 2CD", "Sheffield" },
            new[] { "A", "1002", "AB1 2CD", "Sheffield" }); // DataTable row 2 - the Lead Booker

        var (groups, warnings) = SheetRegistrationReader.ReadGroups(sheet, 6, new HashSet<int> { 2 });

        var group = Assert.Single(groups);
        Assert.Equal(new[] { "1002", "1001" }, group.Members.Select(m => m.RegistrationId));
        Assert.Equal("Sheffield", group.Departure);
        Assert.Empty(warnings);
    }
}
