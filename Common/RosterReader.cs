using System.Data;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Autofills.Common
{
    /// <summary>One person on the master roster ("Glasto nnnn") sheet.</summary>
    public record RosterEntry(string RegistrationId, string FirstName, string LastName)
    {
        public string DisplayName =>
            string.Join(" ", new[] { FirstName, LastName }.Where(s => !string.IsNullOrWhiteSpace(s)));
    }

    /// <summary>
    /// The master roster as read from a workbook: which festival year it is for,
    /// the sheet it came from, and everyone on it in name order.
    /// </summary>
    public record Roster(int Year, string SheetName, List<RosterEntry> Entries);

    /// <summary>
    /// Reads the master roster sheet - the one tab in a Bus Wankers workbook that
    /// is NOT a sale. Historically "Starting Lineup" / "The starting lineup"; the
    /// 2027 workbook renamed it "Glasto 2027", and that name now carries the
    /// festival year the whole site should be talking about.
    ///
    /// The year comes from the sheet name ("Glasto 2027") when it has one, else
    /// from a "Going nnnn" / "Attending nnnn" heading on the sheet, which is how
    /// the older "Starting Lineup" layout recorded it.
    ///
    /// Columns are found by heading name on row 0, never by position: "Reg
    /// Number" is required; names come from "First" + "Last" (also accepting
    /// "First Name"/"Forename" and "Last Name"/"Surname"), or a single "Name"
    /// column as a fallback. Rows with no Reg Number are skipped, and the result
    /// is sorted by surname then forename so the page can show a name-ordered
    /// running order.
    /// </summary>
    public static class RosterReader
    {
        private static readonly Regex SheetNameYear =
            new(@"^\s*glasto\s+(\d{4})\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static readonly Regex HeadingYear =
            new(@"^\s*(?:going|attending)\s+(\d{4})\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static readonly HashSet<string> LegacyRosterNames =
            new(StringComparer.OrdinalIgnoreCase) { "Starting Lineup", "The starting lineup" };

        private static readonly string[] FirstNameHeadings = { "First", "First Name", "Forename" };
        private static readonly string[] LastNameHeadings = { "Last", "Last Name", "Surname" };

        /// <summary>
        /// Finds the roster sheet in <paramref name="ds"/> and reads it. Returns
        /// null when the workbook has no roster sheet at all (that's not an error -
        /// a workbook can legitimately be sales only). Throws
        /// <see cref="EmptySheetException"/> when the roster sheet exists but has
        /// nobody on it, and InvalidOperationException (message safe to show the
        /// uploader) when it exists but its headings can't be understood.
        /// </summary>
        public static Roster? Read(DataSet ds)
        {
            var sheet = FindRosterSheet(ds, out var yearFromName);
            if (sheet == null)
                return null;

            var sheetName = sheet.TableName.Trim();

            if (sheet.Rows.Count == 0)
                throw new EmptySheetException($"'{sheetName}' has no rows at all - not even a heading row.");

            int regCol = -1, firstCol = -1, lastCol = -1, nameCol = -1;
            int? yearFromHeading = null;

            for (int c = 0; c < sheet.Columns.Count; c++)
            {
                var heading = CellToString(sheet.Rows[0][c]);
                if (heading.Length == 0)
                    continue;

                if (string.Equals(heading, "Reg Number", StringComparison.OrdinalIgnoreCase))
                    regCol = c;
                else if (FirstNameHeadings.Any(h => string.Equals(h, heading, StringComparison.OrdinalIgnoreCase)))
                    firstCol = c;
                else if (LastNameHeadings.Any(h => string.Equals(h, heading, StringComparison.OrdinalIgnoreCase)))
                    lastCol = c;
                else if (string.Equals(heading, "Name", StringComparison.OrdinalIgnoreCase))
                    nameCol = c;
                else
                {
                    var m = HeadingYear.Match(heading);
                    if (m.Success && yearFromHeading == null)
                        yearFromHeading = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
                }
            }

            if (regCol < 0)
                throw new InvalidOperationException(
                    $"'{sheetName}' looks like the roster sheet but has no 'Reg Number' heading in row 1.");

            if (firstCol < 0 && lastCol < 0 && nameCol < 0)
                throw new InvalidOperationException(
                    $"'{sheetName}' has no name columns - expected 'First' and 'Last' (or 'Name') headings in row 1.");

            var year = yearFromName ?? yearFromHeading;
            if (year == null)
                throw new InvalidOperationException(
                    $"Couldn't work out the festival year from '{sheetName}' - name the sheet 'Glasto nnnn' or give it a 'Going nnnn' column.");

            var entries = new List<RosterEntry>();
            for (int r = 1; r < sheet.Rows.Count; r++)
            {
                var reg = CellToString(sheet.Rows[r][regCol]);
                if (reg.Length == 0)
                    continue; // blank / separator row, or someone not yet registered

                string first, last;
                if (firstCol >= 0 || lastCol >= 0)
                {
                    first = firstCol >= 0 ? CellToString(sheet.Rows[r][firstCol]) : string.Empty;
                    last = lastCol >= 0 ? CellToString(sheet.Rows[r][lastCol]) : string.Empty;
                }
                else
                {
                    (first, last) = SplitName(CellToString(sheet.Rows[r][nameCol]));
                }

                entries.Add(new RosterEntry(reg, first, last));
            }

            if (entries.Count == 0)
                throw new EmptySheetException($"'{sheetName}' has nobody with a Reg Number on it.");

            var ordered = entries
                .OrderBy(e => e.LastName, StringComparer.OrdinalIgnoreCase)
                .ThenBy(e => e.FirstName, StringComparer.OrdinalIgnoreCase)
                .ThenBy(e => e.RegistrationId, StringComparer.Ordinal)
                .ToList();

            return new Roster(year.Value, sheetName, ordered);
        }

        /// <summary>
        /// True when this tab is the roster by name alone - used by the sale-sheet
        /// listing so a "Glasto nnnn" tab is never offered as a sale, whatever its
        /// headings look like.
        /// </summary>
        public static bool IsRosterSheetName(string? sheetName) =>
            !string.IsNullOrWhiteSpace(sheetName)
            && (SheetNameYear.IsMatch(sheetName) || LegacyRosterNames.Contains(sheetName.Trim()));

        private static DataTable? FindRosterSheet(DataSet ds, out int? yearFromName)
        {
            yearFromName = null;

            // Prefer the modern "Glasto nnnn" tab - it names the year outright.
            foreach (DataTable t in ds.Tables)
            {
                var m = SheetNameYear.Match(t.TableName);
                if (m.Success)
                {
                    yearFromName = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
                    return t;
                }
            }

            foreach (DataTable t in ds.Tables)
            {
                if (LegacyRosterNames.Contains(t.TableName.Trim()))
                    return t;
            }

            return null;
        }

        /// <summary>"Emma Corden" -> ("Emma", "Corden"); a single word is all surname.</summary>
        private static (string First, string Last) SplitName(string name)
        {
            var trimmed = name.Trim();
            if (trimmed.Length == 0)
                return (string.Empty, string.Empty);

            var lastSpace = trimmed.LastIndexOf(' ');
            if (lastSpace < 0)
                return (string.Empty, trimmed);

            return (trimmed[..lastSpace].Trim(), trimmed[(lastSpace + 1)..].Trim());
        }

        /// <summary>Same numeric handling as SheetRegistrationReader - a 10-digit reg number must not come out as 3.98E+09.</summary>
        private static string CellToString(object? cell)
        {
            if (cell == null || cell is DBNull)
                return string.Empty;

            if (cell is double d)
                return d.ToString("0", CultureInfo.InvariantCulture);

            if (cell is DateTime dt)
                return dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

            return cell.ToString()?.Trim() ?? string.Empty;
        }
    }
}
