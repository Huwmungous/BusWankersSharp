using ExcelDataReader;
using System.Data;
using System.Text;

namespace Autofills.Common
{
    public class ExcelFileHelper
    {
        /// <summary>
        /// Sheets that are never a sale, whatever the workbook contains: the master
        /// roster and the queue-URL scratchpad. Compared trimmed and
        /// case-insensitive, since the real "Starting Lineup" sheet has been seen
        /// with a trailing space in its actual tab name.
        ///
        /// This list is only a fast path - the real test is the header row (see
        /// IsSaleSheet). The 2027 workbook renamed the master roster "Glasto 2027",
        /// which no fixed name list would have caught.
        /// </summary>
        private static readonly HashSet<string> NonSaleSheetNames =
            new(StringComparer.OrdinalIgnoreCase) { "Starting Lineup", "URL" };

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
            if (NonSaleSheetNames.Contains(sheet.TableName.Trim()))
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
        /// </summary>
        public static List<RegistrationGroup> ReadSheetGroups(
            Stream excelStream, string fileName, string sheetName, int maxInAGroup)
        {
            using var reader = OpenReader(excelStream, fileName);
            var ds = ReadDataSet(reader);

            if (NonSaleSheetNames.Contains(sheetName.Trim()))
                throw new InvalidOperationException($"'{sheetName}' isn't a sale sheet.");

            DataTable? sheet = null;
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

            return SheetRegistrationReader.ReadGroups(sheet, maxInAGroup);
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
