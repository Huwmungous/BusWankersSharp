using Autofills.LauncherHelper;
using Xunit;

namespace LauncherHelper.Tests;

public class NtpClientTests
{
    // Builds a 48-byte server reply carrying the given receive (T2) and transmit (T3) times.
    private static byte[] Reply(DateTimeOffset t2, DateTimeOffset t3, byte mode = 4, byte stratum = 2)
    {
        var buffer = new byte[48];
        buffer[0] = (byte)(0x18 | mode); // version 3
        buffer[1] = stratum;
        NtpClient.WriteTimestamp(buffer, 32, t2);
        NtpClient.WriteTimestamp(buffer, 40, t3);
        return buffer;
    }

    private static readonly DateTimeOffset Start = new(2026, 10, 1, 8, 0, 0, TimeSpan.Zero);

    [Fact]
    public void ALocalClockThatIsBehind_GivesAPositiveOffset()
    {
        // The server is 250 ms ahead of us; the exchange takes 40 ms each way and the
        // server spends 2 ms answering.
        var t1 = Start;
        var t2 = Start + TimeSpan.FromMilliseconds(250 + 40);
        var t3 = t2 + TimeSpan.FromMilliseconds(2);
        var t4 = Start + TimeSpan.FromMilliseconds(40 + 2 + 40);

        var sample = NtpClient.ParseReply(Reply(t2, t3), t1, t4, out var rejection);

        Assert.Null(rejection);
        Assert.NotNull(sample);
        Assert.Equal(250, sample!.Offset.TotalMilliseconds, 1.0);
        Assert.Equal(80, sample.RoundTrip.TotalMilliseconds, 1.0);
    }

    [Fact]
    public void ALocalClockThatIsAhead_GivesANegativeOffset()
    {
        var t1 = Start;
        var t2 = Start + TimeSpan.FromMilliseconds(-1000 + 10);
        var t3 = t2;
        var t4 = Start + TimeSpan.FromMilliseconds(20);

        var sample = NtpClient.ParseReply(Reply(t2, t3), t1, t4, out _);

        Assert.NotNull(sample);
        Assert.Equal(-1000, sample!.Offset.TotalMilliseconds, 1.0);
    }

    [Fact]
    public void ATooShortReply_IsRejected()
    {
        var sample = NtpClient.ParseReply(new byte[20], Start, Start, out var rejection);
        Assert.Null(sample);
        Assert.Contains("too short", rejection);
    }

    [Fact]
    public void AKissOfDeath_StratumZero_IsRejected()
    {
        var sample = NtpClient.ParseReply(Reply(Start, Start, stratum: 0), Start, Start, out var rejection);
        Assert.Null(sample);
        Assert.Contains("stratum 0", rejection);
    }

    [Fact]
    public void ANonServerMode_IsRejected()
    {
        var sample = NtpClient.ParseReply(Reply(Start, Start, mode: 3), Start, Start, out var rejection);
        Assert.Null(sample);
        Assert.Contains("mode 3", rejection);
    }

    [Fact]
    public void AZeroTimestamp_IsRejected()
    {
        var buffer = new byte[48];
        buffer[0] = 0x1C;
        buffer[1] = 2;
        var sample = NtpClient.ParseReply(buffer, Start, Start, out var rejection);
        Assert.Null(sample);
        Assert.Contains("zero timestamp", rejection);
    }

    [Fact]
    public void Timestamps_SurviveAWriteAndReadRoundTrip()
    {
        // Through ParseReply: a server whose clock equals ours, replying instantly, has zero offset.
        var when = Start + TimeSpan.FromMilliseconds(123.456);
        var sample = NtpClient.ParseReply(Reply(when, when), when, when, out _);
        Assert.NotNull(sample);
        Assert.Equal(0, sample!.Offset.TotalMilliseconds, 0.01);
    }
}
