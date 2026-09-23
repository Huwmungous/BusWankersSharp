using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using ExcelDataReader;
using System.Data;
using System.Globalization;
using System.Text;


namespace Autofills.Common
{
    public class ExcelFileHelper
    {
        /// <summary>
        /// Sheets that are never a sale, whatever the workbook contains: the master
        /// roster and the queue-URL tab. Compared trimmed and case-insensitive,
        /// since the real "Starting Lineup" sheet has been seen with a trailing
        /// space in its actual tab name.
        ///
        /// This list is only a fast path - the real test is the header row (see
        /// IsSaleSheet). The 2027 workbook renamed the master roster "Glasto 2027",
        /// which no fixed name list would have caught.
        /// </summary>
        private static readonly HashSet<string> NonSaleSheetNames =
            new(StringComparer.OrdinalIgnoreCase) { "Starting Lineup", "URL" };

        /// <summary>
        /// True for any of Hugh's own scratch/notes tabs - "Scratchpad" (2026-09-18),
        /// and (2026-09-23) "ScratchPad1", "ScratchPad2", etc, once the 2027 workbook
        /// grew more than one of them. Matched by PREFIX rather than the exact-name
        /// set above, so any future "ScratchPadN" is covered without a code change -
        /// an exact match missed "ScratchPad1"/"ScratchPad2" (2026-09-23 bug: they
        /// happen to carry a sale-shaped header - Group/Reg Number/Postcode - from
        /// Hugh's own grouping notes, so ListSaleSheets was silently ingesting them
        /// as if they were a real sale on every upload of that workbook). Trimmed
        /// case-insensitive prefix, same convention as NonSaleSheetNames above.
        /// </summary>
        private static bool IsScratchpadSheetName(string? sheetName) =>
            !string.IsNullOrWhiteSpace(sheetName)
            && sheetName.Trim().StartsWith("Scratchpad", StringComparison.OrdinalIgnoreCase);

        private static bool IsNonSaleSheetName(string? sheetName) =>
            !string.IsNullOrWhiteSpace(sheetName)
            && (NonSaleSheetNames.Contains(sheetName.Trim()) || IsScratchpadSheetName(sheetName));


        /// <summary>
        /// A sale sheet is one whose header row has a "Group" column alongside
        /// "Reg Number" and "Postcode". Every sale tab (Coach, General, Resale -
        /// Coach, Resale - General, Demo) has that shape; the master roster has
        /// "Reg Number" and "Postcode" too but keys on "Going 2027" / "Coach" /
        /// "General" columns instead of "Group", and the URL tab has no header at
        /// all. Deciding by shape rather than name means a new sale tab works
        /// without a code change AND a renamed roster tab doesn't get ingested as
        /// a sale.
        /// </summary>
        private static bool IsSaleSheet(DataTable sheet)
        {
            if (IsNonSaleSheetName(sheet.TableName) || RosterReader.IsRosterSheetName(sheet.TableName))
                return false;

            return SheetRegistrationReader.HasSaleHeader(sheet);
        }

        /// <summary>
        /// Opens an uploaded workbook (from a stream, so it never has to touch disk)
        /// and returns the names of its sale sheets, in workbook order. NB
        /// ExcelDataReader disposes <paramref name="excelStream"/> when the reader
        /// is disposed - callers that need to read the workbook again must open a
        /// fresh stream over the same bytes.
        /// </summary>
        public static List<string> ListSaleSheets(Stream excelStream, string fileName)
        {
            using var reader = OpenReader(excelStream, fileName);
            var ds = ReadDataSet(reader);

            return ds.Tables.Cast<DataTable>()
                .Where(IsSaleSheet)
                .Select(t => t.TableName)
                .ToList();
        }

        /// <summary>
        /// Opens an uploaded workbook and reads the exact-named sheet's registrants
        /// into groups via SheetRegistrationReader. <paramref name="sheetName"/> is
        /// expected to be one of the names ListSaleSheets returned for this same file
        /// (matched trimmed, case-insensitive) - this is an exact match rather than a
        /// substring one deliberately, since a workbook can have more than one sheet
        /// whose name contains another ("Resale - Coach" and "Resale - General" both
        /// contain "Resale"), so only an exact name is unambiguous. Throws
        /// InvalidOperationException with a message safe to show the caller (no
        /// matching sheet, no header row, a group over the size limit, etc).
        ///
        /// Warnings (2026-09-18, Lead Booker feature): non-fatal issues worth
        /// telling the person uploading about, but not worth failing the ingest
        /// over (see SheetRegistrationReader.ReadGroups/BuildGroup) - e.g. a
        /// group with nobody marked red, or a .xls upload where colour can't be
        /// read at all. Always a (possibly empty) list, never null.
        ///
        /// Reads the whole stream into memory once: unlike the other methods on
        /// this class, this one needs TWO independent reads over the same bytes
        /// (ExcelDataReader for values, then DetectLeadBookerRows/OpenXML for
        /// font colour) and ExcelDataReader disposes whatever stream it's given
        /// when the reader itself is disposed - so a single shared stream can't
        /// be rewound for the second pass.
        /// </summary>
        public static (List<RegistrationGroup> Groups, List<string> Warnings) ReadSheetGroups(
            Stream excelStream, string fileName, string sheetName, int maxInAGroup)
        {
            var bytes = ReadAllBytes(excelStream);

            DataTable? sheet;
            using (var reader = OpenReader(new MemoryStream(bytes, writable: false), fileName))
            {
                var ds = ReadDataSet(reader);

                if (IsNonSaleSheetName(sheetName) || RosterReader.IsRosterSheetName(sheetName))
                    throw new InvalidOperationException($"'{sheetName}' isn't a sale sheet.");

                sheet = null;
                foreach (DataTable t in ds.Tables)
                {
                    if (string.Equals(t.TableName.Trim(), sheetName.Trim(), StringComparison.OrdinalIgnoreCase))
                    {
                        sheet = t;
                        break;
                    }
                }

                if (sheet == null)
                {
                    var available = string.Join(", ", ds.Tables.Cast<DataTable>().Select(t => t.TableName));
                    throw new InvalidOperationException(
                        $"No sheet named '{sheetName}' found. Sheets in this file: {available}");
                }
            }

            using var colourStream = new MemoryStream(bytes, writable: false);
            var leadBookerRows = DetectLeadBookerRows(colourStream, fileName, sheetName);

            return SheetRegistrationReader.ReadGroups(sheet, maxInAGroup, leadBookerRows);
        }

        private static byte[] ReadAllBytes(Stream stream)
        {
            using var buffer = new MemoryStream();
            stream.CopyTo(buffer);
            return buffer.ToArray();
        }

        /// <summary>
        /// Which rows of <paramref name="sheetName"/> (indexed the same way as
        /// SheetRegistrationReader.ReadGroups' own loop - i.e. row 0 is the
        /// header, row 1 the first data row) have their "First" or "Last"
        /// column cell in a reddish font: Bus Wankers' own convention (see
        /// SheetRegistrationReader) for marking a group's Lead Booker.
        ///
        /// Returns null when this file type can't carry that information at
        /// all (.xls) or the sheet/columns can't be found - callers treat
        /// that as "colour detection wasn't attempted" (one warning for the
        /// whole sheet) rather than "nobody's marked" (a warning per group).
        /// Returns a (possibly empty) set for a real .xlsx sheet.
        ///
        /// "Reddish" is deliberately a loose heuristic (red channel clearly
        /// dominant), not an exact hex match - real spreadsheets use
        /// anything from Excel's standard Red (FF0000) to a hand-picked
        /// darker red. It only needs to rule out black/automatic text and
        /// other colours (blue highlights used for something else, say).
        /// It only reads a cell's own explicit RGB colour - a font colour
        /// chosen from Excel's "Theme Colors" swatches (rather than
        /// "Standard Colors" or "More Colors...") is stored as a theme
        /// index instead and won't be picked up; if Hugh's reds turn out to
        /// be theme colours rather than explicit ones, this will need a
        /// theme-color lookup added.
        /// </summary>
        public static HashSet<int>? DetectLeadBookerRows(Stream excelStream, string fileName, string sheetName)
        {
            if (!fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase))
                return null;

            using var doc = SpreadsheetDocument.Open(excelStream, false);
            var workbookPart = doc.WorkbookPart;
            if (workbookPart == null)
                return new HashSet<int>();

            var sheetMeta = workbookPart.Workbook.Descendants<Sheet>()
                .FirstOrDefault(s => string.Equals(s.Name?.Value?.Trim(), sheetName.Trim(), StringComparison.OrdinalIgnoreCase));
            if (sheetMeta?.Id?.Value == null)
                return new HashSet<int>();

            if (workbookPart.GetPartById(sheetMeta.Id.Value!) is not WorksheetPart worksheetPart)
                return new HashSet<int>();

            var sheetData = worksheetPart.Worksheet.Elements<SheetData>().FirstOrDefault();
            if (sheetData == null)
                return new HashSet<int>();

            var rows = sheetData.Elements<Row>().ToList();
            if (rows.Count == 0)
                return new HashSet<int>();

            var sharedStrings = workbookPart.SharedStringTablePart?.SharedStringTable;
            var stylesheet = workbookPart.WorkbookStylesPart?.Stylesheet;

            static string ColumnRef(string? cellRef)
            {
                if (string.IsNullOrEmpty(cellRef))
                    return string.Empty;
                return new string(cellRef.TakeWhile(char.IsLetter).ToArray());
            }

            string CellText(Cell? cell)
            {
                if (cell == null)
                    return string.Empty;

                if (cell.DataType?.Value == CellValues.SharedString)
                {
                    var text = cell.CellValue?.InnerText;
                    if (sharedStrings != null && int.TryParse(text, out var idx) && idx >= 0 && idx < sharedStrings.ChildElements.Count)
                        return sharedStrings.ElementAt(idx).InnerText;
                    return string.Empty;
                }

                if (cell.DataType?.Value == CellValues.InlineString)
                    return cell.InlineString?.Text?.Text ?? string.Empty;

                return cell.CellValue?.InnerText ?? string.Empty;
            }

            // Row 0 (the header) tells us which columns are "First"/"Last".
            string? firstCol = null, lastCol = null;
            foreach (var cell in rows[0].Elements<Cell>())
            {
                var text = CellText(cell).Trim();
                if (string.Equals(text, "First", StringComparison.OrdinalIgnoreCase))
                    firstCol = ColumnRef(cell.CellReference?.Value);
                else if (string.Equals(text, "Last", StringComparison.OrdinalIgnoreCase))
                    lastCol = ColumnRef(cell.CellReference?.Value);
            }

            if (firstCol == null && lastCol == null)
                return new HashSet<int>();

            bool IsRedFont(Cell? cell)
            {
                if (cell?.StyleIndex?.Value == null || stylesheet == null)
                    return false;

                var cellFormats = stylesheet.CellFormats;
                var fonts = stylesheet.Fonts;
                if (cellFormats == null || fonts == null)
                    return false;

                var styleIndex = (int)cell.StyleIndex.Value;
                if (styleIndex < 0 || styleIndex >= cellFormats.ChildElements.Count)
                    return false;

                if (cellFormats.ElementAt(styleIndex) is not CellFormat cellFormat || cellFormat.FontId?.Value == null)
                    return false;

                var fontIndex = (int)cellFormat.FontId.Value;
                if (fontIndex < 0 || fontIndex >= fonts.ChildElements.Count)
                    return false;

                if (fonts.ElementAt(fontIndex) is not Font font)
                    return false;

                var rgb = font.Color?.Rgb?.Value; // e.g. "FFFF0000" (ARGB) - null means automatic/theme colour
                if (string.IsNullOrEmpty(rgb) || rgb.Length < 6)
                    return false;

                var hex = rgb.Length == 8 ? rgb[2..] : rgb; // drop the alpha channel if present
                if (!int.TryParse(hex[..2], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var r)) return false;
                if (!int.TryParse(hex[2..4], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var g)) return false;
                if (!int.TryParse(hex[4..6], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var b)) return false;

                return r >= 150 && r > g * 1.5 && r > b * 1.5;
            }

            var leadRows = new HashSet<int>();
            foreach (var row in rows.Skip(1))
            {
                if (row.RowIndex?.Value == null)
                    continue;

                var dataTableRow = (int)row.RowIndex.Value - 1; // Excel row 1 (header) -> DataTable row 0
                var cellsByColumn = row.Elements<Cell>().ToDictionary(c => ColumnRef(c.CellReference?.Value), c => c);

                bool marked =
                    (firstCol != null && cellsByColumn.TryGetValue(firstCol, out var fc) && IsRedFont(fc)) ||
                    (lastCol != null && cellsByColumn.TryGetValue(lastCol, out var lc) && IsRedFont(lc));

                if (marked)
                    leadRows.Add(dataTableRow);
            }

            return leadRows;
        }


        /// <summary>
        /// Opens an uploaded workbook and reads its master roster ("Glasto nnnn" /
        /// "Starting Lineup") via RosterReader. Null when the workbook has no
        /// roster sheet; EmptySheetException when it has one with nobody on it.
        /// Same stream caveat as ListSaleSheets - the reader disposes the stream.
        /// </summary>
        public static Roster? ReadRoster(Stream excelStream, string fileName)
        {
            using var reader = OpenReader(excelStream, fileName);
            var ds = ReadDataSet(reader);
            return RosterReader.Read(ds);
        }

        private static IExcelDataReader OpenReader(Stream excelStream, string fileName)
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

            IExcelDataReader? reader = null;
            if (fileName.EndsWith(".xls", StringComparison.OrdinalIgnoreCase))
                reader = ExcelReaderFactory.CreateBinaryReader(excelStream);
            else if (fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase))
                reader = ExcelReaderFactory.CreateOpenXmlReader(excelStream);

            if (reader == null)
                throw new InvalidOperationException("Upload a .xls or .xlsx file.");

            return reader;
        }

        private static DataSet ReadDataSet(IExcelDataReader reader) =>
            reader.AsDataSet(new ExcelDataSetConfiguration
            {
                ConfigureDataTable = _ => new ExcelDataTableConfiguration { UseHeaderRow = false }
            });

        public static bool SaveAsCsv(string excelFilePath, string destinationCsvFilePath)
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

            using (var stream = new FileStream(excelFilePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                IExcelDataReader? reader = null;
                if (excelFilePath.EndsWith(".xls"))
                {
                    reader = ExcelReaderFactory.CreateBinaryReader(stream);
                }
                else if (excelFilePath.EndsWith(".xlsx"))
                {
                    reader = ExcelReaderFactory.CreateOpenXmlReader(stream);
                }

                if (reader == null)
                    return false;

                var ds = reader.AsDataSet(new ExcelDataSetConfiguration()
                {
                    ConfigureDataTable = (tableReader) => new ExcelDataTableConfiguration()
                    {
                        UseHeaderRow = false
                    }
                });

                for (int j= 0; j < 3; j++)
                {
                    var sheet = ds.Tables[j];

                    var csvContent = string.Empty;
                    int row_no = 0;
                    while (row_no < sheet.Rows.Count)
                    {
                        var arr = new List<string>();
                        for (int i = 0; i < 5; i++)
                        {
                            arr.Add(sheet.Rows[row_no][i]?.ToString() ?? string.Empty);
                        }
                        row_no++;
                        csvContent += string.Join(",", arr) + "\r\n";
                    }
                    StreamWriter csv = new StreamWriter($"{destinationCsvFilePath}\\{sheet.TableName}.csv", false);
                    csv.Write(csvContent);
                    csv.Close();
                }

                return true;
            }
        }
    }
}
