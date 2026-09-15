using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Autofills.Common;
using Microsoft.AspNetCore.Mvc;

namespace Autofills.UploaderService.Controllers;

/// <summary>
/// Upload a Glastonbury registration spreadsheet, pick a sale (one of the workbook's
/// own sheets - every sheet is a sale except "Starting Lineup" and "URL"), get back
/// the AutoFill-Options-format autofill file for it. Nothing is written to disk; the
/// workbook is read straight out of the uploaded stream and the result streamed
/// straight back.
///
/// Two-step flow, because the list of sales isn't known until a file is uploaded:
///   1. POST /sheets    - file + password -> the sale sheets in this workbook
///   2. POST /generate  - file + password + the exact sheet name chosen -> the file
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

    public UploadServiceController(IConfiguration config)
    {
        _config = config;
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
                return BadRequest(new { error = "No sale sheets found in this file (only 'Starting Lineup' / 'URL')." });

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

        var maxInAGroup = _config.GetValue<int?>($"GroupSizes:{sheetName.Trim()}") ?? BusWankers.DEFAULT_MAX_IN_A_GROUP;

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
    /// Coach and General keep the exact filenames the rest of the site already
    /// hardcodes/documents (the Documentation page's download links, and its "NB:
    /// filename is different..." note used to say) - "bw_autofill.csv" /
    /// "g_autofill.csv". Every other sheet (Resale - Coach, Resale - General, Demo,
    /// or any sheet added later) gets a generic slug of its own name, so a brand new
    /// sale sheet works without a code change here.
    /// </summary>
    private static string DownloadNameFor(string sheetName)
    {
        var trimmed = sheetName.Trim();

        if (string.Equals(trimmed, "Coach", StringComparison.OrdinalIgnoreCase))
            return "bw_autofill.csv";
        if (string.Equals(trimmed, "General", StringComparison.OrdinalIgnoreCase))
            return "g_autofill.csv";

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
}
