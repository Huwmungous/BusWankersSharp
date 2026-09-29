using Autofills.LauncherHelper;
using Xunit;

namespace LauncherHelper.Tests;

internal sealed class RecordingStarter : IProcessStarter
{
    private readonly TrueClock _clock;

    public RecordingStarter(TrueClock clock) => _clock = clock;

    public List<(DateTimeOffset At, string File, string[] Arguments)> Started { get; } = [];

    public Func<string, bool>? Fails { get; set; }

    public void Start(string fileName, IReadOnlyList<string> arguments)
    {
        if (Fails?.Invoke(fileName) == true) throw new InvalidOperationException("no such browser");
        lock (Started) Started.Add((_clock.Now, fileName, arguments.ToArray()));
    }
}

public class LauncherTests
{
    private static readonly Browser Chrome = new("chrome", "Google Chrome", BrowserKind.Chromium, "/usr/bin/google-chrome");
    private static readonly Browser Firefox = new("firefox", "Mozilla Firefox", BrowserKind.Firefox, "/usr/bin/firefox");

    private static LaunchOptions Options(int warm = 0, int stagger = 0, int lead = 0, bool dryRun = false) => new()
    {
        Url = "https://example.com/tickets",
        LeadMs = lead,
        StaggerMs = stagger,
        WarmSeconds = warm,
        DryRun = dryRun,
    };

    private static Log Quiet() => new(TextWriter.Null, verbose: true);

    [Fact]
    public async Task EveryBrowserIsOpenedOnTheUrl_NotBeforeTheMoment()
    {
        var clock = new TrueClock();
        var starter = new RecordingStarter(clock);
        var sale = clock.Now + TimeSpan.FromMilliseconds(600);
        var launcher = new Launcher(Options(), [Chrome, Firefox], clock, starter, OsKind.Linux, Quiet());

        var report = await launcher.RunAsync(sale, null, CancellationToken.None);

        Assert.Equal(2, starter.Started.Count);
        Assert.All(starter.Started, s => Assert.True(s.At >= sale, "opened before the sale moment"));
        Assert.All(starter.Started, s => Assert.Equal("https://example.com/tickets", s.Arguments[1]));
        Assert.Equal(["/usr/bin/firefox", "/usr/bin/google-chrome"], starter.Started.Select(s => s.File).Order());
        Assert.All(report.Fires, f => Assert.True(f.Started));
    }

    [Fact]
    public async Task TheLeadOpensTheBrowsersThatMuchBeforeTheSaleTime()
    {
        var clock = new TrueClock();
        var starter = new RecordingStarter(clock);
        var sale = clock.Now + TimeSpan.FromMilliseconds(900);
        var launcher = new Launcher(Options(lead: 400), [Chrome], clock, starter, OsKind.Linux, Quiet());

        await launcher.RunAsync(sale, null, CancellationToken.None);

        var opened = Assert.Single(starter.Started).At;
        Assert.True(opened >= sale - TimeSpan.FromMilliseconds(400));
        Assert.True(opened < sale, "a 400 ms lead should open the page before the sale time itself");
    }

    [Fact]
    public async Task WarmingStartsEveryBrowserOnABlankPage_BeforeTheRealJump()
    {
        var clock = new TrueClock();
        var starter = new RecordingStarter(clock);
        // Warm 1 s ahead of a jump 1.6 s away: the warm step is 0.6 s in the future.
        var sale = clock.Now + TimeSpan.FromMilliseconds(1600);
        var launcher = new Launcher(Options(warm: 1), [Chrome, Firefox], clock, starter, OsKind.Linux, Quiet());

        await launcher.RunAsync(sale, null, CancellationToken.None);

        var calls = starter.Started.OrderBy(s => s.At).ToList();
        Assert.Equal(4, calls.Count);
        Assert.All(calls.Take(2), c => Assert.Equal("about:blank", c.Arguments[1]));
        Assert.All(calls.Skip(2), c => Assert.Equal("https://example.com/tickets", c.Arguments[1]));
    }

    [Fact]
    public async Task WarmingIsSkipped_WhenTheJumpIsTooCloseToBother()
    {
        var clock = new TrueClock();
        var starter = new RecordingStarter(clock);
        // Warm 45 s early is impossible for a jump 0.7 s away, and it is not worth doing late.
        var sale = clock.Now + TimeSpan.FromMilliseconds(700);
        var launcher = new Launcher(Options(warm: 45), [Chrome], clock, starter, OsKind.Linux, Quiet());

        await launcher.RunAsync(sale, null, CancellationToken.None);

        var only = Assert.Single(starter.Started);
        Assert.Equal("https://example.com/tickets", only.Arguments[1]);
    }

    [Fact]
    public async Task TheFinalClockSyncRunsBeforeTheJump_AndItsCorrectionIsUsed()
    {
        var clock = new TrueClock();
        var starter = new RecordingStarter(clock);
        var syncedAt = DateTimeOffset.MinValue;
        var wallStart = DateTimeOffset.UtcNow;
        var sale = clock.Now + TimeSpan.FromMilliseconds(1500);
        // The sync is due 600 ms before the jump, i.e. 900 ms from now.
        var launcher = new Launcher(Options(), [Chrome], clock, starter, OsKind.Linux, Quiet(),
            finalSyncLead: TimeSpan.FromMilliseconds(600));

        var report = await launcher.RunAsync(sale, _ =>
        {
            syncedAt = clock.Now;
            // NTP says this computer's clock is 500 ms slow: true time is 500 ms further on,
            // so the jump (measured on the corrected clock) comes 500 ms sooner on the wall clock.
            clock.Offset += TimeSpan.FromMilliseconds(500);
            return Task.CompletedTask;
        }, CancellationToken.None);

        Assert.True(syncedAt >= sale - TimeSpan.FromMilliseconds(600), "the final sync should run when it is due, not before");
        Assert.True(syncedAt < sale - TimeSpan.FromMilliseconds(300), "the final sync should run well before the jump");
        Assert.Single(report.Fires);
        Assert.True(starter.Started[0].At >= sale);
        Assert.True(DateTimeOffset.UtcNow - wallStart < TimeSpan.FromMilliseconds(1400), "the correction should have brought the jump forward");
    }

    [Fact]
    public async Task StaggerDelaysEachBrowserByItsOwnDraw_UpToTheLimit()
    {
        var clock = new TrueClock();
        var starter = new RecordingStarter(clock);
        var sale = clock.Now + TimeSpan.FromMilliseconds(400);
        var launcher = new Launcher(Options(stagger: 300), [Chrome, Firefox], clock, starter, OsKind.Linux, Quiet(), new Random(7));

        var report = await launcher.RunAsync(sale, null, CancellationToken.None);

        Assert.All(report.Fires, f => Assert.InRange(f.StaggerMs, 0, 300));
        Assert.All(report.Fires, f => Assert.True(f.LateMs >= f.StaggerMs - 5, $"{f.Browser} opened before its stagger had elapsed"));
    }

    [Fact]
    public async Task ADryRun_StartsNothing_ButStillReportsTheTimetable()
    {
        var clock = new TrueClock();
        var starter = new RecordingStarter(clock);
        var sale = clock.Now + TimeSpan.FromMilliseconds(400);
        var launcher = new Launcher(Options(dryRun: true), [Chrome, Firefox], clock, starter, OsKind.Linux, Quiet());

        var report = await launcher.RunAsync(sale, null, CancellationToken.None);

        Assert.Empty(starter.Started);
        Assert.Equal(2, report.Fires.Count);
    }

    [Fact]
    public async Task OneBrowserFailingToStart_DoesNotStopTheOthers()
    {
        var clock = new TrueClock();
        var starter = new RecordingStarter(clock) { Fails = file => file.EndsWith("firefox", StringComparison.Ordinal) };
        var sale = clock.Now + TimeSpan.FromMilliseconds(400);
        var launcher = new Launcher(Options(), [Chrome, Firefox], clock, starter, OsKind.Linux, Quiet());

        var report = await launcher.RunAsync(sale, null, CancellationToken.None);

        var chrome = report.Fires.Single(f => f.Browser == "Google Chrome");
        var firefox = report.Fires.Single(f => f.Browser == "Mozilla Firefox");
        Assert.True(chrome.Started);
        Assert.False(firefox.Started);
        Assert.Equal("no such browser", firefox.Error);
        Assert.Single(starter.Started);
    }

    [Fact]
    public async Task OnAMac_TheBrowsersAreOpenedThroughOpenDashA()
    {
        var clock = new TrueClock();
        var starter = new RecordingStarter(clock);
        var mac = new Browser("chrome", "Google Chrome", BrowserKind.Chromium, "Google Chrome");
        var sale = clock.Now + TimeSpan.FromMilliseconds(400);
        var launcher = new Launcher(Options(), [mac], clock, starter, OsKind.MacOs, Quiet());

        await launcher.RunAsync(sale, null, CancellationToken.None);

        var call = Assert.Single(starter.Started);
        Assert.Equal("open", call.File);
        Assert.Equal(["-a", "Google Chrome", "https://example.com/tickets"], call.Arguments);
    }

    [Fact]
    public async Task Cancelling_StopsBeforeAnythingIsOpened()
    {
        var clock = new TrueClock();
        var starter = new RecordingStarter(clock);
        var sale = clock.Now + TimeSpan.FromSeconds(30);
        var launcher = new Launcher(Options(), [Chrome], clock, starter, OsKind.Linux, Quiet());
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => launcher.RunAsync(sale, null, cts.Token));

        Assert.Empty(starter.Started);
    }

    [Fact]
    public async Task TheCorrectedClockDecidesTheMoment_NotTheLocalOne()
    {
        // This computer's clock is 2 s fast: true time is 2 s behind it. The sale is 600 ms away on
        // the true clock, so it is 600 ms away in real time too. Judged by the local clock, that
        // instant would be 1.4 s in the past and the browsers would open immediately.
        var local = () => DateTimeOffset.UtcNow;
        var clock = new TrueClock(local, TimeSpan.FromSeconds(-2));
        var starter = new RecordingStarter(clock);
        var sale = clock.Now + TimeSpan.FromMilliseconds(600);
        var wallStart = DateTimeOffset.UtcNow;
        var launcher = new Launcher(Options(), [Chrome], clock, starter, OsKind.Linux, Quiet());

        await launcher.RunAsync(sale, null, CancellationToken.None);

        Assert.True(clock.Now >= sale);
        Assert.True(DateTimeOffset.UtcNow - wallStart >= TimeSpan.FromMilliseconds(550));
    }
}
