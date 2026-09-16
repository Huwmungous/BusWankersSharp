using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;

namespace Autofills.UploaderService;

/// <summary>
/// The service's idea of "true" UTC, corrected against a real NTP server.
///
/// Browsers can't speak NTP (it's UDP/123, and a page only gets HTTP), so the
/// sale-day launcher on the page can't ask a time server itself. Instead it
/// asks THIS service (GET /api/time - see TimeController) and this service does
/// the SNTP query on its behalf. The page then applies the same
/// round-trip-halving arithmetic to the HTTP hop, which gets a browser's clock
/// to within a few milliseconds of NTP - good enough to hit 09:00:00.000 on
/// sale morning rather than whatever the laptop's clock happens to think.
///
/// One SNTP exchange (RFC 4330): send a 48-byte client packet, read back the
/// server's receive (T2) and transmit (T3) timestamps, and with our own send
/// (T1) and receive (T4) times compute
///     offset = ((T2 - T1) + (T3 - T4)) / 2,   round trip = (T4 - T1) - (T3 - T2).
/// Several exchanges are made and the one with the shortest round trip wins -
/// the standard trick, since a short round trip bounds the offset error.
///
/// The result is cached (RefreshAfter) so a busy sale morning with a dozen
/// browsers each sampling /api/time eight times doesn't hammer the pool; the
/// corrected time itself is computed from the cached offset + the local clock,
/// which drifts far too slowly over a minute to matter. If every server fails
/// the local clock is returned unadjusted and the snapshot says so
/// (Source = "local") - the page shows that as a warning rather than silently
/// trusting it.
///
/// Configuration (appsettings.json "Ntp" section, all optional):
///   Servers      - list of host names to try in order (default: the UK pool,
///                  the global pool, Cloudflare)
///   TimeoutMs    - per-exchange wait for a reply (default 1500)
///   Exchanges    - exchanges per server, best round trip wins (default 3)
/// </summary>
public static class NtpClock
{
    public sealed record Snapshot(
        DateTimeOffset LocalUtc,
        TimeSpan Offset,
        string Source,
        string? Server,
        double? RoundTripMs,
        DateTimeOffset? SyncedAtUtc,
        string? Error)
    {
        /// <summary>The local clock corrected by the NTP offset (or uncorrected when Source is "local").</summary>
        public DateTimeOffset CorrectedUtc => LocalUtc + Offset;
    }

    private static readonly string[] DefaultServers = ["uk.pool.ntp.org", "pool.ntp.org", "time.cloudflare.com"];
    private static readonly TimeSpan RefreshAfter = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan RetryFailureAfter = TimeSpan.FromSeconds(10);
    private static readonly SemaphoreSlim Gate = new(1, 1);

    // Unix epoch expressed in NTP seconds (NTP counts from 1900-01-01).
    private const ulong NtpEpochOffsetSeconds = 2_208_988_800UL;

    private static Snapshot? _cached;
    private static DateTimeOffset _lastAttemptUtc = DateTimeOffset.MinValue;

    /// <summary>
    /// The current corrected time, refreshing the NTP offset when the cached one
    /// is older than RefreshAfter (or, after a failure, RetryFailureAfter).
    /// </summary>
    public static async Task<Snapshot> NowAsync(IConfiguration config, ILogger log, CancellationToken ct)
    {
        var cached = _cached;
        var nowUtc = DateTimeOffset.UtcNow;
        if (cached != null && !IsStale(cached, nowUtc))
            return cached with { LocalUtc = nowUtc };

        await Gate.WaitAsync(ct);
        try
        {
            // Re-check under the lock: another request may have refreshed while we waited.
            cached = _cached;
            nowUtc = DateTimeOffset.UtcNow;
            if (cached != null && !IsStale(cached, nowUtc))
                return cached with { LocalUtc = nowUtc };

            var fresh = await QueryAsync(config, log, ct);
            _lastAttemptUtc = DateTimeOffset.UtcNow;

            if (fresh.Source == "ntp")
            {
                _cached = fresh;
                return fresh;
            }

            // Every server failed. Keep an earlier good offset if we have one
            // (it's better than nothing for a good while), but flag the failure.
            if (cached != null && cached.Source == "ntp")
            {
                var stale = cached with { LocalUtc = DateTimeOffset.UtcNow, Error = fresh.Error };
                _cached = stale;
                return stale;
            }

            _cached = fresh;
            return fresh;
        }
        finally
        {
            Gate.Release();
        }
    }

    private static bool IsStale(Snapshot s, DateTimeOffset nowUtc)
    {
        if (s.Source != "ntp" || s.Error != null)
            return nowUtc - _lastAttemptUtc > RetryFailureAfter;
        return s.SyncedAtUtc == null || nowUtc - s.SyncedAtUtc.Value > RefreshAfter;
    }

    private static async Task<Snapshot> QueryAsync(IConfiguration config, ILogger log, CancellationToken ct)
    {
        var section = config.GetSection("Ntp");
        var servers = section.GetSection("Servers").Get<string[]>() is { Length: > 0 } configured ? configured : DefaultServers;
        var timeout = TimeSpan.FromMilliseconds(section.GetValue("TimeoutMs", 1500));
        var exchanges = Math.Clamp(section.GetValue("Exchanges", 3), 1, 8);

        string? lastError = null;
        foreach (var server in servers)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var best = await BestOfAsync(server, exchanges, timeout, log, ct);
                if (best == null)
                {
                    lastError = $"{server}: no reply within {timeout.TotalMilliseconds:0} ms";
                    log.LogWarning("NTP server {Server} gave no usable reply within {TimeoutMs} ms", server, timeout.TotalMilliseconds);
                    continue;
                }

                var (offset, roundTrip) = best.Value;
                log.LogDebug("NTP sync against {Server}: offset {OffsetMs:0.0} ms, round trip {RoundTripMs:0.0} ms",
                    server, offset.TotalMilliseconds, roundTrip.TotalMilliseconds);
                if (Math.Abs(offset.TotalSeconds) > 1)
                    log.LogWarning("Local clock is {OffsetMs:0} ms adrift of NTP server {Server}", offset.TotalMilliseconds, server);

                var syncedAt = DateTimeOffset.UtcNow;
                return new Snapshot(syncedAt, offset, "ntp", server, roundTrip.TotalMilliseconds, syncedAt, null);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                lastError = $"{server}: {ex.Message}";
                log.LogWarning(ex, "NTP query against {Server} failed", server);
            }
        }

        log.LogError("Every NTP server failed ({Servers}); answering with the uncorrected local clock. Last error: {Error}",
            string.Join(", ", servers), lastError);
        return new Snapshot(DateTimeOffset.UtcNow, TimeSpan.Zero, "local", null, null, null, lastError ?? "no NTP servers configured");
    }

    private static async Task<(TimeSpan Offset, TimeSpan RoundTrip)?> BestOfAsync(
        string server, int exchanges, TimeSpan timeout, ILogger log, CancellationToken ct)
    {
        (TimeSpan Offset, TimeSpan RoundTrip)? best = null;
        for (var i = 0; i < exchanges; i++)
        {
            var sample = await ExchangeAsync(server, timeout, log, ct);
            if (sample == null) continue;
            if (best == null || sample.Value.RoundTrip < best.Value.RoundTrip)
                best = sample;
        }
        return best;
    }

    private static async Task<(TimeSpan Offset, TimeSpan RoundTrip)?> ExchangeAsync(
        string server, TimeSpan timeout, ILogger log, CancellationToken ct)
    {
        var addresses = await Dns.GetHostAddressesAsync(server, ct);
        if (addresses.Length == 0)
            throw new InvalidOperationException($"{server} did not resolve");
        var endpoint = new IPEndPoint(addresses[0], 123);

        using var udp = new UdpClient(endpoint.AddressFamily);
        udp.Connect(endpoint);

        var request = new byte[48];
        request[0] = 0x1B; // LI = 0 (no warning), VN = 3, Mode = 3 (client)

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(timeout);

        var t1 = DateTimeOffset.UtcNow;
        await udp.SendAsync(request, timeoutCts.Token);

        UdpReceiveResult reply;
        try
        {
            reply = await udp.ReceiveAsync(timeoutCts.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            log.LogDebug("NTP exchange with {Server} ({Address}) timed out after {TimeoutMs} ms", server, endpoint.Address, timeout.TotalMilliseconds);
            return null;
        }
        var t4 = DateTimeOffset.UtcNow;

        var buffer = reply.Buffer;
        if (buffer.Length < 48)
        {
            log.LogDebug("NTP reply from {Server} was {Bytes} bytes - too short", server, buffer.Length);
            return null;
        }

        var mode = buffer[0] & 0x07;
        var stratum = buffer[1];
        if (mode != 4 || stratum == 0)
        {
            // Mode 4 = server reply; stratum 0 is a "kiss-o'-death" (e.g. rate limited).
            log.LogDebug("NTP reply from {Server} rejected: mode {Mode}, stratum {Stratum}", server, mode, stratum);
            return null;
        }

        var t2 = ReadTimestamp(buffer, 32); // server receive
        var t3 = ReadTimestamp(buffer, 40); // server transmit
        if (t2 == null || t3 == null)
        {
            log.LogDebug("NTP reply from {Server} carried a zero timestamp", server);
            return null;
        }

        var offset = TimeSpan.FromTicks(((t2.Value - t1).Ticks + (t3.Value - t4).Ticks) / 2);
        var roundTrip = (t4 - t1) - (t3.Value - t2.Value);
        return (offset, roundTrip);
    }

    private static DateTimeOffset? ReadTimestamp(ReadOnlySpan<byte> buffer, int at)
    {
        var seconds = BinaryPrimitives.ReadUInt32BigEndian(buffer.Slice(at, 4));
        var fraction = BinaryPrimitives.ReadUInt32BigEndian(buffer.Slice(at + 4, 4));
        if (seconds == 0 && fraction == 0) return null;

        // NTP era 0 wraps in 2036; treat values below the Unix epoch as era 1.
        var unixSeconds = seconds >= NtpEpochOffsetSeconds
            ? (long)(seconds - NtpEpochOffsetSeconds)
            : (long)seconds + (1L << 32) - (long)NtpEpochOffsetSeconds;
        var ticks = unixSeconds * TimeSpan.TicksPerSecond + (long)(fraction * (double)TimeSpan.TicksPerSecond / 4_294_967_296.0);
        return DateTimeOffset.UnixEpoch.AddTicks(ticks);
    }
}
