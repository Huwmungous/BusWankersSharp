using System.Security.Claims;
using System.Text.RegularExpressions;
using Autofills.Common;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Autofills.UploaderService.Controllers;

/// <summary>
/// The Registrations tab: hands out (registration number, postcode) pairs from
/// the compiled spreadsheet's "Unique Reg Numbers" sheet, each to one person only.
///
/// A pair goes through two stages. HELD: opening the tab (or pressing Next)
/// holds the first available pair for that browser, so nobody else is shown it
/// meanwhile - the hold lapses after Registrations:HoldMinutes (default 15) if
/// the person wanders off. TAKEN: pressing either Copy button takes the pair
/// for good, and it is never offered to anyone else.
///
///   POST /open   - the tab was opened: hold (or keep holding) the first
///                  available pair for this browser and return it
///   POST /next   - release the held pair and hold the next available one
///                  after it (wrapping)
///   POST /claim  - the Copy button: take the pair for this browser if it is
///                  still its to take; if somebody else has it, say so and
///                  hold the next available pair instead
///   POST /clear  - (CampDad only) make every pair available again
///   POST /load   - (uploaders only) read the "Unique Reg Numbers" sheet of the
///                  compiled workbook into the pool, keeping every taking
///
/// Who is "a user"? Every BusWankers person signs in as the same single
/// Keycloak identity (see UploadServiceController), so the token can't tell
/// them apart. Each browser therefore makes up a random id for itself and
/// sends it as <c>claimant</c> in the JSON body, not a header, so nothing
/// depends on how the auth fetch interceptor treats headers. It is a way of
/// telling browsers apart, not a security boundary: clearing site data starts
/// a new "person" (and what the old one copied stays taken).
///
/// Everything needs a signed-in user, like the rest of the service; only /load
/// needs the "uploaders" group. All changes go through RegistrationPoolStore's
/// lock, which is what makes two people pressing Copy at once safe.
/// </summary>
[ApiController]
[Route("api/autofill/registrations")]
[Authorize]
public class RegistrationAllocationController : ControllerBase
{
    private const string HoldMinutesKey = "Registrations:HoldMinutes";
    private const string ClearAllUserKey = "Registrations:ClearAllUser";
    private const string DefaultClearAllUser = "CampDad";

    private static readonly Regex ClaimantShape = new("^[A-Za-z0-9-]{8,64}$", RegexOptions.Compiled);

    private readonly ILogger<RegistrationAllocationController> _log;
    private readonly RegistrationPoolStore _pool;

    public RegistrationAllocationController(IConfiguration config, ILogger<RegistrationAllocationController> log)
    {
        _log = log;

        var minutes = config.GetValue<int?>(HoldMinutesKey);
        var holdFor = minutes is > 0 ? TimeSpan.FromMinutes(minutes.Value) : RegistrationPool.DefaultHoldFor;
        _pool = new RegistrationPoolStore(new AutofillStore(config, log), log, holdFor);
    }

    public sealed record OpenRequest(string? Claimant);

    [HttpPost("open")]
    public async Task<IActionResult> Open([FromBody] OpenRequest? body, CancellationToken ct)
    {
        if (!TryClaimant(body?.Claimant, "open", out var who, out var refusal))
            return refusal!;

        try
        {
            var state = await _pool.UseAsync(pool =>
                (ViewOf(pool, pool.Open(who, DateTimeOffset.UtcNow), who), true), ct);

            PoolLog.Shown(_log, Short(who), "open", state.Total, state.Remaining, state.Entry != null);
            return Ok(state);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Failure(ex, "open");
        }
    }

    public sealed record NextRequest(string? Claimant, string? After);

    [HttpPost("next")]
    public async Task<IActionResult> Next([FromBody] NextRequest? body, CancellationToken ct)
    {
        if (!TryClaimant(body?.Claimant, "next", out var who, out var refusal))
            return refusal!;

        try
        {
            var state = await _pool.UseAsync(pool =>
                (ViewOf(pool, pool.Next(body!.After, who, DateTimeOffset.UtcNow), who), true), ct);

            PoolLog.Shown(_log, Short(who), "next", state.Total, state.Remaining, state.Entry != null);
            return Ok(state);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Failure(ex, "next");
        }
    }

    public sealed record ClaimRequest(string? Claimant, string? RegNumber);

    [HttpPost("claim")]
    public async Task<IActionResult> Claim([FromBody] ClaimRequest? body, CancellationToken ct)
    {
        if (!TryClaimant(body?.Claimant, "claim", out var who, out var refusal))
            return refusal!;

        var regNumber = body!.RegNumber?.Trim();
        if (string.IsNullOrEmpty(regNumber))
        {
            PoolLog.Rejected(_log, "claim", "no registration number given");
            return BadRequest(new { error = "regNumber is required." });
        }

        try
        {
            var result = await _pool.UseAsync(pool =>
            {
                var now = DateTimeOffset.UtcNow;
                var (outcome, entry) = pool.Claim(regNumber, who, now);

                return outcome switch
                {
                    ClaimOutcome.Claimed =>
                        (new ClaimResult(true, null, ViewOf(pool, entry, who)), true),
                    ClaimOutcome.AlreadyYours =>
                        (new ClaimResult(true, null, ViewOf(pool, entry, who)), false),
                    // Somebody else has it (or a reload removed it): say so, and hold
                    // the next available pair for this browser instead - which is a
                    // change to the pool, so it is saved.
                    ClaimOutcome.TakenByOther =>
                        (new ClaimResult(false, "taken", ViewOf(pool, pool.Next(regNumber, who, now), who)), true),
                    _ =>
                        (new ClaimResult(false, "missing", ViewOf(pool, pool.Next(regNumber, who, now), who)), true),
                };
            }, ct);

            var outcomeName = result.Claimed ? "claimed-or-yours" : result.Reason ?? "refused";
            PoolLog.Claimed(_log, Short(who), outcomeName, result.State.Total, result.State.Remaining);
            if (result.Claimed && result.State.AllAllocated)
                PoolLog.PoolExhausted(_log, result.State.Total);

            return Ok(result);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Failure(ex, "claim");
        }
    }


    /// <summary>
    /// Read the compiled workbook's "Unique Reg Numbers" tab into the pool.
    /// Reloading is safe: every pair that has already been allocated stays
    /// allocated, new reg numbers are added as free, and the order follows the
    /// sheet.
    /// </summary>
    [HttpPost("load")]
    [Authorize(Policy = UploaderAuthorization.PolicyName)]
    [RequestSizeLimit(20_000_000)]
    public async Task<IActionResult> Load([FromForm] IFormFile? file, CancellationToken ct)
    {
        PoolLog.LoadRequested(_log, CallerName(), file?.FileName, file?.Length);

        if (file == null || file.Length == 0)
        {
            PoolLog.Rejected(_log, "load", "no file or an empty file");
            return BadRequest(new { error = "Upload the compiled spreadsheet (.xls or .xlsx)." });
        }

        PoolLoadResult loaded;
        try
        {
            await using var stream = file.OpenReadStream();
            loaded = ExcelFileHelper.ReadRegistrationPool(stream, file.FileName);
        }
        catch (InvalidOperationException ex)
        {
            PoolLog.Rejected(_log, "load", ex.Message);
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            PoolLog.Failed(_log, ex, "load");
            return StatusCode(500, new { error = "Failed to read the spreadsheet: " + ex.Message });
        }

        try
        {
            var replaced = await _pool.UseAsync(pool =>
                (pool.Replace(loaded.Entries, file.FileName, DateTimeOffset.UtcNow), true), ct);

            PoolLog.Loaded(_log, file.FileName, loaded.SheetName, replaced.Total, replaced.Added,
                replaced.StillAllocated, replaced.DroppedAllocated, loaded.SkippedRows, loaded.DuplicateRows);

            return Ok(new
            {
                sheet = loaded.SheetName,
                total = replaced.Total,
                added = replaced.Added,
                stillAllocated = replaced.StillAllocated,
                droppedAllocated = replaced.DroppedAllocated,
                skippedRows = loaded.SkippedRows,
                duplicateRows = loaded.DuplicateRows,
            });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Failure(ex, "load");
        }
    }

    /// <summary>
    /// Clear all: every pair in the pool becomes available again (takings and
    /// holds are all undone; the list stays loaded). Only the one permitted
    /// user - Registrations:ClearAllUser, "CampDad" unless configured otherwise -
    /// may do this; anyone else gets 403 whatever the page showed them. The
    /// name is the sign-in's preferred_username, compared without regard to case.
    /// </summary>
    [HttpPost("clear")]
    public async Task<IActionResult> Clear(CancellationToken ct)
    {
        var caller = CallerName();
        var permitted = _config[ClearAllUserKey];
        if (string.IsNullOrWhiteSpace(permitted))
            permitted = DefaultClearAllUser;

        if (!string.Equals(caller, permitted.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            PoolLog.ClearRefused(_log, caller);
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "Only " + permitted.Trim() + " can clear all the registrations." });
        }

        try
        {
            var cleared = 0;
            var state = await _pool.UseAsync(pool =>
            {
                cleared = pool.ClearAll();
                return (new PoolState(pool.Total > 0, pool.Total, pool.Remaining, pool.AllAllocated, false, null), true);
            }, ct);

            PoolLog.Cleared(_log, caller, state.Total, cleared);
            return Ok(new { cleared, state });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Failure(ex, "clear");
        }
    }

    // ---- shapes the page reads --------------------------------------------------

    /// <summary>
    /// One pair as the page sees it. Allocated = it has been taken (copied);
    /// Mine = it was taken by the asking browser. A pair that is neither is
    /// being HELD for the asking browser and becomes permanent when it copies.
    /// </summary>
    public sealed record EntryView(string RegNumber, string PostCode, bool Allocated, bool Mine);

    /// <summary>
    /// Loaded is false until a workbook has been loaded. AllAllocated is true
    /// only when there IS a pool and every pair in it has been taken - the page
    /// shows "All Registrations have been allocated" for that. Entry is null
    /// when there is nothing to show; HeldByOthers then says why - pairs remain
    /// but other people are holding them just now.
    /// </summary>
    public sealed record PoolState(bool Loaded, int Total, int Remaining, bool AllAllocated, bool HeldByOthers, EntryView? Entry);

    /// <summary>
    /// Reply to a claim. Claimed false means the pair was not given to this
    /// browser - Reason is "taken" (someone else holds it) or "missing" (it is
    /// no longer in the pool) - and State then holds the next free pair.
    /// </summary>
    public sealed record ClaimResult(bool Claimed, string? Reason, PoolState State);

    private static PoolState ViewOf(RegistrationPool pool, PoolEntry? entry, string claimant) =>
        new(
            pool.Total > 0,
            pool.Total,
            pool.Remaining,
            pool.AllAllocated,
            entry == null && pool.Remaining > 0,
            entry == null ? null : new EntryView(entry.RegNumber, entry.PostCode, entry.IsAllocated, entry.AllocatedTo == claimant));

    // ---- helpers ------------------------------------------------------------------

    private bool TryClaimant(string? raw, string route, out string claimant, out IActionResult? refusal)
    {
        claimant = raw?.Trim() ?? string.Empty;
        if (ClaimantShape.IsMatch(claimant))
        {
            refusal = null;
            return true;
        }

        PoolLog.Rejected(_log, route, "missing or malformed claimant id");
        refusal = BadRequest(new { error = "A browser id (claimant) of 8-64 letters, digits or hyphens is required." });
        return false;
    }

    private IActionResult Failure(Exception ex, string route)
    {
        PoolLog.Failed(_log, ex, route);
        return StatusCode(500, new { error = "Could not read or update the registration pool: " + ex.Message });
    }

    /// <summary>Enough of the browser id to follow one browser through the log.</summary>
    private static string Short(string claimant) => claimant.Length <= 8 ? claimant : claimant[..8];

    private string CallerName() =>
        User.FindFirstValue("preferred_username")
        ?? User.Identity?.Name
        ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? User.FindFirstValue("sub")
        ?? "unknown";
}
