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
    /// <param name="InGroupsRows">Pairs left out because that reg number is already in a group on a sale sheet.</param>
    public record PoolLoadResult(string SheetName, List<PoolRegistration> Entries, int SkippedRows, int DuplicateRows, int InGroupsRows = 0);

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

        /// <summary>
        /// Takes out of a loaded pool everyone whose reg number is in
        /// <paramref name="inGroups"/> - people already in a group are booked
        /// through that group, so they must never be handed out from here.
        /// Counts are added to any exclusions already made, so it can be applied
        /// more than once (workbook groups, then stored groups). Throws
        /// InvalidOperationException (message safe to show the uploader) if that
        /// leaves nobody.
        /// </summary>
        public static PoolLoadResult ExcludeGroupMembers(PoolLoadResult loaded, IReadOnlySet<string> inGroups)
        {
            if (inGroups.Count == 0)
                return loaded;

            var kept = loaded.Entries.Where(e => !inGroups.Contains(e.RegNumber)).ToList();
            if (kept.Count == loaded.Entries.Count)
                return loaded;

            if (kept.Count == 0)
                throw new InvalidOperationException(
                    $"Every registration on '{loaded.SheetName}' is already in a group, so there is nothing left to allocate.");

            return loaded with { Entries = kept, InGroupsRows = loaded.InGroupsRows + (loaded.Entries.Count - kept.Count) };
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
    /// One pair in the pool and where it stands. A pair is in one of three
    /// states:
    ///   - free: nobody has it;
    ///   - held: <c>HeldBy</c> was shown it when they opened the tab (or pressed
    ///     Next), and nobody else is offered it until the hold lapses (see
    ///     RegistrationPool.HoldFor) or they move on;
    ///   - taken: <c>AllocatedTo</c> copied it, and it is theirs for good.
    /// Both ids are the opaque ones browsers generate for themselves (see the
    /// allocation controller).
    /// </summary>
    public record PoolEntry(
        string RegNumber,
        string PostCode,
        string? AllocatedTo = null,
        DateTimeOffset? AllocatedAt = null,
        string? HeldBy = null,
        DateTimeOffset? HeldAt = null)
    {
        /// <summary>True once someone has copied it - it can never be offered again.</summary>
        [System.Text.Json.Serialization.JsonIgnore]
        public bool IsAllocated => AllocatedTo != null;
    }

    public enum ClaimOutcome
    {
        /// <summary>It was available and is now taken by the claimant.</summary>
        Claimed,
        /// <summary>It was already taken by the claimant (copying the second field, say) - nothing changed.</summary>
        AlreadyYours,
        /// <summary>It is taken by somebody else, or (after the claimant's own hold lapsed) held by somebody else.</summary>
        TakenByOther,
        /// <summary>It isn't in the pool (the pool was reloaded without it).</summary>
        NotFound,
    }

    /// <summary>What a reload of the pool did to the existing allocations.</summary>
    public record PoolReplaceResult(int Total, int Added, int StillAllocated, int DroppedAllocated);

    /// <summary>
    /// The allocation rules, with no I/O: an ordered list of pairs, each free,
    /// held for one claimant or taken by one, and the things anyone can do -
    /// open the tab (which holds the first available pair for them), press
    /// Next (release the held pair and hold the next one), copy (take the pair
    /// for good), or have the whole list reloaded.
    ///
    /// Why a hold as well as a taking: opening the tab must keep two people
    /// from being shown, and so racing for, the same pair - but someone who
    /// opens the tab and wanders off must not block a pair indefinitely, so a
    /// hold lapses after <see cref="HoldFor"/>. Only copying is permanent.
    ///
    /// NOT thread-safe by design: the caller (UploaderService's
    /// RegistrationPoolStore) loads, changes and saves it under one lock, which
    /// is what makes "once copied, it can't go to anyone else" hold when two
    /// people act at the same moment. Every method that can change state takes
    /// the current time as a parameter, so the tests need no clock.
    /// </summary>
    public sealed class RegistrationPool
    {
        /// <summary>How long a hold lasts if nobody renews it by opening the tab again or pressing Next.</summary>
        public static readonly TimeSpan DefaultHoldFor = TimeSpan.FromMinutes(15);

        private List<PoolEntry> _entries;

        public RegistrationPool(IEnumerable<PoolEntry>? entries = null, string source = "", DateTimeOffset? loadedAt = null, TimeSpan? holdFor = null)
        {
            _entries = entries?.ToList() ?? new List<PoolEntry>();
            Source = source;
            LoadedAt = loadedAt;
            HoldFor = holdFor ?? DefaultHoldFor;
        }

        /// <summary>The file the pairs were last loaded from (for the log and the uploader's confirmation).</summary>
        public string Source { get; private set; }

        public DateTimeOffset? LoadedAt { get; private set; }

        public TimeSpan HoldFor { get; }

        public IReadOnlyList<PoolEntry> Entries => _entries;

        public int Total => _entries.Count;

        /// <summary>How many have not been taken - held ones still count, they can lapse.</summary>
        public int Remaining => _entries.Count(e => !e.IsAllocated);

        public bool AllAllocated => _entries.Count > 0 && Remaining == 0;

        private bool IsLiveHold(PoolEntry e, DateTimeOffset now) =>
            e.HeldBy != null && e.HeldAt != null && e.HeldAt.Value + HoldFor > now;

        private bool HeldByAnother(PoolEntry e, string claimant, DateTimeOffset now) =>
            IsLiveHold(e, now) && e.HeldBy != claimant;

        /// <summary>Not taken, and not held for somebody else right now.</summary>
        private bool AvailableTo(PoolEntry e, string claimant, DateTimeOffset now) =>
            !e.IsAllocated && !HeldByAnother(e, claimant, now);

        /// <summary>
        /// Holds entry <paramref name="index"/> for the claimant, letting go of
        /// any other (untaken) pair they were holding - a person holds one at a time.
        /// </summary>
        private PoolEntry HoldEntry(int index, string claimant, DateTimeOffset now)
        {
            for (int i = 0; i < _entries.Count; i++)
            {
                if (i != index && !_entries[i].IsAllocated && _entries[i].HeldBy == claimant)
                    _entries[i] = _entries[i] with { HeldBy = null, HeldAt = null };
            }

            var held = _entries[index] with { HeldBy = claimant, HeldAt = now };
            _entries[index] = held;
            return held;
        }

        /// <summary>
        /// What a browser is shown when it opens the tab, and the pair is HELD
        /// for it: the pair it is already holding (renewed), otherwise the first
        /// available one. Null when nothing is available - everything is taken,
        /// or what is left is held by other people just now.
        /// </summary>
        public PoolEntry? Open(string claimant, DateTimeOffset now)
        {
            var own = _entries.FindIndex(e => !e.IsAllocated && e.HeldBy == claimant && IsLiveHold(e, now));
            if (own >= 0)
                return HoldEntry(own, claimant, now);

            var first = _entries.FindIndex(e => AvailableTo(e, claimant, now));
            return first < 0 ? null : HoldEntry(first, claimant, now);
        }

        /// <summary>
        /// The first available pair after <paramref name="afterRegNumber"/> in list
        /// order, wrapping round to the top, held for the claimant in place of
        /// the one they were holding (which goes back to the pool, so a pair
        /// someone skips comes round again). With no <paramref name="afterRegNumber"/>
        /// (or one that isn't in the list) it starts from the top. Null, and
        /// nothing changed, when nothing is available.
        /// </summary>
        public PoolEntry? Next(string? afterRegNumber, string claimant, DateTimeOffset now)
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
                var index = (start + i) % _entries.Count;
                if (AvailableTo(_entries[index], claimant, now))
                    return HoldEntry(index, claimant, now);
            }

            return null;
        }

        /// <summary>
        /// Takes the pair for the claimant for good - what pressing Copy does.
        /// Taking one already theirs is harmless (copying the postcode after the
        /// registration number); one taken by somebody else is refused, as is
        /// one now held for somebody else (the claimant's own hold lapsed and
        /// another person was shown it since).
        /// </summary>
        public (ClaimOutcome Outcome, PoolEntry? Entry) Claim(string regNumber, string claimant, DateTimeOffset now)
        {
            var at = _entries.FindIndex(e => e.RegNumber == regNumber);
            if (at < 0)
                return (ClaimOutcome.NotFound, null);

            var entry = _entries[at];
            if (entry.IsAllocated)
            {
                return entry.AllocatedTo == claimant
                    ? (ClaimOutcome.AlreadyYours, entry)
                    : (ClaimOutcome.TakenByOther, entry);
            }

            if (HeldByAnother(entry, claimant, now))
                return (ClaimOutcome.TakenByOther, entry);

            var taken = entry with { AllocatedTo = claimant, AllocatedAt = now, HeldBy = null, HeldAt = null };
            _entries[at] = taken;
            return (ClaimOutcome.Claimed, taken);
        }

        /// <summary>
        /// Lets go of every taking and every hold, so each pair in the list is
        /// available again - the list itself (and its order) is untouched. Returns
        /// how many takings were undone, for the log and the confirmation.
        /// </summary>
        public int ClearAll()
        {
            int cleared = _entries.Count(e => e.IsAllocated);

            for (int i = 0; i < _entries.Count; i++)
            {
                var e = _entries[i];
                if (e.AllocatedTo != null || e.AllocatedAt != null || e.HeldBy != null || e.HeldAt != null)
                    _entries[i] = e with { AllocatedTo = null, AllocatedAt = null, HeldBy = null, HeldAt = null };
            }

            return cleared;
        }


        /// <summary>
        /// Replaces the list with a freshly read one (a new upload), keeping
        /// every taking and every hold for a reg number that is still in it -
        /// reloading must never hand out something already given away. A taken
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
