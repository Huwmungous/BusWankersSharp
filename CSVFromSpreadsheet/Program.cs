using Autofills.Common;

namespace Autofills.CSVFromSpreadsheet
{
    public class Program
    {
        public static void Main(string[] args)
        {
            // Use default file name or take from the commandline
            string inputFile = args.Length > 0 ? args[0] : @".\Glasto 2024 Sample.xlsx";
            string outputPath = args.Length > 1 ? args[1] : @"h:\Autofills"; 

            if (BusWankers.CheckPaths(inputFile, outputPath + "\\dummytext.txt"))
                ExcelFileHelper.SaveAsCsv(inputFile, outputPath);

            BusWankers.GenerateAutofillText($"{outputPath}\\Thursday - Coach.csv", $"{outputPath}\\bw_autofills.txt");
            BusWankers.GenerateAutofillText($"{outputPath}\\Sunday - General.csv", $"{outputPath}\\g_autofills.txt");
        }
    }
}
