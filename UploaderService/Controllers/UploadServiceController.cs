using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Autofills.Common;
using Microsoft.AspNetCore.Mvc;

namespace Autofills.UploaderService.Controllers;

/// <summary>
/// Upload a Glastonbury registration spreadsheet, pick a sale (one of the workbook's
/// own sheets - every sheet is a sale except "Starting Lineup" and "URL"), get back
/// the AutoFill-Options-format autofill file for it.
///
/// Two ways in, both password-gated:
///   1. POST /sheets    - file + password -> the sale sheets in this workbook
///      POST /generate  - file + password + the exact sheet name chosen -> the file,
///                        streamed straight back to the browser. Nothing touches disk.
///   2. POST /ingest    - file + password -> EVERY sale sheet in the workbook is
///                        generated and written into the AutofillStore, replacing
///                        whatever was there for that sale (and an EMPTIED sale
///                        sheet removes the file that was there). This is what the
///                        upload button at the top of the documentation page calls,
///                        and it is how the "live" autofill files get refreshed
///                        without a commit + frontend redeploy. The same ingest
///                        reads the master roster ("Glasto nnnn") into
///                        running_order.json, which is where the page gets the
///                        festival year and the running-order list.
///
/// And two ways out, deliberately NOT password-gated (they're what the AutoFill
/// Options extension's Remote Import URL and the page's download button hit, and
/// the old static files under /buswankers/ were public too):
///   GET /files             - what's in the store (filename, size, last modified),
///                            so the page can mark sales with no file as empty
///   GET /files/{filename}  - the file itself
///   GET /running-order     - the roster from the last ingest (year + people), or 404
///
/// Sits behind a shared password (see IsPasswordCorrect) - simple, deliberate gate
/// against a stranger stumbling on the URL, not a real auth system. It's enforced
/// here server-side (not just hidden in the frontend JS), so it's at least a real
/// gate rather than pure obscurity - but there's no per-user accounts, no rate
/// limiting, and the password lives in plain text in appsettings.json. Fine for a
/// personal tool with a small, trusted group of users; don't treat it as more than
/// that.
/// </summary>
[ApiController]
[Route("api/autofill")]
public class UploadServiceController : ControllerBase
{
    private readonly IConfiguration _config;
    private readonly ILogger<UploadServiceController> _log;
    private readonly AutofillStore _store;

    public UploadServiceController(IConfiguration config, ILogger<UploadServiceController> log)
    {
        _config = config;
        _log = log;
        // Built here rather than DI-registered: Program.cs bootstraps through
        // IFGlobal's ServiceFactory, and the store is cheap (it's a directory
        // path and a regex), so there's nothing to gain from a singleton.
        _store = new AutofillStore(config);
    }

    [HttpPost("sheets")]
    [RequestSizeLimit(20_000_000)]
    public async Task<IActionResult> Sheets([FromForm] IFormFile? file, [FromForm] string? password)
    {
        if (!IsPasswordCorrect(password))
            return Unauthorized(new { error = "Incorrect password." });

        if (file == null || file.Length == 0)
            return BadRequest(new { error = "Upload a spreadsheet (.xls or .xlsx)." });

        try
        {
            await using var stream = file.OpenReadStream();
            var sheets = ExcelFileHelper.ListSaleSheets(stream, file.FileName);

            if (sheets.Count == 0)
                return BadRequest(new { error = "No sale sheets found in this file - a sale sheet has 'Group', 'Reg Number' and 'Postcode' headings in row 1." });

            return Ok(new { sheets });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = "Failed to read the spreadsheet: " + ex.Message });
        }
    }

    [HttpPost("generate")]
    [RequestSizeLimit(20_000_000)]
    public async Task<IActionResult> Generate(
        [FromForm] IFormFile? file,
        [FromForm] string? sheetName,
        [FromForm] string? password)
    {
        if (!IsPasswordCorrect(password))
            return Unauthorized(new { error = "Incorrect password." });

        if (file == null || file.Length == 0)
            return BadRequest(new { error = "Upload a spreadsheet (.xls or .xlsx)." });

        if (string.IsNullOrWhiteSpace(sheetName))
            return BadRequest(new { error = "sheetName is required - call /sheets first to get the list for this file." });

        var maxInAGroup = MaxInAGroupFor(sheetName);

        try
        {
            await using var stream = file.OpenReadStream();
            var (groups, warnings) = ExcelFileHelper.ReadSheetGroups(stream, file.FileName, sheetName, maxInAGroup);

            var text = BusWankers.GenerateAutofillTextFromGroups(groups, maxInAGroup, SaleFolderLabelFor(sheetName));
            var bytes = Encoding.UTF8.GetBytes(text);
            var downloadName = DownloadNameFor(sheetName);

            Response.Headers["X-Source-Sheet"] = sheetName.Trim();
            Response.Headers["X-Group-Count"] = groups.Count.ToString();
            // Lead Booker warnings (2026-09-18) - this route isn't used by the
            // page any more (see the class doc comment), so there's no UI to
            // show them in; a count header is enough for anyone still using
            // /generate directly to notice something's worth checking.
            Response.Headers["X-Lead-Booker-Warning-Count"] = warnings.Count.ToString();


            return File(bytes, "text/csv", downloadName);
        }
        catch (InvalidOperationException ex)
        {
            // Anything ReadSheetGroups/SheetRegistrationReader threw deliberately -
            // no matching sheet, no header row, a group over the size limit. These
            // messages are written to be shown directly to the person uploading.
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = "Failed to process the spreadsheet: " + ex.Message });
        }
    }

    /// <summary>
    /// Ingest a whole workbook: every sale sheet in it becomes (or replaces) the
    /// live autofill file for that sale. One bad sheet doesn't sink the rest -
    /// each sheet's outcome is reported individually, and the response is 200 as
    /// long as at least one sheet went in (207-style "partial" is signalled by
    /// the per-sheet "ok" flags rather than the status code, to keep the
    /// frontend's handling simple). A workbook where nothing ingests is a 400.
    /// </summary>
    [HttpPost("ingest")]
    [RequestSizeLimit(20_000_000)]
    public async Task<IActionResult> Ingest([FromForm] IFormFile? file, [FromForm] string? password, CancellationToken ct)
    {
        if (!IsPasswordCorrect(password))
            return Unauthorized(new { error = "Incorrect password." });

        if (file == null || file.Length == 0)
            return BadRequest(new { error = "Upload a spreadsheet (.xls or .xlsx)." });

        // The workbook is read once per sheet (ListSaleSheets, then ReadSheetGroups
        // for each), so buffer the bytes once. Each read gets its OWN MemoryStream
        // over those bytes: ExcelDataReader disposes the stream it was given when
        // the reader is disposed, so rewinding a single shared stream throws
        // "Cannot access a closed Stream" on the second read - which made every
        // sheet fail and the whole ingest come back as a 400 (2026-09-16).
        byte[] workbookBytes;
        using (var buffer = new MemoryStream())
        {
            await file.CopyToAsync(buffer, ct);
            workbookBytes = buffer.ToArray();
        }

        List<string> sheets;
        try
        {
            using var listStream = new MemoryStream(workbookBytes, writable: false);
            sheets = ExcelFileHelper.ListSaleSheets(listStream, file.FileName);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = "Failed to read the spreadsheet: " + ex.Message });
        }

        if (sheets.Count == 0)
            return BadRequest(new { error = "No sale sheets found in this file - a sale sheet has 'Group', 'Reg Number' and 'Postcode' headings in row 1." });

        var results = new List<IngestResult>(sheets.Count);
        foreach (var sheetName in sheets)
        {
            var filename = DownloadNameFor(sheetName);
            var maxInAGroup = MaxInAGroupFor(sheetName);
            try
            {
                using var sheetStream = new MemoryStream(workbookBytes, writable: false);
                var (groups, warnings) = ExcelFileHelper.ReadSheetGroups(sheetStream, file.FileName, sheetName, maxInAGroup);

                var saleFolderLabel = SaleFolderLabelFor(sheetName);
                var text = BusWankers.GenerateAutofillTextFromGroups(groups, maxInAGroup, saleFolderLabel);
                var stored = await _store.SaveAsync(filename, Encoding.UTF8.GetBytes(text), ct);

                // Same groups, written straight to JSON alongside the CSV - see
                // AutofillStore.SaveGroupsAsync and DownloadGroups below. This is
                // what the bookmarklet fetches live at click time, so it never has
                // to parse CSV (or duplicate BusWankers.GenerateAutofillTextFromGroups'
                // slot-padding logic) in its own JavaScript. GroupData.Name carries
                // the same sale-prefixed "Coach Group-A" as the CSV profile above -
                // it's not otherwise used by the frontend (which prefixes group.label
                // with its own SALE_INFO[...].folderLabel for display), but it's kept
                // in step since ToGroupsDocument's own doc comment says this shape
                // mirrors the CSV parser's.
                var groupsJson = JsonSerializer.SerializeToUtf8Bytes(ToGroupsDocument(groups, saleFolderLabel), JsonOptions);
                await _store.SaveGroupsAsync(filename, groupsJson, ct);

                _log.LogInformation("Ingested sheet '{Sheet}' -> {File} ({Groups} groups, {Bytes} bytes) from {Upload}",
                    sheetName, stored.Filename, groups.Count, stored.Size, file.FileName);
                results.Add(new IngestResult(sheetName.Trim(), filename, IngestStatus.Ok, groups.Count, null, Warnings: warnings));
            }
            catch (EmptySheetException ex)
            {
                // A sale tab with its headings but nobody on it - the normal state
                // of the Resale tabs until the resale is announced, or a sale that
                // has been cleared out. Not an error, but the spreadsheet is the
                // source of truth: an empty sheet means NO autofill file for that
                // sale, so any file previously stored for it is removed rather than
                // left advertising last time's people (2026-09-16).
                bool cleared;
                try
                {
                    cleared = _store.Delete(filename);
                    _store.DeleteGroups(filename);
                }
                catch (Exception delEx)
                {
                    _log.LogError(delEx, "Clearing {File} for emptied sheet '{Sheet}' failed", filename, sheetName);
                    results.Add(new IngestResult(sheetName.Trim(), filename, IngestStatus.Failed, 0,
                        "The sheet is empty but the existing file could not be removed: " + delEx.Message));
                    continue;
                }

                if (cleared)
                    _log.LogInformation("Sheet '{Sheet}' is empty - removed {File} from the store (from {Upload})",
                        sheetName, filename, file.FileName);

                results.Add(new IngestResult(sheetName.Trim(), filename, IngestStatus.Empty, 0, ex.Message, cleared));
            }
            catch (InvalidOperationException ex)
            {
                // Deliberate, user-facing message from the reader - report it against
                // this sheet and carry on with the next.
                results.Add(new IngestResult(sheetName.Trim(), filename, IngestStatus.Failed, 0, ex.Message));
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Ingest of sheet '{Sheet}' from {Upload} failed", sheetName, file.FileName);
                results.Add(new IngestResult(sheetName.Trim(), filename, IngestStatus.Failed, 0, "Failed to process this sheet: " + ex.Message));
            }
        }

        var runningOrder = await IngestRosterAsync(workbookBytes, file.FileName, ct);

        // 400 only when nothing was ingested AND something actually failed; a
        // workbook whose sale tabs are all still empty is a successful no-op.
        if (results.All(r => r.Status != IngestStatus.Ok) && results.Any(r => r.Status == IngestStatus.Failed))
            return BadRequest(new { error = "No sheet could be ingested.", results, runningOrder });

        return Ok(new { results, runningOrder });
    }

    /// <summary>
    /// The roster half of an ingest. The "Glasto nnnn" sheet (or the older
    /// "Starting Lineup") becomes running_order.json in the store; an emptied
    /// roster sheet removes it, mirroring what an emptied sale sheet does to its
    /// autofill file. A workbook with no roster sheet leaves whatever running
    /// order is already stored alone - a sales-only workbook shouldn't wipe the
    /// year off the page. Never throws: a roster problem is reported in the
    /// result, not allowed to fail the sales that already went in.
    /// </summary>
    private async Task<RunningOrderResult> IngestRosterAsync(byte[] workbookBytes, string uploadName, CancellationToken ct)
    {
        Roster? roster;
        try
        {
            using var rosterStream = new MemoryStream(workbookBytes, writable: false);
            roster = ExcelFileHelper.ReadRoster(rosterStream, uploadName);
        }
        catch (EmptySheetException ex)
        {
            bool cleared;
            try
            {
                cleared = _store.DeleteRunningOrder();
            }
            catch (Exception delEx)
            {
                _log.LogError(delEx, "Clearing the running order for an emptied roster sheet failed (from {Upload})", uploadName);
                return new RunningOrderResult(IngestStatus.Failed, null, null, 0, false,
                    "The roster sheet is empty but the stored running order could not be removed: " + delEx.Message);
            }

            if (cleared)
                _log.LogInformation("Roster sheet is empty - removed {File} from the store (from {Upload})",
                    AutofillStore.RunningOrderFileName, uploadName);

            return new RunningOrderResult(IngestStatus.Empty, null, null, 0, cleared, ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            return new RunningOrderResult(IngestStatus.Failed, null, null, 0, false, ex.Message);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Reading the roster sheet from {Upload} failed", uploadName);
            return new RunningOrderResult(IngestStatus.Failed, null, null, 0, false, "Failed to read the roster sheet: " + ex.Message);
        }

        if (roster == null)
            return new RunningOrderResult(IngestStatus.Skipped, null, null, 0, false, "No 'Glasto nnnn' roster sheet in this workbook - the stored running order is unchanged.");

        try
        {
            var document = new RunningOrderDocument(
                roster.Year,
                roster.SheetName,
                DateTimeOffset.UtcNow,
                roster.Entries.Select(e => new RunningOrderEntry(e.RegistrationId, e.FirstName, e.LastName, e.DisplayName)).ToList());

            var json = JsonSerializer.SerializeToUtf8Bytes(document, JsonOptions);
            await _store.SaveRunningOrderAsync(json, ct);

            _log.LogInformation("Ingested roster sheet '{Sheet}' -> {File} (year {Year}, {People} people) from {Upload}",
                roster.SheetName, AutofillStore.RunningOrderFileName, roster.Year, roster.Entries.Count, uploadName);

            return new RunningOrderResult(IngestStatus.Ok, roster.Year, roster.SheetName, roster.Entries.Count, false, null);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Saving the running order from {Upload} failed", uploadName);
            return new RunningOrderResult(IngestStatus.Failed, roster.Year, roster.SheetName, 0, false, "Failed to save the running order: " + ex.Message);
        }
    }

    /// <summary>
    /// The roster from the last ingest - festival year plus everyone on the
    /// "Glasto nnnn" sheet in name order. Public like the autofill files (it's
    /// the same names and reg numbers those already carry). 404 until a workbook
    /// with a roster sheet has been ingested. Cache-Control: no-cache so a fresh
    /// ingest is what the page shows.
    /// </summary>
    [HttpGet("running-order")]
    public IActionResult RunningOrder()
    {
        var path = _store.RunningOrderPath;
        if (path == null)
            return NotFound(new { error = "No roster sheet has been ingested yet." });

        Response.Headers.CacheControl = "no-cache";
        return PhysicalFile(path, "application/json");
    }

    /// <summary>What's in the store right now - the frontend uses this to mark empty sales.</summary>
    [HttpGet("files")]
    public IActionResult Files()
    {
        try
        {
            return Ok(new { files = _store.List() });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Listing the autofill store at {Dir} failed", _store.Directory);
            return StatusCode(500, new { error = "Failed to list the autofill files: " + ex.Message });
        }
    }

    /// <summary>
    /// The live autofill file for a sale. Public, like the static files it replaces:
    /// the AutoFill Options extension fetches this URL directly (via holly's nginx,
    /// which rewrites the documented https://longmanrd.net/buswankers/{filename}
    /// onto this route - see ops/nginx/buswankers.inc). Cache-Control: no-cache so a
    /// freshly ingested file is what the extension gets, not last week's copy.
    /// </summary>
    [HttpGet("files/{filename}")]
    public IActionResult Download(string filename)
    {
        if (!AutofillStore.IsSafeFileName(filename))
            return BadRequest(new { error = "Not a valid autofill filename." });

        var path = _store.PathOf(filename);
        if (path == null)
            return NotFound(new { error = $"No autofill file '{filename}' has been ingested yet." });

        Response.Headers.CacheControl = "no-cache";
        return PhysicalFile(path, "text/csv", filename);
    }

    /// <summary>
    /// The same sale's groups, structured, as JSON - see AutofillStore.SaveGroupsAsync
    /// and ToGroupsDocument. Public and no-cache for the same reason as Download
    /// above, but this route exists for a different caller: it's what the
    /// bookmarklet ITSELF fetches, live, at the moment someone clicks it -
    /// from whatever page happens to be open then (the actual registration
    /// page, on a domain that isn't known until sale day - see
    /// bookmarkletSource/FILL_SOURCE in ReactApp/src/bookmarklet.js), not from
    /// this app. That works cross-origin with no changes here: the service's
    /// CORS policy already allows any origin (see the comment in Program.cs).
    /// A bookmarklet whose live fetch fails for any reason (offline, blocked
    /// by the registration page's own CSP, this route 404ing because nothing's
    /// been re-ingested since the bookmark was made) falls back to the data
    /// baked into it when it was generated, so this being unreachable is a
    /// degraded experience, never a broken one.
    /// </summary>
    [HttpGet("files/{filename}/groups")]
    public IActionResult DownloadGroups(string filename)
    {
        if (!AutofillStore.IsSafeFileName(filename))
            return BadRequest(new { error = "Not a valid autofill filename." });

        var path = _store.PathOfGroups(filename);
        if (path == null)
            return NotFound(new { error = $"No group data for '{filename}' has been ingested yet." });

        Response.Headers.CacheControl = "no-cache";
        return PhysicalFile(path, "application/json");
    }

    private int MaxInAGroupFor(string sheetName) =>
        _config.GetValue<int?>($"GroupSizes:{sheetName.Trim()}") ?? BusWankers.DEFAULT_MAX_IN_A_GROUP;

    /// <summary>
    /// The live autofill filename for a sale sheet. The five known sales have
    /// fixed, readable names (2026-09-16, replacing the historical bw_/g_
    /// abbreviations and the sheet-order slugs):
    ///   Coach            -> coach_autofill.csv
    ///   General          -> general_autofill.csv
    ///   Resale - Coach   -> coach_resale_autofill.csv
    ///   Resale - General -> general_resale_autofill.csv
    ///   Demo             -> demo_autofill.csv
    /// Any other sale sheet gets a slug of its own name, so a brand new sale tab
    /// still works without a code change here. Whatever this returns must be
    /// accepted by AutofillStore.IsSafeFileName - keep the two in step, and keep
    /// the frontend's SALE_INFO (DocumentationSection.jsx) in step with this
    /// table, since that's what the dropdown matches on.
    /// </summary>
    private static readonly Dictionary<string, string> KnownSaleFilenames =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["Coach"] = "coach_autofill.csv",
            ["General"] = "general_autofill.csv",
            ["Resale - Coach"] = "coach_resale_autofill.csv",
            ["Resale - General"] = "general_resale_autofill.csv",
            ["Demo"] = "demo_autofill.csv",
        };

    internal static string DownloadNameFor(string sheetName)
    {
        var trimmed = sheetName.Trim();

        if (KnownSaleFilenames.TryGetValue(trimmed, out var known))
            return known;

        var slug = Regex.Replace(trimmed.ToLowerInvariant(), "[^a-z0-9]+", "_").Trim('_');
        return string.IsNullOrEmpty(slug) ? "autofill.csv" : $"{slug}_autofill.csv";
    }

    /// <summary>
    /// The short, sale-qualifying label baked into every group's profile name in
    /// the generated autofill CSV (see BusWankers.GenerateAutofillTextFromGroups)
    /// and the live groups JSON (see ToGroupsDocument) - "Coach", "General",
    /// "Coach Resale", "General Resale" - so a group is never just "Group A" with
    /// no way to tell which sale it belongs to. MUST be kept in step with the
    /// frontend's own SALE_INFO[...].folderLabel (ReactApp/src/saleInfo.js),
    /// which is the same string used for bookmark titles, folder names and
    /// on-page group headings (2026-09-18) - note the sheet names here read
    /// "Resale - Coach" (matching the workbook's own sheet name) while the
    /// display label reads "Coach Resale" (matching the frontend's convention),
    /// same as KnownSaleFilenames/DownloadNameFor above already do for
    /// filenames. A sheet not in the table (a brand new sale tab) falls back to
    /// its own trimmed name, same fallback shape as DownloadNameFor.
    /// </summary>
    private static readonly Dictionary<string, string> SaleFolderLabels =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["Coach"] = "Coach",
            ["General"] = "General",
            ["Resale - Coach"] = "Coach Resale",
            ["Resale - General"] = "General Resale",
            ["Demo"] = "Demo",
        };

    private static string SaleFolderLabelFor(string sheetName)
    {
        var trimmed = sheetName.Trim();
        return SaleFolderLabels.TryGetValue(trimmed, out var known) ? known : trimmed;
    }

    private bool IsPasswordCorrect(string? supplied)
    {
        var expected = _config["UploadPassword"];
        if (string.IsNullOrEmpty(expected))
            return false; // fail closed if the server isn't configured with a password

        var suppliedBytes = Encoding.UTF8.GetBytes(supplied ?? string.Empty);
        var expectedBytes = Encoding.UTF8.GetBytes(expected);

        // Fixed-time compare so response timing can't be used to guess the password
        // character by character. Lengths differing is itself timing-safe to check.
        if (suppliedBytes.Length != expectedBytes.Length)
            return false;

        return CryptographicOperations.FixedTimeEquals(suppliedBytes, expectedBytes);
    }

    /// <summary>
    /// Per-sheet outcome of POST /ingest. Serialised as the strings "Ok" / "Empty" /
    /// "Failed" / "Skipped" (the frontend compares case-insensitively). Skipped is
    /// only ever used for the roster (workbook had no roster sheet).
    /// </summary>
    [JsonConverter(typeof(JsonStringEnumConverter<IngestStatus>))]
    public enum IngestStatus { Ok, Empty, Failed, Skipped }

    /// <summary>
    /// Per-sheet outcome of POST /ingest. <c>Ok</c> is kept alongside <c>Status</c>
    /// so the response stays backward compatible with the first frontend build.
    /// <c>Cleared</c> is true for an Empty sheet whose previously stored file was
    /// removed by this ingest. <c>Warnings</c> (2026-09-18): non-fatal Lead
    /// Booker issues worth surfacing (see SheetRegistrationReader.ReadGroups) -
    /// always present (an empty list, never null) so the frontend doesn't have
    /// to null-check before reading its length.
    /// </summary>
    public sealed record IngestResult(string Sheet, string Filename, IngestStatus Status, int Groups, string? Error, bool Cleared = false, List<string>? Warnings = null)
    {
        public bool Ok => Status == IngestStatus.Ok;
        public List<string> Warnings { get; init; } = Warnings ?? new List<string>();
    }


    /// <summary>Roster outcome of POST /ingest, alongside the per-sale results.</summary>
    public sealed record RunningOrderResult(IngestStatus Status, int? Year, string? Sheet, int People, bool Cleared, string? Error);

    /// <summary>What running_order.json holds - also the body of GET /running-order.</summary>
    public sealed record RunningOrderDocument(int Year, string Sheet, DateTimeOffset GeneratedAt, List<RunningOrderEntry> Entries);

    public sealed record RunningOrderEntry(string RegNumber, string FirstName, string LastName, string Name);

    /// <summary>
    /// What a sale's groups sidecar holds - also the body of
    /// GET /files/{filename}/groups. Shape deliberately mirrors what the
    /// frontend's own CSV parser (parseAutofillCsv in bookmarklet.js) already
    /// produces from the same data (code/label/name/members with
    /// registrationId/postCode), so the bookmarklet's live-fetch path and the
    /// page's CSV-based path end up with identically-shaped group objects,
    /// even though the bytes on the wire are completely different.
    /// </summary>
    public sealed record GroupsDocument(List<GroupData> Groups);

    public sealed record GroupData(string Code, string Label, string Name, List<MemberData> Members);

    public sealed record MemberData(string RegistrationId, string PostCode);

    private static GroupsDocument ToGroupsDocument(List<RegistrationGroup> groups, string? saleLabel = null)
    {
        var data = new List<GroupData>(groups.Count);
        var namePrefix = string.IsNullOrWhiteSpace(saleLabel) ? string.Empty : $"{saleLabel} ";
        for (int i = 0; i < groups.Count; i++)
        {
            var g = groups[i];
            var members = g.Members.Select(m => new MemberData(m.RegistrationId, m.PostCode)).ToList();
            data.Add(new GroupData($"c{i + 1}", g.GroupLabel, $"{namePrefix}Group-{g.GroupLabel}", members));
        }
        return new GroupsDocument(data);
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };
}
