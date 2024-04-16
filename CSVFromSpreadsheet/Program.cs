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

            int maxInAGroup = args.Length > 2 ? int.Parse(args[2]) : BusWankers.DEFAULT_MAX_IN_A_GROUP;

            if (BusWankers.CheckPaths(inputFile, outputPath + "\\dummytext.txt"))
                ExcelFileHelper.SaveAsCsv(inputFile, outputPath);

            BusWankers.GenerateAutofillText($"{outputPath}\\Resale - Coach.csv", $"{outputPath}\\bw_autofills.txt", maxInAGroup);
            BusWankers.GenerateAutofillText($"{outputPath}\\Resale - General.csv", $"{outputPath}\\g_autofills.txt", maxInAGroup);
        }
    }
}
