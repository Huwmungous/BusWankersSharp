using System.Data;
using Autofills.Common;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Xunit;


namespace Common.Tests;

// Lead Booker (2026-09-18): each group's "Lead Booker" is whoever's First or
// Last name cell is coloured red on the spreadsheet - see the doc comments
// on SheetRegistrationReader.ReadGroups/BuildGroup and
// ExcelFileHelper.DetectLeadBookerRows for the full design. Two layers of
// tests here:
//
//  - SheetRegistrationReaderTests exercise the reordering/warning logic
//    directly against a plain DataTable, with an explicit set of "red" row
//    indices - no real spreadsheet involved, so these are fast and pin down
//    the actual group-building rules precisely.
//  - ColourDetectionTests build a real, minimal .xlsx in memory with the
//    OpenXML SDK (styled fonts, cell references, the lot) and check that
//    DetectLeadBookerRows/ReadSheetGroups can actually find a red cell in
//    it - this is the fiddly, easy-to-get-subtly-wrong part (StyleIndex ->
//    CellFormat -> FontId -> Font -> Color.Rgb, and aligning OpenXML's
//    1-based row numbers with ExcelDataReader's 0-based DataTable rows).
public class SheetRegistrationReaderTests
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

    [Fact]
    public void RedMarkedMemberMovesToFirstPosition()
    {
        var sheet = BuildSheet(
            new[] { "Group", "Reg Number", "Postcode" },
            new[] { "A", "1001", "AB1 2CD" },
            new[] { "A", "1002", "AB1 2CD" }, // DataTable row 2 - the Lead Booker
            new[] { "A", "1003", "AB1 2CD" });

        var (groups, warnings) = SheetRegistrationReader.ReadGroups(sheet, 6, new HashSet<int> { 2 });

        var group = Assert.Single(groups);
        Assert.Equal(new[] { "1002", "1001", "1003" }, group.Members.Select(m => m.RegistrationId));
        Assert.Empty(warnings);
    }

    [Fact]
    public void NoRedMemberKeepsSpreadsheetOrderAndWarnsPerGroup()
    {
        var sheet = BuildSheet(
            new[] { "Group", "Reg Number", "Postcode" },
            new[] { "A", "2001", "AB1 2CD" },
            new[] { "A", "2002", "AB1 2CD" });

        var (groups, warnings) = SheetRegistrationReader.ReadGroups(sheet, 6, new HashSet<int>());

        var group = Assert.Single(groups);
        Assert.Equal(new[] { "2001", "2002" }, group.Members.Select(m => m.RegistrationId));
        var warning = Assert.Single(warnings);
        Assert.Contains("Group A", warning);
        Assert.Contains("2001", warning); // first-listed, used as the fallback lead
    }

    [Fact]
    public void TwoRedMembersUsesFirstFoundInSheetOrderAndWarns()
    {
        var sheet = BuildSheet(
            new[] { "Group", "Reg Number", "Postcode" },
            new[] { "A", "3001", "AB1 2CD" }, // row 1 - marked
            new[] { "A", "3002", "AB1 2CD" }, // row 2 - also marked
            new[] { "A", "3003", "AB1 2CD" });

        var (groups, warnings) = SheetRegistrationReader.ReadGroups(sheet, 6, new HashSet<int> { 1, 2 });

        var group = Assert.Single(groups);
        Assert.Equal(new[] { "3001", "3002", "3003" }, group.Members.Select(m => m.RegistrationId));
        var warning = Assert.Single(warnings);
        Assert.Contains("more than one", warning);
        Assert.Contains("3001", warning);
        Assert.Contains("3002", warning);
    }

    [Fact]
    public void NullLeadBookerRowsMeansDetectionWasNotAttempted()
    {
        // null (as opposed to an empty set) is what ExcelFileHelper passes
        // for a .xls upload - colour can't be read at all, so this should be
        // reported ONCE for the whole sheet, not once per group, and every
        // group keeps exactly the order it was read in.
        var sheet = BuildSheet(
            new[] { "Group", "Reg Number", "Postcode" },
            new[] { "A", "4001", "AB1 2CD" },
            new[] { "A", "4002", "AB1 2CD" },
            new[] { "B", "4003", "AB1 2CD" },
            new[] { "B", "4004", "AB1 2CD" });

        var (groups, warnings) = SheetRegistrationReader.ReadGroups(sheet, 6, null);

        Assert.Equal(2, groups.Count);
        Assert.Equal(new[] { "4001", "4002" }, groups[0].Members.Select(m => m.RegistrationId));
        Assert.Equal(new[] { "4003", "4004" }, groups[1].Members.Select(m => m.RegistrationId));
        var warning = Assert.Single(warnings);
        Assert.Contains(".xlsx", warning);
    }
}

public class ColourDetectionTests
{
    // A minimal, real .xlsx: one sheet named sheetName, header row Group /
    // Reg Number / Postcode / First / Last (matching Hugh's actual
    // spreadsheets), then one data row per (groupLabel, regId, isRed) -
    // isRed colours that row's "First" cell red (FF0000).
    private static MemoryStream BuildWorkbook(string sheetName, params (string GroupLabel, string RegId, bool IsRed)[] rows)
    {
        var stream = new MemoryStream();
        using (var doc = SpreadsheetDocument.Create(stream, SpreadsheetDocumentType.Workbook, true))
        {
            var workbookPart = doc.AddWorkbookPart();
            workbookPart.Workbook = new Workbook();

            var stylesPart = workbookPart.AddNewPart<WorkbookStylesPart>();
            stylesPart.Stylesheet = new Stylesheet(
                new Fonts(
                    new Font(),                               // index 0: default/automatic
                    new Font(new Color { Rgb = "FFFF0000" })) // index 1: red
                { Count = 2 },
                new Fills(new Fill(new PatternFill { PatternType = PatternValues.None })) { Count = 1 },
                new Borders(new Border()) { Count = 1 },
                new CellFormats(
                    new CellFormat { FontId = 0, FillId = 0, BorderId = 0 },  // index 0: default
                    new CellFormat { FontId = 1, FillId = 0, BorderId = 0 }) // index 1: red font
                { Count = 2 });
            stylesPart.Stylesheet.Save();

            var worksheetPart = workbookPart.AddNewPart<WorksheetPart>();
            var sheetData = new SheetData();
            worksheetPart.Worksheet = new Worksheet(sheetData);

            var sheets = workbookPart.Workbook.AppendChild(new Sheets());
            sheets.Append(new Sheet
            {
                Id = workbookPart.GetIdOfPart(worksheetPart),
                SheetId = 1,
                Name = sheetName,
            });

            uint rowIndex = 1;
            var header = new Row { RowIndex = rowIndex };
            header.Append(
                TextCell("A", rowIndex, "Group"),
                TextCell("B", rowIndex, "Reg Number"),
                TextCell("C", rowIndex, "Postcode"),
                TextCell("D", rowIndex, "First"),
                TextCell("E", rowIndex, "Last"));
            sheetData.Append(header);

            foreach (var (groupLabel, regId, isRed) in rows)
            {
                rowIndex++;
                var row = new Row { RowIndex = rowIndex };
                row.Append(
                    TextCell("A", rowIndex, groupLabel),
                    TextCell("B", rowIndex, regId),
                    TextCell("C", rowIndex, "AB1 2CD"),
                    TextCell("D", rowIndex, "First" + regId, isRed ? 1u : 0u),
                    TextCell("E", rowIndex, "Last" + regId));
                sheetData.Append(row);
            }

            workbookPart.Workbook.Save();
        }

        stream.Position = 0;
        return stream;
    }

    private static Cell TextCell(string column, uint rowIndex, string text, uint styleIndex = 0) =>
        new()
        {
            CellReference = $"{column}{rowIndex}",
            DataType = CellValues.InlineString,
            StyleIndex = styleIndex,
            InlineString = new InlineString(new Text(text)),
        };

    [Fact]
    public void DetectLeadBookerRows_FindsTheRedFirstNameCell()
    {
        using var stream = BuildWorkbook("TestSale",
            ("A", "1001", false),
            ("A", "1002", true),
            ("A", "1003", false));

        var rows = ExcelFileHelper.DetectLeadBookerRows(stream, "test.xlsx", "TestSale");

        Assert.NotNull(rows);
        Assert.Equal(new HashSet<int> { 2 }, rows); // header is DataTable row 0, "1002" is row 2
    }

    [Fact]
    public void DetectLeadBookerRows_ReturnsNullForNonXlsxFileNames()
    {
        // The extension check happens before anything tries to parse the
        // stream as an OOXML package, so garbage bytes are fine here.
        using var stream = new MemoryStream(new byte[] { 1, 2, 3 });

        var rows = ExcelFileHelper.DetectLeadBookerRows(stream, "test.xls", "TestSale");

        Assert.Null(rows);
    }

    [Fact]
    public void ReadSheetGroups_EndToEnd_PutsTheRedMarkedMemberFirst()
    {
        // Exercises the real pipeline: ExcelDataReader reads the values,
        // DetectLeadBookerRows independently reads the colours, and the two
        // 0-based row indices have to line up for this to work.
        using var stream = BuildWorkbook("TestSale",
            ("A", "5001", false),
            ("A", "5002", true),
            ("A", "5003", false));

        var (groups, warnings) = ExcelFileHelper.ReadSheetGroups(stream, "test.xlsx", "TestSale", 6);

        var group = Assert.Single(groups);
        Assert.Equal(new[] { "5002", "5001", "5003" }, group.Members.Select(m => m.RegistrationId));
        Assert.Empty(warnings);
    }
}
