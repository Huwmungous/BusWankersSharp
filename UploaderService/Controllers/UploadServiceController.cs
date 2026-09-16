using System.Security.Cryptography;
using System.Text;
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
///                        whatever was there for that sale. This is what the upload
///                        button at the top of the documentation page calls, and it
///                        is how the "live" autofill files get refreshed without a
///                        commit + frontend redeploy.
///
/// And two ways out, deliberately NOT password-gated (they're what the AutoFill
/// Options extension's Remote Import URL and the page's download button hit, and
/// the old static files under /buswankers/ were public too):
///   GET /files             - what's in the store (filename, size, last modified),
///                            so the page can mark sales with no file as empty
///   GET /files/{filename}  - the file itself
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
            var groups = ExcelFileHelper.ReadSheetGroups(stream, file.FileName, sheetName, maxInAGroup);

            var text = BusWankers.GenerateAutofillTextFromGroups(groups, maxInAGroup);
            var bytes = Encoding.UTF8.GetBytes(text);
            var downloadName = DownloadNameFor(sheetName);

            Response.Headers["X-Source-Sheet"] = sheetName.Trim();
            Response.Headers["X-Group-Count"] = groups.Count.ToString();

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
                var groups = ExcelFileHelper.ReadSheetGroups(sheetStream, file.FileName, sheetName, maxInAGroup);
                var text = BusWankers.GenerateAutofillTextFromGroups(groups, maxInAGroup);
                var stored = await _store.SaveAsync(filename, Encoding.UTF8.GetBytes(text), ct);

                _log.LogInformation("Ingested sheet '{Sheet}' -> {File} ({Groups} groups, {Bytes} bytes) from {Upload}",
                    sheetName, stored.Filename, groups.Count, stored.Size, file.FileName);

                results.Add(new IngestResult(sheetName.Trim(), filename, IngestStatus.Ok, groups.Count, null));
            }
            catch (EmptySheetException ex)
            {
                // A sale tab with its headings but nobody on it yet - the normal
                // state of the Resale tabs until the resale is announced. Not an
                // error, and it does NOT touch whatever file is already stored for
                // that sale.
                results.Add(new IngestResult(sheetName.Trim(), filename, IngestStatus.Empty, 0, ex.Message));
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

        // 400 only when nothing was ingested AND something actually failed; a
        // workbook whose sale tabs are all still empty is a successful no-op.
        if (results.All(r => r.Status != IngestStatus.Ok) && results.Any(r => r.Status == IngestStatus.Failed))
            return BadRequest(new { error = "No sheet could be ingested.", results });

        return Ok(new { results });
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

    /// <summary>Per-sheet outcome of POST /ingest. Serialised as the strings "Ok" / "Empty" / "Failed" (the frontend compares case-insensitively).</summary>
    [System.Text.Json.Serialization.JsonConverter(typeof(System.Text.Json.Serialization.JsonStringEnumConverter<IngestStatus>))]
    public enum IngestStatus { Ok, Empty, Failed }

    /// <summary>
    /// Per-sheet outcome of POST /ingest. <c>Ok</c> is kept alongside <c>Status</c>
    /// so the response stays backward compatible with the first frontend build.
    /// </summary>
    public sealed record IngestResult(string Sheet, string Filename, IngestStatus Status, int Groups, string? Error)
    {
        public bool Ok => Status == IngestStatus.Ok;
    }
}
