using Autofills.Common;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Xunit;


namespace Common.Tests;

// "Scratchpad" (2026-09-18): Hugh's workbook gained a new tab he uses for his
// own notes while building it - never a sale, never the roster. ExcelFileHelper
// treats ANY sheet name starting with "Scratchpad" (case-insensitive) as one of
// these, alongside the exact-matched "Starting Lineup" and "URL", so
// ListSaleSheets skips it outright, even in the (deliberately tested here)
// worst case where it happens to have a sale-shaped header row too. The prefix
// match (rather than an exact one) is deliberate: it started as an exact match
// and missed "ScratchPad1"/"ScratchPad2" once the workbook grew more than one
// (2026-09-23) - see NumberedScratchpadSheetsAreNeverListedAsASale below.
public class ExcelFileHelperTests
{
    // A minimal, real, multi-sheet .xlsx: one sheet per (name, headerRow) -
    // no styling needed, ListSaleSheets only looks at names/values.
    private static MemoryStream BuildWorkbook(params (string Name, string[] HeaderRow)[] sheets)
    {
        var stream = new MemoryStream();
        using (var doc = SpreadsheetDocument.Create(stream, SpreadsheetDocumentType.Workbook, true))
        {
            var workbookPart = doc.AddWorkbookPart();
            workbookPart.Workbook = new Workbook();
            var sheetsElement = workbookPart.Workbook.AppendChild(new Sheets());

            uint sheetId = 1;
            foreach (var (name, headerRow) in sheets)
            {
                var worksheetPart = workbookPart.AddNewPart<WorksheetPart>();
                var sheetData = new SheetData();
                worksheetPart.Worksheet = new Worksheet(sheetData);

                var row = new Row { RowIndex = 1 };
                for (var c = 0; c < headerRow.Length; c++)
                {
                    var column = ((char)('A' + c)).ToString();
                    row.Append(new Cell
                    {
                        CellReference = $"{column}1",
                        DataType = CellValues.InlineString,
                        InlineString = new InlineString(new Text(headerRow[c])),
                    });
                }
                sheetData.Append(row);

                sheetsElement.Append(new Sheet
                {
                    Id = workbookPart.GetIdOfPart(worksheetPart),
                    SheetId = sheetId++,
                    Name = name,
                });
            }

            workbookPart.Workbook.Save();
        }

        stream.Position = 0;
        return stream;
    }

    [Fact]
    public void ScratchpadSheetIsNeverListedAsASale()
    {
        using var stream = BuildWorkbook(
            ("TestSale", new[] { "Group", "Reg Number", "Postcode" }),
            // Deliberately given the SAME shape as a sale header, to prove
            // it's excluded by name rather than by accident having no header.
            ("Scratchpad", new[] { "Group", "Reg Number", "Postcode" }));

        var sales = ExcelFileHelper.ListSaleSheets(stream, "test.xlsx");

        Assert.Equal(new[] { "TestSale" }, sales);
    }

    [Fact]
    public void ScratchpadSheetNameIsCaseInsensitiveAndTrimmed()
    {
        using var stream = BuildWorkbook(
            ("TestSale", new[] { "Group", "Reg Number", "Postcode" }),
            (" scratchpad ", new[] { "Group", "Reg Number", "Postcode" }));

        var sales = ExcelFileHelper.ListSaleSheets(stream, "test.xlsx");

        Assert.Equal(new[] { "TestSale" }, sales);
    }

    // 2026-09-23: the 2027 workbook grew TWO scratchpad tabs, "ScratchPad1" and
    // "ScratchPad2" - neither matched the old exact-name "Scratchpad" check, so
    // ScratchPad1 (which happens to carry Hugh's own grouping notes under a
    // sale-shaped Group/Reg Number/Postcode header) was being silently ingested
    // as a real sale on every upload. Covers any future "ScratchPadN" too.
    [Fact]
    public void NumberedScratchpadSheetsAreNeverListedAsASale()
    {
        using var stream = BuildWorkbook(
            ("TestSale", new[] { "Group", "Reg Number", "Postcode" }),
            ("ScratchPad1", new[] { "Group", "Reg Number", "Postcode" }),
            ("ScratchPad2", new[] { "Column1", "Column2" }));

        var sales = ExcelFileHelper.ListSaleSheets(stream, "test.xlsx");

        Assert.Equal(new[] { "TestSale" }, sales);
    }
}
