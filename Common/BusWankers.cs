using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Autofills.Common
{
    public class BusWankers
    {
        public const int DEFAULT_MAX_IN_A_GROUP = 6;
        const int SIGNIFICANT_COLUMNS = 6; // interested only in first 3 columns Group letter, registration and postcode

        private string inputFileName;
        private string outputFileName;

        public BusWankers(string inputFile, string outputFile)
        {
            inputFileName = inputFile;
            outputFileName = outputFile;
        }

        public int MaxInAGroup { get; set; }

        public List<List<string>> ReadCsv()
        {

                List<List<string>> records = new();
            try
            {

                // Read CSV into a list of lists
                using (StreamReader reader = new(inputFileName))
                {
                    string? line;
                    while ((line = reader.ReadLine()) != null)
                    {
                        List<string> row = line.Split(',')
                                               .Select(s => s.Trim())
                                               .Take(SIGNIFICANT_COLUMNS)
                                               .ToList();
                        records.Add(row);
                    }
                } 
                
            }
            catch (Exception ex)
            {
                Console.WriteLine(ex.Message);
            }
            return TidyData(records);
        }

        private List<List<string>> TidyData(List<List<string>> data)
        {
            if(data.Count == 0)
                return data;

            // strip off the row zero column headers
             data.RemoveAt(0);

            // Remove any empty lines
            return data.Where(row => !row.All(string.IsNullOrEmpty)).ToList();
        }

        public void WriteHeaders(List<List<string>> data)
        {
            // Write the header for the autofill CSV
            using StreamWriter writer = new(outputFileName);
            writer.WriteLine("### AUTOFILL PROFILES ###,,,,,,");
            writer.WriteLine("Profile ID, Name, Site, Hotkey,,,");

            // Write group headers
            int i = 1;
            foreach (string group in data.Select(row => row[0]).Distinct().Where(s => !s.Equals("Group")))
            {
                writer.WriteLine($"c{i},Group-{group},,,,,");
                i++;
            }
        }

        public void WriteRules(List<List<string>> data)
        {
            // Write the rules section of the autofill CSV
            using var writer = new StreamWriter(outputFileName, true);

            writer.WriteLine("### AUTOFILL RULES ###,,,,,,");
            writer.WriteLine("Rule ID,Type,Name,Value,Site,Mode,Profile");

            int groupNum = 0;
            int groupCount = 0;
            int rowCount = 1;

            string groupLetter = string.Empty;
            string groupCode = string.Empty;

            foreach (var entry in data)
            {
                if (!groupLetter.Equals(entry[0])) // first entry of new group
                {
                    if (!groupLetter.Equals(string.Empty))
                        PadGroup(writer, ref groupCount, ref rowCount, groupCode);

                    groupNum++;
                    groupCode = $"c{groupNum}";
                    groupLetter = entry[0];
                    groupCount = 0;
                }

                string registrationId = entry[1];
                string postcode = entry[2];

                writer.WriteLine($"r{rowCount},0,\"registrations_{groupCount}__RegistrationId\",\"{registrationId}\",\"\",1,{groupCode}");
                rowCount++;
                writer.WriteLine($"r{rowCount},0,\"registrations_{groupCount}__Postcode\",\"{postcode}\",\"\",1,{groupCode}");

                rowCount++;
                groupCount++;
            }

            PadGroup(writer, ref groupCount, ref rowCount, groupCode);
        }

        private void PadGroup(StreamWriter writer, ref int groupCount, ref int rowCount, string groupCode)
        {
            // end-fills a group with blank entries
            while (groupCount < MaxInAGroup)
            {
                writer.WriteLine($"r{rowCount},0,\"registrations_{groupCount}__RegistrationId\",\"\",\"\",1,{groupCode}");
                writer.WriteLine($"r{rowCount},0,\"registrations_{groupCount}__Postcode\",\"\",\"\",1,{groupCode}");
                rowCount += 2;

                groupCount++;
            }
        }

        private void WriteFooter()
        {
            // Write the footer section of the autofill CSV
            using var writer = new StreamWriter(outputFileName, true);

            writer.WriteLine("### AUTOFILL OPTIONS ###,,,,,,");
            writer.WriteLine("advanced,\"[]\",,,,,");
            writer.WriteLine("exceptions,\"[]\",,,,,");
            writer.WriteLine("textclips,\"[]\",,,,,");
            writer.WriteLine("variables,\"[]\",,,,,");
            writer.WriteLine("activecat,1,,,,,");
            writer.WriteLine("autoimport,0,,,,,");
            writer.WriteLine("backup,0,30,,,,");
            writer.WriteLine("badge,1,,,,,");
            writer.WriteLine("closeinfobar,1,1,,,,");
            writer.WriteLine("debug,0,,,,,");
            writer.WriteLine("delay,0,0.5,,,,");
            writer.WriteLine("fluid,1,,,,,");
            writer.WriteLine("hidebackup,0,,,,,");
            writer.WriteLine("manual,0,,,,,");
            writer.WriteLine("mask,1,,,,,");
            writer.WriteLine("menu,1,,,,,");
            writer.WriteLine("overwrite,1,,,,,");
            writer.WriteLine("sitefilters,1,,,,,");
            writer.WriteLine("skiphidden,0,,,,,");
            writer.WriteLine("sound,1,,,,,");
            writer.WriteLine("vars,1,,,,,");
            writer.WriteLine("voice,0,1,,,,");
        }


        private void WriteOutput(List<List<string>> inputText)
        {
            WriteHeaders(inputText);
            WriteRules(inputText);
            WriteFooter();
        }

        public static void GenerateAutofillText(string inputFile, string outputFile, int maxInAGroup)
        {
            // Instantiate the BusWankers class and process the input file
            BusWankers bw = new(inputFile, outputFile);

            bw.MaxInAGroup = maxInAGroup;

            List<List<string>> data = bw.ReadCsv();

            bw.WriteOutput(data);
        }

        public static bool CheckPaths(string inputFile, string outputFile)
        {
            bool result = false;

            if (string.IsNullOrEmpty(inputFile))
                Console.WriteLine("An Input File Name is Required");
            else if (string.IsNullOrEmpty(outputFile))
                Console.WriteLine("An Output File Name is Required");
            else if (!File.Exists(inputFile))
                Console.WriteLine($"No Such File: {inputFile}");
            else
            {
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(outputFile));

                    result = true;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"There is a Problem with the Output Path {outputFile} : {ex.Message}");
                }
            }

            return result;
        }

    }

}
