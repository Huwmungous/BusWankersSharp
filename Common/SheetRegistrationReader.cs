using System.Data;
using System.Globalization;

namespace Autofills.Common
{
    /// <summary>One person's registration entry on a sheet.</summary>
    public record Registrant(string RegistrationId, string PostCode);

    /// <summary>One group of registrants, as found on (or sliced from) a sheet.</summary>
    public record RegistrationGroup(string GroupLabel, List<Registrant> Members);

    /// <summary>
    /// Turns a raw ExcelDataReader DataTable (no header-row inference - rows/columns
    /// exactly as they appear in the workbook) into groups of registrants.
    ///
    /// Two conventions have been seen in real Bus Wankers spreadsheets, and both are
    /// supported here:
    ///
    ///  1. An explicit letter in the "Group" column (A, B, C...) - rows sharing a
    ///     letter belong to the same group, in the order the letters first appear.
    ///     This is how the original console-app pipeline (BusWankers.ReadCsv) always
    ///     worked, and it's what a fully-populated sheet (e.g. a "Demo" sheet) uses.
    ///
    ///  2. No letters at all (Group column blank throughout) - groups are formed by
    ///     slicing the sheet's registrants into fixed-size chunks, top to bottom, in
    ///     the order they appear. This is the fallback for sheets that haven't been
    ///     given explicit group letters yet.
    ///
    /// A sheet only ever uses one convention: if ANY row has a letter, every row is
    /// expected to (an unlabelled row on an otherwise-labelled sheet becomes its own
    /// singleton group rather than silently merging into the wrong group).
    /// </summary>
    public static class SheetRegistrationReader
    {
        public static List<RegistrationGroup> ReadGroups(DataTable sheet, int maxInAGroup)
        {
            var (headerRow, groupCol, regCol, postcodeCol) = FindHeader(sheet);

            if (headerRow < 0)
                throw new InvalidOperationException(
                    "Could not find a header row containing 'Reg Number' and 'Postcode' columns on this sheet.");

            var ordered = new List<(string? GroupLabel, Registrant Member)>();

            for (int r = headerRow + 1; r < sheet.Rows.Count; r++)
            {
                var regVal = CellToString(sheet.Rows[r][regCol]);
                if (string.IsNullOrEmpty(regVal))
                    continue; // blank / separator row

                var postVal = postcodeCol >= 0 ? CellToString(sheet.Rows[r][postcodeCol]) : string.Empty;
                string? groupVal = groupCol >= 0 ? CellToString(sheet.Rows[r][groupCol]) : null;
                if (string.IsNullOrEmpty(groupVal))
                    groupVal = null;

                ordered.Add((groupVal, new Registrant(regVal, postVal)));
            }

            if (ordered.Count == 0)
                throw new InvalidOperationException("No registrations found below the header row on this sheet.");

            bool anyLabelled = ordered.Any(o => o.GroupLabel != null);

            var groups = new List<RegistrationGroup>();

            if (anyLabelled)
            {
                var byLabel = new Dictionary<string, List<Registrant>>();
                var labelOrder = new List<string>();
                int syntheticIndex = 0;

                foreach (var (label, member) in ordered)
                {
                    // An unlabelled row mixed in with labelled ones gets its own
                    // singleton group rather than being folded into whichever
                    // labelled group happens to be adjacent.
                    var key = label ?? $"(unlabelled {++syntheticIndex})";
                    if (!byLabel.TryGetValue(key, out var list))
                    {
                        list = new List<Registrant>();
                        byLabel[key] = list;
                        labelOrder.Add(key);
                    }
                    list.Add(member);
                }

                foreach (var key in labelOrder)
                    groups.Add(new RegistrationGroup(key, byLabel[key]));
            }
            else
            {
                // No group letters anywhere on this sheet - slice sequentially from
                // the top into fixed-size chunks.
                int groupNum = 0;
                for (int i = 0; i < ordered.Count; i += maxInAGroup)
                {
                    groupNum++;
                    var chunk = ordered.Skip(i).Take(maxInAGroup).Select(o => o.Member).ToList();
                    groups.Add(new RegistrationGroup(groupNum.ToString(CultureInfo.InvariantCulture), chunk));
                }
            }

            var tooBig = groups.FirstOrDefault(g => g.Members.Count > maxInAGroup);
            if (tooBig != null)
                throw new InvalidOperationException(
                    $"Group '{tooBig.GroupLabel}' has {tooBig.Members.Count} people, more than the {maxInAGroup}-per-group limit for this sale. Check the spreadsheet.");

            return groups;
        }

        /// <summary>
        /// Row 0 always holds the headings - reads that row's cells to find the
        /// "Group", "Reg Number" and "Postcode" columns (case-insensitive) by name,
        /// rather than assuming fixed positions, since column order has varied
        /// between sheets ("Coach" has an extra "Depart" column "General" doesn't).
        /// "Group" is optional; its absence just means every row on this sheet will
        /// fall back to the slice-from-the-top convention.
        /// </summary>
        private static (int HeaderRow, int GroupCol, int RegCol, int PostcodeCol) FindHeader(DataTable sheet)
        {
            if (sheet.Rows.Count == 0)
                return (-1, -1, -1, -1);

            int groupCol = -1, regCol = -1, postcodeCol = -1;

            for (int c = 0; c < sheet.Columns.Count; c++)
            {
                var val = CellToString(sheet.Rows[0][c]);
                if (string.Equals(val, "Group", StringComparison.OrdinalIgnoreCase))
                    groupCol = c;
                else if (string.Equals(val, "Reg Number", StringComparison.OrdinalIgnoreCase))
                    regCol = c;
                else if (string.Equals(val, "Postcode", StringComparison.OrdinalIgnoreCase))
                    postcodeCol = c;
            }

            if (regCol < 0 || postcodeCol < 0)
                return (-1, -1, -1, -1);

            return (0, groupCol, regCol, postcodeCol);
        }

        /// <summary>
        /// ExcelDataReader hands numeric cells back as double - a naive ToString()
        /// on a 10-digit registration number can come out in scientific notation
        /// (e.g. "3.983092553E+09"). Format explicitly as a plain integer instead.
        /// </summary>
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
