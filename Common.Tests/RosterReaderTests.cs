using System.Data;
using Autofills.Common;
using Xunit;

namespace Common.Tests;

// Postcodes on the Running Order tab (2026-09-18): the master roster
// ("Glasto nnnn") sheet carries a "Postcode" column in Hugh's real
// spreadsheets, same as the sale sheets, but RosterReader previously
// ignored it. These tests pin down that it's read when present, and that
// an older-shaped roster sheet with no "Postcode" column still reads fine
// (everyone just gets PostCode == "").
public class RosterReaderTests
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
        table.TableName = "Glasto 2027";
        return table;
    }

    private static DataSet BuildDataSet(DataTable sheet)
    {
        var ds = new DataSet();
        ds.Tables.Add(sheet);
        return ds;
    }

    [Fact]
    public void PostcodeColumnIsReadWhenPresent()
    {
        var sheet = BuildSheet(
            new[] { "Reg Number", "First", "Last", "Postcode" },
            new[] { "1001", "Emma", "Corden", "AB1 2CD" },
            new[] { "1002", "Sam", "Reeve", "EF3 4GH" });

        var roster = RosterReader.Read(BuildDataSet(sheet));

        Assert.NotNull(roster);
        Assert.Equal(2027, roster!.Year);
        Assert.Equal(new[] { "AB1 2CD", "EF3 4GH" }, roster.Entries.Select(e => e.PostCode));
    }

    [Fact]
    public void PostcodeHeadingIsCaseInsensitive()
    {
        var sheet = BuildSheet(
            new[] { "Reg Number", "First", "Last", "POSTCODE" },
            new[] { "1001", "Emma", "Corden", "AB1 2CD" });

        var roster = RosterReader.Read(BuildDataSet(sheet));

        Assert.NotNull(roster);
        Assert.Equal("AB1 2CD", roster!.Entries.Single().PostCode);
    }

    [Fact]
    public void MissingPostcodeColumnLeavesEveryoneBlankNotAnError()
    {
        // The older roster shape - no Postcode column at all. Reading still
        // succeeds; every entry just has an empty PostCode.
        var sheet = BuildSheet(
            new[] { "Reg Number", "First", "Last" },
            new[] { "1001", "Emma", "Corden" },
            new[] { "1002", "Sam", "Reeve" });

        var roster = RosterReader.Read(BuildDataSet(sheet));

        Assert.NotNull(roster);
        Assert.All(roster!.Entries, e => Assert.Equal("", e.PostCode));
    }

    [Fact]
    public void BlankPostcodeCellReadsAsEmptyString()
    {
        var sheet = BuildSheet(
            new[] { "Reg Number", "First", "Last", "Postcode" },
            new[] { "1001", "Emma", "Corden", "" });

        var roster = RosterReader.Read(BuildDataSet(sheet));

        Assert.NotNull(roster);
        Assert.Equal("", roster!.Entries.Single().PostCode);
    }
}
