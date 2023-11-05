using Autofills.Common;
using System.Runtime.CompilerServices;

namespace Autofills.AutofillFromCSV
{
    public class Program
    {
        public static void Main(string[] args)
        {
            // Use default file name or take from the commandline
            string inputFile = args.Length > 0 ? args[0] : @".\input.csv";

            string outputFile = args.Length > 1 ? args[1] : @"h:\Autofills\autofill.txt";

            if(BusWankers.CheckPaths(inputFile, outputFile))
                BusWankers.GenerateAutofillText(inputFile, outputFile);
        }
    }
}
