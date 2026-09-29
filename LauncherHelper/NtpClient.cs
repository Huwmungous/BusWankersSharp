using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;

namespace Autofills.LauncherHelper;

public sealed record NtpSample(TimeSpan Offset, TimeSpan RoundTrip);

public sealed record ClockSync(TimeSpan Offset, string Server, TimeSpan RoundTrip, int Samples);

/// <summary>
/// A small SNTP client (RFC 4330). Unlike the page, the helper is a real program and
/// can speak NTP (UDP 123) itself, so it needs neither the web service nor a sign-in
/// to know the true time. Same arithmetic as UploaderService's NtpClock:
///     offset = ((T2 - T1) + (T3 - T4)) / 2,   round trip = (T4 - T1) - (T3 - T2)
/// and of several exchanges the one with the shortest round trip wins, since a short
/// round trip bounds the error in the offset.
/// </summary>
public static class NtpClient
{
    // Unix epoch expressed in NTP seconds (NTP counts from 1900-01-01).
    private const ulong NtpEpochOffsetSeconds = 2_208_988_800UL;

    /// <summary>
    /// Asks the servers in order and returns the first that answers, or null when none
    /// does. Never throws for network trouble - a failure just moves on to the next
    /// server - so a caller can carry on with the local clock and say so.
    /// </summary>
    public static async Task<ClockSync?> SyncAsync(
        IEnumerable<string> servers, int exchanges, TimeSpan timeout, Log log, CancellationToken ct)
    {
        foreach (var server in servers)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                NtpSample? best = null;
                var answered = 0;
                for (var i = 0; i < exchanges; i++)
                {
                    var sample = await ExchangeAsync(server, timeout, log, ct);
                    if (sample is null) continue;
                    answered++;
                    if (best is null || sample.RoundTrip < best.RoundTrip) best = sample;
                }

                if (best is null)
                {
                    log.Warn("NTP server gave no usable reply", ("server", server), ("timeoutMs", timeout.TotalMilliseconds));
                    continue;
                }

                log.Debug("NTP sync", ("server", server), ("offsetMs", best.Offset.TotalMilliseconds), ("roundTripMs", best.RoundTrip.TotalMilliseconds), ("answered", answered));
                return new ClockSync(best.Offset, server, best.RoundTrip, answered);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                log.Warn("NTP query failed", ("server", server), ("error", ex.Message));
            }
        }

        return null;
    }

    /// <summary>
    /// Works out the offset and round trip from a server reply, or returns null (with
    /// the reason in <paramref name="rejection"/>) when the reply is unusable: too short,
    /// not a server reply, a stratum-0 "kiss-o'-death", or carrying a zero timestamp.
    /// </summary>
    public static NtpSample? ParseReply(ReadOnlySpan<byte> buffer, DateTimeOffset t1, DateTimeOffset t4, out string? rejection)
    {
        rejection = null;
        if (buffer.Length < 48)
        {
            rejection = $"reply was {buffer.Length} bytes - too short";
            return null;
        }

        var mode = buffer[0] & 0x07;
        var stratum = buffer[1];
        if (mode != 4 || stratum == 0)
        {
            rejection = $"mode {mode}, stratum {stratum} (not a usable server reply)";
            return null;
        }

        var t2 = ReadTimestamp(buffer, 32); // server receive
        var t3 = ReadTimestamp(buffer, 40); // server transmit
        if (t2 is null || t3 is null)
        {
            rejection = "reply carried a zero timestamp";
            return null;
        }

        var offset = TimeSpan.FromTicks(((t2.Value - t1).Ticks + (t3.Value - t4).Ticks) / 2);
        var roundTrip = (t4 - t1) - (t3.Value - t2.Value);
        return new NtpSample(offset, roundTrip);
    }

    /// <summary>Writes a timestamp in NTP's 32.32 fixed-point form (used to build test replies).</summary>
    public static void WriteTimestamp(Span<byte> buffer, int at, DateTimeOffset when)
    {
        var sinceEpoch = when - DateTimeOffset.UnixEpoch;
        var wholeSeconds = (long)Math.Floor(sinceEpoch.TotalSeconds);
        var fractionTicks = sinceEpoch.Ticks - wholeSeconds * TimeSpan.TicksPerSecond;
        var seconds = unchecked((uint)((ulong)wholeSeconds + NtpEpochOffsetSeconds));
        var fraction = (uint)(fractionTicks * 4_294_967_296.0 / TimeSpan.TicksPerSecond);
        BinaryPrimitives.WriteUInt32BigEndian(buffer.Slice(at, 4), seconds);
        BinaryPrimitives.WriteUInt32BigEndian(buffer.Slice(at + 4, 4), fraction);
    }

    private static async Task<NtpSample?> ExchangeAsync(string server, TimeSpan timeout, Log log, CancellationToken ct)
    {
        var addresses = await Dns.GetHostAddressesAsync(server, ct);
        if (addresses.Length == 0)
            throw new InvalidOperationException($"{server} did not resolve");

        // IPv4 first: pool servers answer on both, but IPv4 is the path least likely to be filtered.
        var address = addresses.OrderBy(a => a.AddressFamily == AddressFamily.InterNetwork ? 0 : 1).First();
        var endpoint = new IPEndPoint(address, 123);

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
            log.Debug("NTP exchange timed out", ("server", server), ("address", endpoint.Address), ("timeoutMs", timeout.TotalMilliseconds));
            return null;
        }
        var t4 = DateTimeOffset.UtcNow;

        var sample = ParseReply(reply.Buffer, t1, t4, out var rejection);
        if (sample is null)
            log.Debug("NTP reply rejected", ("server", server), ("reason", rejection));
        return sample;
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
