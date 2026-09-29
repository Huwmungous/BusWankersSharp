namespace Autofills.LauncherHelper;

/// <summary>
/// "True" UTC: this computer's clock plus the offset NTP measured. The offset is
/// replaced (not accumulated) each time a fresh sync completes, and is read on
/// every call, so a late correction takes effect immediately.
/// </summary>
public sealed class TrueClock
{
    private readonly Func<DateTimeOffset> _local;
    private long _offsetTicks;

    public TrueClock(Func<DateTimeOffset>? local = null, TimeSpan? offset = null)
    {
        _local = local ?? (() => DateTimeOffset.UtcNow);
        _offsetTicks = (offset ?? TimeSpan.Zero).Ticks;
    }

    public TimeSpan Offset
    {
        get => TimeSpan.FromTicks(Interlocked.Read(ref _offsetTicks));
        set => Interlocked.Exchange(ref _offsetTicks, value.Ticks);
    }

    public DateTimeOffset Now => _local() + Offset;
}
