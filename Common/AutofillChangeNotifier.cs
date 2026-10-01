using System.Collections.Concurrent;
using System.Threading.Channels;

namespace Autofills.Common;

/// <summary>
/// One change to the autofill store, as handed to every listener: a sequence
/// number that only ever goes up (so a listener can tell it missed one), when it
/// happened, and a short fixed word for why ("ingest"). It deliberately carries
/// no names, file names or caller - it only says "look again".
/// </summary>
public readonly record struct AutofillChange(long Sequence, DateTimeOffset At, string Reason);

/// <summary>
/// A listener's seat. Read changes from <see cref="Reader"/>; dispose it to give
/// the seat up (a stream that ends for any reason must do so, or the notifier
/// keeps a channel nobody reads).
/// </summary>
public sealed class AutofillSubscription : IDisposable
{
    private readonly Action _release;
    private int _released;

    public AutofillSubscription(ChannelReader<AutofillChange> reader, Action release)
    {
        Reader = reader;
        _release = release;
    }

    public ChannelReader<AutofillChange> Reader { get; }

    public void Dispose()
    {
        // Safe to call more than once.
        if (Interlocked.Exchange(ref _released, 1) == 0)
            _release();
    }
}

/// <summary>
/// The server's "the autofill files changed" signal, so that open pages hear
/// about an ingest as it happens instead of polling for it. Registered as a
/// singleton: the ingest route publishes to it, and each open
/// GET /api/autofill/events stream holds a subscription.
///
/// Each subscriber gets its own channel holding at most ONE change, newest wins:
/// the message means "check again", so a slow or briefly stalled reader only
/// ever needs the latest one, and a stuck reader can never make memory grow or
/// hold up a publisher. Publish never blocks and never throws.
///
/// Every field below is initialised where it is declared, so it exists before
/// any method can run.
/// </summary>
public sealed class AutofillChangeNotifier
{
    private readonly ConcurrentDictionary<long, Channel<AutofillChange>> _subscribers = new();
    private long _nextSubscriberId;
    private long _sequence;

    /// <summary>The sequence number of the latest change published (0 before any).</summary>
    public long Sequence => Interlocked.Read(ref _sequence);

    /// <summary>How many streams are listening right now.</summary>
    public int SubscriberCount => _subscribers.Count;

    /// <summary>Tells every current subscriber the store has changed. Returns what was sent.</summary>
    public AutofillChange Publish(string reason)
    {
        var change = new AutofillChange(Interlocked.Increment(ref _sequence), DateTimeOffset.UtcNow, reason);
        foreach (var channel in _subscribers.Values)
        {
            // DropOldest on a capacity-1 channel: the write always succeeds.
            channel.Writer.TryWrite(change);
        }

        return change;
    }

    /// <summary>Takes a seat. Dispose the result when the listener goes away.</summary>
    public AutofillSubscription Subscribe()
    {
        var id = Interlocked.Increment(ref _nextSubscriberId);
        var channel = Channel.CreateBounded<AutofillChange>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false,
        });
        _subscribers[id] = channel;

        return new AutofillSubscription(channel.Reader, () =>
        {
            if (_subscribers.TryRemove(id, out var removed))
                removed.Writer.TryComplete();
        });
    }
}
