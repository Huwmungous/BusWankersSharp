using Autofills.Common;
using Xunit;

namespace Common.Tests;

// The "autofill files changed" signal (2026-10-01). The ingest route publishes,
// each open events stream subscribes. These pin down the properties the stream
// relies on: everyone hears a change, a slow reader only ever holds the latest
// one, and a listener that goes away leaves nothing behind.
public class AutofillChangeNotifierTests
{
    [Fact]
    public void Every_subscriber_hears_a_published_change()
    {
        var notifier = new AutofillChangeNotifier();
        using var first = notifier.Subscribe();
        using var second = notifier.Subscribe();

        var sent = notifier.Publish("ingest");

        Assert.True(first.Reader.TryRead(out var heardByFirst));
        Assert.True(second.Reader.TryRead(out var heardBySecond));
        Assert.Equal(sent, heardByFirst);
        Assert.Equal(sent, heardBySecond);
        Assert.Equal("ingest", sent.Reason);
    }

    [Fact]
    public void Sequence_starts_at_zero_and_goes_up_with_each_change()
    {
        var notifier = new AutofillChangeNotifier();
        Assert.Equal(0, notifier.Sequence);

        var one = notifier.Publish("ingest");
        var two = notifier.Publish("ingest");

        Assert.Equal(1, one.Sequence);
        Assert.Equal(2, two.Sequence);
        Assert.Equal(2, notifier.Sequence);
    }

    [Fact]
    public void A_reader_that_falls_behind_is_left_holding_only_the_latest_change()
    {
        var notifier = new AutofillChangeNotifier();
        using var subscription = notifier.Subscribe();

        notifier.Publish("ingest");
        notifier.Publish("ingest");
        var latest = notifier.Publish("ingest");

        Assert.True(subscription.Reader.TryRead(out var heard));
        Assert.Equal(latest.Sequence, heard.Sequence);
        Assert.False(subscription.Reader.TryRead(out _));
    }

    [Fact]
    public void Publishing_with_nobody_listening_is_harmless_but_still_counts()
    {
        var notifier = new AutofillChangeNotifier();

        var change = notifier.Publish("ingest");

        Assert.Equal(1, change.Sequence);
        Assert.Equal(0, notifier.SubscriberCount);
    }

    [Fact]
    public void A_subscriber_who_arrives_late_does_not_hear_an_earlier_change()
    {
        var notifier = new AutofillChangeNotifier();
        notifier.Publish("ingest");

        using var late = notifier.Subscribe();

        Assert.False(late.Reader.TryRead(out _));
        // ...but can see how far the sequence has got, to say so in its hello.
        Assert.Equal(1, notifier.Sequence);
    }

    [Fact]
    public void Disposing_a_subscription_removes_it_and_completes_its_channel()
    {
        var notifier = new AutofillChangeNotifier();
        var subscription = notifier.Subscribe();
        Assert.Equal(1, notifier.SubscriberCount);

        subscription.Dispose();

        Assert.Equal(0, notifier.SubscriberCount);
        Assert.True(subscription.Reader.Completion.IsCompleted);

        // A change after the listener left reaches nobody and does not throw.
        notifier.Publish("ingest");
        Assert.False(subscription.Reader.TryRead(out _));
    }

    [Fact]
    public void Disposing_twice_is_harmless()
    {
        var notifier = new AutofillChangeNotifier();
        var subscription = notifier.Subscribe();

        subscription.Dispose();
        var second = Record.Exception(subscription.Dispose);

        Assert.Null(second);
        Assert.Equal(0, notifier.SubscriberCount);
    }

    [Fact]
    public void One_subscriber_leaving_does_not_affect_another()
    {
        var notifier = new AutofillChangeNotifier();
        var leaver = notifier.Subscribe();
        using var stayer = notifier.Subscribe();

        leaver.Dispose();
        var sent = notifier.Publish("ingest");

        Assert.Equal(1, notifier.SubscriberCount);
        Assert.True(stayer.Reader.TryRead(out var heard));
        Assert.Equal(sent, heard);
    }

    [Fact]
    public async Task Many_publishers_and_subscribers_at_once_neither_throw_nor_lose_the_count()
    {
        var notifier = new AutofillChangeNotifier();
        const int publishers = 8;
        const int perPublisher = 250;

        var subscribers = Enumerable.Range(0, 20).Select(_ => notifier.Subscribe()).ToList();
        await Task.WhenAll(Enumerable.Range(0, publishers).Select(_ => Task.Run(() =>
        {
            for (var i = 0; i < perPublisher; i++)
                notifier.Publish("ingest");
        })));

        Assert.Equal(publishers * perPublisher, notifier.Sequence);
        Assert.All(subscribers, s => Assert.True(s.Reader.TryRead(out _)));

        foreach (var s in subscribers)
            s.Dispose();
        Assert.Equal(0, notifier.SubscriberCount);
    }
}
