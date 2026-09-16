using Microsoft.AspNetCore.Mvc;

namespace Autofills.UploaderService.Controllers;

/// <summary>
/// GET /api/time - NTP-corrected UTC for the page's sale-day launcher.
///
/// Not password-gated: it gives away nothing but the time of day, and the
/// launcher needs it from every browser on every group member's machine.
///
/// The reply carries TWO server timestamps, both NTP-corrected:
///   receivedMs - when this request arrived
///   sentMs     - when the reply was built
/// so the page can do the NTP arithmetic over the HTTP hop exactly as this
/// service does it over UDP (see NtpClock): with its own send/receive times
/// t0/t3 and these as t1/t2, offset = ((t1 - t0) + (t2 - t3)) / 2. `nowMs` is
/// just `sentMs` under a friendlier name for anything that wants one number.
///
/// `source` is "ntp" when the offset came from a real NTP exchange, "local"
/// when every server failed and this is the box's own clock (the page warns).
/// `offsetMs` is how far THIS box's clock was from NTP - purely diagnostic.
/// </summary>
[ApiController]
[Route("api/time")]
public class TimeController : ControllerBase
{
    private readonly IConfiguration _config;
    private readonly ILogger<TimeController> _log;

    public TimeController(IConfiguration config, ILogger<TimeController> log)
    {
        _config = config;
        _log = log;
    }

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var receivedLocal = DateTimeOffset.UtcNow;
        var snapshot = await NtpClock.NowAsync(_config, _log, ct);
        var sentLocal = DateTimeOffset.UtcNow;

        var received = receivedLocal + snapshot.Offset;
        var sent = sentLocal + snapshot.Offset;

        _log.LogDebug("Time request answered: source {Source} via {Server}, offset {OffsetMs:0.0} ms, handling {HandlingMs:0.0} ms",
            snapshot.Source, snapshot.Server ?? "-", snapshot.Offset.TotalMilliseconds, (sentLocal - receivedLocal).TotalMilliseconds);

        Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
        Response.Headers.Pragma = "no-cache";
        Response.Headers.Expires = "0";

        return Ok(new
        {
            receivedMs = ToMs(received),
            sentMs = ToMs(sent),
            nowMs = ToMs(sent),
            source = snapshot.Source,
            server = snapshot.Server,
            offsetMs = Math.Round(snapshot.Offset.TotalMilliseconds, 3),
            roundTripMs = snapshot.RoundTripMs is { } rtt ? Math.Round(rtt, 3) : (double?)null,
            syncedAtUtc = snapshot.SyncedAtUtc,
            error = snapshot.Error,
        });
    }

    // Milliseconds since the Unix epoch with sub-millisecond precision kept,
    // the same scale as JavaScript's Date.now() so the page does no conversion.
    private static double ToMs(DateTimeOffset t) =>
        Math.Round((t - DateTimeOffset.UnixEpoch).Ticks / (double)TimeSpan.TicksPerMillisecond, 3);
}
