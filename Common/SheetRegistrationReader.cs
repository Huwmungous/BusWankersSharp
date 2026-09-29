using System.Data;
using System.Globalization;

namespace Autofills.Common
{
    /// <summary>One person's registration entry on a sheet.</summary>
    public record Registrant(string RegistrationId, string PostCode);

    /// <summary>
    /// A sale sheet that has its header row but no registrants under it yet - the
    /// normal state of a sale tab before anyone has been put on it. Distinct from
    /// a malformed sheet so callers can report "empty" rather than "failed".
    /// </summary>
    public sealed class EmptySheetException : InvalidOperationException
    {
        public EmptySheetException(string message) : base(message) { }
    }

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
        /// <summary>
        /// Same as ReadGroups(sheet, maxInAGroup) below, plus the Lead Booker
        /// concept (2026-09-18): each group has one person marked as its
        /// "Lead Booker" by colouring their First/Last name cell red on the
        /// spreadsheet (Bus Wankers' own convention - the actual See Tickets
        /// form just calls that slot "Your Details"). Frontend and the
        /// generated CSV/JSON already treat whoever is FIRST in a group's
        /// Members list as the Lead Booker (see GroupFillPanel.jsx/
        /// GroupsSection.jsx's "Lead Booker" / "#1" labelling and
        /// BusWankers.GenerateAutofillTextFromGroups' slot-0 handling) - so
        /// the only thing this needs to do is put the red-marked person
        /// first within their group; nothing downstream changes.
        ///
        /// leadBookerRows: DataTable row indices (matching the loop variable
        /// `r` below - i.e. the same indexing as sheet.Rows) that carry a red
        /// First/Last cell, from ExcelFileHelper.DetectLeadBookerRows. Pass
        /// null when colour detection wasn't attempted at all (a .xls
        /// upload - ExcelDataReader has no styling API and there's no OpenXML
        /// equivalent for the old binary format), which is reported as ONE
        /// warning for the whole sheet rather than one per group. Pass a
        /// (possibly empty) set when detection DID run - each group with no
        /// red person, or more than one, gets its own warning; either way the
        /// upload still succeeds (Hugh, 2026-09-18: keep today's fallback
        /// behaviour - first-listed becomes Lead Booker - and warn, rather
        /// than blocking the ingest).
        /// </summary>
        public static (List<RegistrationGroup> Groups, List<string> Warnings) ReadGroups(
            DataTable sheet, int maxInAGroup, IReadOnlySet<int>? leadBookerRows = null)
        {
            var (headerRow, groupCol, regCol, postcodeCol) = FindHeader(sheet);

            if (headerRow < 0)
                throw new InvalidOperationException(
                    "Could not find a header row containing 'Reg Number' and 'Postcode' columns on this sheet.");

            var warnings = new List<string>();
            bool detectionRan = leadBookerRows != null;
            if (!detectionRan)
                warnings.Add("Lead Booker colours can only be read from .xlsx files, so groups on this sheet are ordered exactly as listed in the spreadsheet.");

            var ordered = new List<(string? GroupLabel, Registrant Member, bool IsLead)>();

            for (int r = headerRow + 1; r < sheet.Rows.Count; r++)
            {
                var regVal = CellToString(sheet.Rows[r][regCol]);
                if (string.IsNullOrEmpty(regVal))
                    continue; // blank / separator row

                var postVal = postcodeCol >= 0 ? CellToString(sheet.Rows[r][postcodeCol]) : string.Empty;
                string? groupVal = groupCol >= 0 ? CellToString(sheet.Rows[r][groupCol]) : null;
                if (string.IsNullOrEmpty(groupVal))
                    groupVal = null;

                bool isLead = leadBookerRows != null && leadBookerRows.Contains(r);
                ordered.Add((groupVal, new Registrant(regVal, postVal), isLead));
            }

            if (ordered.Count == 0)
                throw new EmptySheetException("No registrations found below the header row on this sheet.");

            bool anyLabelled = ordered.Any(o => o.GroupLabel != null);

            var groups = new List<RegistrationGroup>();

            if (anyLabelled)
            {
                var byLabel = new Dictionary<string, List<(Registrant Member, bool IsLead)>>();
                var labelOrder = new List<string>();
                int syntheticIndex = 0;

                foreach (var (label, member, isLead) in ordered)
                {
                    // An unlabelled row mixed in with labelled ones gets its own
                    // singleton group rather than being folded into whichever
                    // labelled group happens to be adjacent.
                    var key = label ?? $"(unlabelled {++syntheticIndex})";
                    if (!byLabel.TryGetValue(key, out var list))
                    {
                        list = new List<(Registrant, bool)>();
                        byLabel[key] = list;
                        labelOrder.Add(key);
                    }
                    list.Add((member, isLead));
                }

                foreach (var key in labelOrder)
                    groups.Add(BuildGroup(key, byLabel[key], detectionRan, warnings));
            }
            else
            {
                // No group letters anywhere on this sheet - slice sequentially from
                // the top into fixed-size chunks.
                int groupNum = 0;
                for (int i = 0; i < ordered.Count; i += maxInAGroup)
                {
                    groupNum++;
                    var chunk = ordered.Skip(i).Take(maxInAGroup).Select(o => (o.Member, o.IsLead)).ToList();
                    groups.Add(BuildGroup(groupNum.ToString(CultureInfo.InvariantCulture), chunk, detectionRan, warnings));
                }
            }

            var tooBig = groups.FirstOrDefault(g => g.Members.Count > maxInAGroup);
            if (tooBig != null)
                throw new InvalidOperationException(
                    $"Group '{tooBig.GroupLabel}' has {tooBig.Members.Count} people, more than the {maxInAGroup}-per-group limit for this sale. Check the spreadsheet.");

            return (groups, warnings);
        }

        /// <summary>
        /// Builds one group from its members in spreadsheet order, moving
        /// whoever is marked Lead Booker (a red First/Last cell) to position
        /// 0 - everyone else keeps their existing relative order after that.
        /// detectionRan false means colour detection wasn't attempted for
        /// this whole sheet (already warned about once by the caller), so no
        /// per-group warning is added and the order is left exactly as
        /// listed. When it's true: zero red people in the group keeps
        /// today's fallback (first-listed stays first) but warns; more than
        /// one red person uses the first one found (in spreadsheet order)
        /// and warns about the rest.
        /// </summary>
        private static RegistrationGroup BuildGroup(
            string label, List<(Registrant Member, bool IsLead)> members, bool detectionRan, List<string> warnings)
        {
            if (!detectionRan || members.Count == 0)
                return new RegistrationGroup(label, members.Select(m => m.Member).ToList());

            var leadIndexes = new List<int>();
            for (int i = 0; i < members.Count; i++)
                if (members[i].IsLead)
                    leadIndexes.Add(i);

            if (leadIndexes.Count == 0)
            {
                warnings.Add($"Group {label}: nobody's name was marked red as Lead Booker - using {members[0].Member.RegistrationId} (first listed on the sheet) instead.");
                return new RegistrationGroup(label, members.Select(m => m.Member).ToList());
            }

            if (leadIndexes.Count > 1)
            {
                var chosen = members[leadIndexes[0]].Member.RegistrationId;
                var extras = string.Join(", ", leadIndexes.Skip(1).Select(i => members[i].Member.RegistrationId));
                warnings.Add($"Group {label}: more than one person was marked red ({chosen}, {extras}) - using {chosen} (the first one found) as Lead Booker.");
            }

            var leadIndex = leadIndexes[0];
            var reordered = new List<Registrant> { members[leadIndex].Member };
            for (int i = 0; i < members.Count; i++)
                if (i != leadIndex)
                    reordered.Add(members[i].Member);

            return new RegistrationGroup(label, reordered);
        }


        /// <summary>
        /// True when row 0 carries the sale-sheet heading shape: "Group", "Reg
        /// Number" and "Postcode" all present. Used by ExcelFileHelper to decide
        /// which tabs are sales at all.
        /// </summary>
        public static bool HasSaleHeader(DataTable sheet)
        {
            var (headerRow, groupCol, _, _) = FindHeader(sheet);
            return headerRow >= 0 && groupCol >= 0;
        }

        /// <summary>
        /// Row 0 always holds the headings - reads that row's cells to find the
        /// "Group", "Reg Number" and "Postcode" columns (case-insensitive) by name,
        /// rather than assuming fixed positions, since column order has varied
        /// between sheets ("Coach" has an extra "Depart" column "General" doesn't).
        /// ReadGroups tolerates a missing "Group" column (every row then falls back
        /// to the slice-from-the-top convention), but HasSaleHeader requires it -
        /// that's what tells a sale tab apart from the master roster.
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
