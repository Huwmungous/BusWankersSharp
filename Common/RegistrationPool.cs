using System.Data;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Autofills.Common
{
    /// <summary>
    /// One (registration number, postcode) pair read from the compiled
    /// spreadsheet - the "tuple" that is handed to exactly one person.
    /// </summary>
    public record PoolRegistration(string RegNumber, string PostCode);

    /// <summary>What a load of the compiled workbook produced.</summary>
    /// <param name="SheetName">The tab the pairs came from.</param>
    /// <param name="Entries">Distinct pairs, in sheet order (first occurrence of a reg number wins).</param>
    /// <param name="SkippedRows">Rows ignored because the reg number or postcode was missing or not usable.</param>
    /// <param name="DuplicateRows">Rows ignored because their reg number had already appeared further up.</param>
    public record PoolLoadResult(string SheetName, List<PoolRegistration> Entries, int SkippedRows, int DuplicateRows);

    /// <summary>
    /// Reads the registration pool out of Hugh's compiled workbook
    /// ("Glasto_compiled"): the "Unique Reg Numbers" tab, one row per person
    /// who has ever held a registration, de-duplicated across the years.
    ///
    /// That tab has no heading row in the real workbook, so the columns are
    /// read by position (A = Reg Number, D = Postcode) - but if a heading row
    /// with "Reg Number" and "Postcode" is ever added, the columns are found by
    /// heading instead, same convention as RosterReader. A row is kept only if
    /// its reg number is all digits (5-12 of them) and it has a postcode; a
    /// heading row, blank rows and notes therefore drop out on their own. Where
    /// a reg number appears twice the first row wins, so a later row with
    /// shifted columns can't displace the good one. Postcodes are trimmed,
    /// upper-cased and have runs of spaces collapsed, but a space is neither
    /// added nor removed ("S75 3TB" and "S753TB" stay as the sheet has them).
    /// </summary>
    public static class RegistrationPoolReader
    {
        public const string SheetName = "Unique Reg Numbers";

        private const int DefaultRegColumn = 0;
        private const int DefaultPostcodeColumn = 3;

        private static readonly Regex RegNumberShape = new(@"^\d{5,12}$", RegexOptions.Compiled);
        private static readonly Regex Spaces = new(@"\s+", RegexOptions.Compiled);

        /// <summary>
        /// Throws InvalidOperationException (message safe to show the uploader)
        /// when the workbook has no such tab or it yields no usable pairs.
        /// </summary>
        public static PoolLoadResult Read(DataSet ds)
        {
            DataTable? sheet = null;
            foreach (DataTable t in ds.Tables)
            {
                if (string.Equals(t.TableName.Trim(), SheetName, StringComparison.OrdinalIgnoreCase))
                {
                    sheet = t;
                    break;
                }
            }

            if (sheet == null)
            {
                var available = string.Join(", ", ds.Tables.Cast<DataTable>().Select(t => t.TableName));
                throw new InvalidOperationException(
                    $"No '{SheetName}' sheet in this file. Sheets in this file: {available}");
            }

            int regCol = DefaultRegColumn, postCol = DefaultPostcodeColumn, firstRow = 0;

            if (sheet.Rows.Count > 0)
            {
                int headingReg = -1, headingPost = -1;
                for (int c = 0; c < sheet.Columns.Count; c++)
                {
                    var heading = CellToString(sheet.Rows[0][c]);
                    if (string.Equals(heading, "Reg Number", StringComparison.OrdinalIgnoreCase)) headingReg = c;
                    else if (string.Equals(heading, "Postcode", StringComparison.OrdinalIgnoreCase)) headingPost = c;
                }

                if (headingReg >= 0 && headingPost >= 0)
                {
                    regCol = headingReg;
                    postCol = headingPost;
                    firstRow = 1;
                }
            }

            if (sheet.Columns.Count <= Math.Max(regCol, postCol))
                throw new InvalidOperationException(
                    $"'{SheetName}' doesn't have enough columns - expected Reg Number in column A and Postcode in column D (or 'Reg Number' and 'Postcode' headings in row 1).");

            var entries = new List<PoolRegistration>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            int skipped = 0, duplicates = 0;

            for (int r = firstRow; r < sheet.Rows.Count; r++)
            {
                var reg = CellToString(sheet.Rows[r][regCol]);
                var post = NormalisePostcode(CellToString(sheet.Rows[r][postCol]));

                if (reg.Length == 0 && post.Length == 0)
                    continue; // a blank row isn't worth reporting

                if (!RegNumberShape.IsMatch(reg) || post.Length == 0)
                {
                    skipped++;
                    continue;
                }

                if (!seen.Add(reg))
                {
                    duplicates++;
                    continue;
                }

                entries.Add(new PoolRegistration(reg, post));
            }

            if (entries.Count == 0)
                throw new InvalidOperationException($"'{SheetName}' has no usable Reg Number / Postcode rows.");

            return new PoolLoadResult(sheet.TableName.Trim(), entries, skipped, duplicates);
        }

        public static string NormalisePostcode(string postcode) =>
            Spaces.Replace(postcode.Trim(), " ").ToUpperInvariant();

        /// <summary>Same numeric handling as the other readers - a 10-digit reg number must not come out as 3.98E+09.</summary>
        private static string CellToString(object? cell)
        {
            if (cell == null || cell is DBNull)
                return string.Empty;

            if (cell is double d)
                return d.ToString("0", CultureInfo.InvariantCulture);

            return cell.ToString()?.Trim() ?? string.Empty;
        }
    }

    /// <summary>
    /// One pair in the pool and who (if anyone) holds it. <c>AllocatedTo</c> is
    /// the opaque id a browser generated for itself (see the allocation
    /// controller) - null while the pair is still free.
    /// </summary>
    public record PoolEntry(string RegNumber, string PostCode, string? AllocatedTo = null, DateTimeOffset? AllocatedAt = null)
    {
        [System.Text.Json.Serialization.JsonIgnore]
        public bool IsAllocated => AllocatedTo != null;
    }

    public enum ClaimOutcome
    {
        /// <summary>It was free and now belongs to the claimant.</summary>
        Claimed,
        /// <summary>It already belonged to the claimant (copying the second field, say) - nothing changed.</summary>
        AlreadyYours,
        /// <summary>It belongs to somebody else.</summary>
        TakenByOther,
        /// <summary>It isn't in the pool (the pool was reloaded without it).</summary>
        NotFound,
    }

    /// <summary>What a reload of the pool did to the existing allocations.</summary>
    public record PoolReplaceResult(int Total, int Added, int StillAllocated, int DroppedAllocated);

    /// <summary>
    /// The allocation rules, with no I/O: an ordered list of pairs, each either
    /// free or held by one claimant, and the three things anyone can do - look
    /// at the next free one, claim one, or have the whole list reloaded.
    ///
    /// NOT thread-safe by design: the caller (UploaderService's
    /// RegistrationPoolStore) loads, changes and saves it under one lock, which
    /// is what makes "once copied, it can't go to anyone else" hold when two
    /// people press Copy at the same moment.
    /// </summary>
    public sealed class RegistrationPool
    {
        private List<PoolEntry> _entries;

        public RegistrationPool(IEnumerable<PoolEntry>? entries = null, string source = "", DateTimeOffset? loadedAt = null)
        {
            _entries = entries?.ToList() ?? new List<PoolEntry>();
            Source = source;
            LoadedAt = loadedAt;
        }

        /// <summary>The file the pairs were last loaded from (for the log and the uploader's confirmation).</summary>
        public string Source { get; private set; }

        public DateTimeOffset? LoadedAt { get; private set; }

        public IReadOnlyList<PoolEntry> Entries => _entries;

        public int Total => _entries.Count;

        public int Remaining => _entries.Count(e => !e.IsAllocated);

        public bool AllAllocated => _entries.Count > 0 && Remaining == 0;

        /// <summary>
        /// What a browser should show when it opens the tab: the pair that
        /// browser most recently claimed (so a reload after copying the
        /// registration number doesn't lose the postcode), otherwise the first
        /// free pair. Null when there is nothing free and nothing of its own.
        /// </summary>
        public PoolEntry? Current(string claimant)
        {
            var mine = _entries
                .Where(e => e.AllocatedTo == claimant && e.AllocatedAt != null)
                .OrderByDescending(e => e.AllocatedAt)
                .FirstOrDefault();

            return mine ?? Next(null, claimant);
        }

        /// <summary>
        /// The first FREE pair after <paramref name="afterRegNumber"/> in list
        /// order, wrapping round to the top, so a pair someone skipped with Next
        /// comes round again rather than being lost to them. With no
        /// <paramref name="afterRegNumber"/> (or one that isn't in the list)
        /// it's simply the first free pair. Null when none is free. Never
        /// changes anything.
        /// </summary>
        public PoolEntry? Next(string? afterRegNumber, string claimant)
        {
            if (_entries.Count == 0)
                return null;

            var start = 0;
            if (!string.IsNullOrEmpty(afterRegNumber))
            {
                var at = _entries.FindIndex(e => e.RegNumber == afterRegNumber);
                if (at >= 0)
                    start = at + 1;
            }

            for (int i = 0; i < _entries.Count; i++)
            {
                var candidate = _entries[(start + i) % _entries.Count];
                if (!candidate.IsAllocated)
                    return candidate;
            }

            return null;
        }

        /// <summary>
        /// Gives the pair to the claimant if it's still free. Claiming one
        /// you already hold is harmless (copying the postcode after the
        /// registration number), and anyone else's is refused.
        /// </summary>
        public (ClaimOutcome Outcome, PoolEntry? Entry) Claim(string regNumber, string claimant, DateTimeOffset now)
        {
            var at = _entries.FindIndex(e => e.RegNumber == regNumber);
            if (at < 0)
                return (ClaimOutcome.NotFound, null);

            var entry = _entries[at];
            if (entry.AllocatedTo == null)
            {
                var claimed = entry with { AllocatedTo = claimant, AllocatedAt = now };
                _entries[at] = claimed;
                return (ClaimOutcome.Claimed, claimed);
            }

            return entry.AllocatedTo == claimant
                ? (ClaimOutcome.AlreadyYours, entry)
                : (ClaimOutcome.TakenByOther, entry);
        }

        /// <summary>
        /// Replaces the list with a freshly read one (a new upload), keeping
        /// every allocation for a reg number that is still in it - reloading
        /// must never hand out something already given away. An allocated
        /// reg number that is no longer in the sheet goes with it (counted in
        /// the result so the uploader can see it).
        /// </summary>
        public PoolReplaceResult Replace(IEnumerable<PoolRegistration> loaded, string source, DateTimeOffset now)
        {
            var existing = _entries.ToDictionary(e => e.RegNumber, StringComparer.Ordinal);
            var next = new List<PoolEntry>();
            int added = 0, kept = 0;

            foreach (var item in loaded)
            {
                if (existing.TryGetValue(item.RegNumber, out var old))
                {
                    next.Add(old with { PostCode = item.PostCode });
                    if (old.IsAllocated) kept++;
                }
                else
                {
                    next.Add(new PoolEntry(item.RegNumber, item.PostCode));
                    added++;
                }
            }

            var keptRegs = next.Select(e => e.RegNumber).ToHashSet(StringComparer.Ordinal);
            var dropped = existing.Values.Count(e => e.IsAllocated && !keptRegs.Contains(e.RegNumber));

            _entries = next;
            Source = source;
            LoadedAt = now;

            return new PoolReplaceResult(next.Count, added, kept, dropped);
        }
    }
}
