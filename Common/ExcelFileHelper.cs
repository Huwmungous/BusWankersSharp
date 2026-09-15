using ExcelDataReader;
using System.Data;
using System.Text;

namespace Autofills.Common
{
    public class ExcelFileHelper
    {
        /// <summary>
        /// Sheets that are never a sale, whatever the workbook contains: the master
        /// roster and the queue-URL scratchpad. Every other sheet is a sale, by
        /// definition - the workbook's own sheet names ARE the list of sales, rather
        /// than a fixed set of names this code has to know in advance. Compared
        /// trimmed and case-insensitive, since the real "Starting Lineup" sheet has
        /// been seen with a trailing space in its actual tab name.
        /// </summary>
        private static readonly HashSet<string> NonSaleSheetNames =
            new(StringComparer.OrdinalIgnoreCase) { "Starting Lineup", "URL" };

        /// <summary>
        /// Opens an uploaded workbook (from a stream, so it never has to touch disk)
        /// and returns the names of its sale sheets, in workbook order.
        /// </summary>
        public static List<string> ListSaleSheets(Stream excelStream, string fileName)
        {
            using var reader = OpenReader(excelStream, fileName);
            var ds = ReadDataSet(reader);

            return ds.Tables.Cast<DataTable>()
                .Select(t => t.TableName)
                .Where(name => !NonSaleSheetNames.Contains(name.Trim()))
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
