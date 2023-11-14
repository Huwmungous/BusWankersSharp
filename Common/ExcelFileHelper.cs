using ExcelDataReader;
using System.Text;

namespace Autofills.Common
{
    public class ExcelFileHelper
    {
        public static bool SaveAsCsv(string excelFilePath, string destinationCsvFilePath)
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

            using (var stream = new FileStream(excelFilePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                IExcelDataReader reader = null;
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

                for (int j = 0; j < 3; j++)
                {
                    var sheet = ds.Tables[j];

                    var csvContent = string.Empty;
                    int row_no = 0;
                    while (row_no < sheet.Rows.Count)
                    {
                        var arr = new List<string>();
                        for (int i = 0; i < 5; i++)
                        {
                            arr.Add(sheet.Rows[row_no][i].ToString());
                        }
                        row_no++;
                        csvContent += string.Join(",", arr) + "\r\n";
                    }
                    StreamWriter csv = new StreamWriter($"{destinationCsvFilePath}{Path.DirectorySeparatorChar}{sheet.TableName.Replace(" ", string.Empty)}.csv", false);
                    csv.Write(csvContent);
                    csv.Close();
                }

                return true;
            }
        }
    }
}
