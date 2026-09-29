using System.Diagnostics;

namespace Autofills.LauncherHelper;

/// <summary>Starts a program. A seam so tests can record what would have been opened.</summary>
public interface IProcessStarter
{
    void Start(string fileName, IReadOnlyList<string> arguments);
}

public sealed class ProcessStarter : IProcessStarter
{
    public void Start(string fileName, IReadOnlyList<string> arguments)
    {
        var info = new ProcessStartInfo(fileName) { UseShellExecute = false };
        foreach (var argument in arguments) info.ArgumentList.Add(argument);

        // Not waited for and its output not redirected: a browser has to outlive this
        // program, and a redirected pipe that nobody reads would eventually stall it.
        using var process = Process.Start(info);
    }
}

public sealed record BrowserFire(string Browser, bool Started, double LateMs, int StaggerMs, string? Error);

public sealed record LaunchReport(IReadOnlyList<BrowserFire> Fires);

/// <summary>
/// The timetable for one run:
///   - WarmSeconds before the jump, every browser is started on a blank page, so that
///     browser start-up (seconds, on a cold machine) is not part of the critical moment;
///   - shortly before, the clock is re-synced with NTP;
///   - at the jump moment (sale time minus the lead) every browser is told to open the
///     ticket page - a fast hand-off to the already-running copy - each after its own
///     random stagger, so several browsers on one connection don't all arrive in the same
///     instant.
/// Waiting is done in coarse sleeps and then a short spin, against the NTP-corrected clock,
/// so the jump lands within a millisecond or two of its moment.
/// </summary>
public sealed class Launcher
{
    /// <summary>How long before the jump the clock is re-synced, unless told otherwise.</summary>
    public static readonly TimeSpan DefaultFinalSyncLead = TimeSpan.FromSeconds(12);

    // A step missed by more than this, with the jump this close, is skipped rather than run late.
    private static readonly TimeSpan SkipWindow = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan SpinBelow = TimeSpan.FromMilliseconds(250);

    private readonly LaunchOptions _options;
    private readonly IReadOnlyList<Browser> _browsers;
    private readonly TrueClock _clock;
    private readonly IProcessStarter _starter;
    private readonly OsKind _os;
    private readonly Log _log;
    private readonly Random _random;
    private readonly TimeSpan _finalSyncLead;

    public Launcher(
        LaunchOptions options,
        IReadOnlyList<Browser> browsers,
        TrueClock clock,
        IProcessStarter starter,
        OsKind os,
        Log log,
        Random? random = null,
        TimeSpan? finalSyncLead = null)
    {
        _options = options;
        _browsers = browsers;
        _clock = clock;
        _starter = starter;
        _os = os;
        _log = log;
        _random = random ?? new Random();
        _finalSyncLead = finalSyncLead ?? DefaultFinalSyncLead;
    }

    /// <param name="saleUtc">The moment the sale opens (the jump is <see cref="LaunchOptions.LeadMs"/> before it).</param>
    /// <param name="finalSync">Re-syncs the clock shortly before the jump; may be null.</param>
    public async Task<LaunchReport> RunAsync(DateTimeOffset saleUtc, Func<CancellationToken, Task>? finalSync, CancellationToken ct)
    {
        var fireAt = saleUtc - TimeSpan.FromMilliseconds(_options.LeadMs);
        var warmAt = fireAt - TimeSpan.FromSeconds(_options.WarmSeconds);
        var staggers = _browsers.ToDictionary(
            b => b.Id,
            _ => _options.StaggerMs > 0 ? _random.Next(0, _options.StaggerMs + 1) : 0);

        _log.Info("Armed",
            ("url", _options.Url),
            ("sale", LondonTime.Format(saleUtc)),
            ("jump", LondonTime.Format(fireAt)),
            ("leadMs", _options.LeadMs),
            ("browsers", string.Join("+", _browsers.Select(b => b.Name))),
            ("dryRun", _options.DryRun));
        foreach (var browser in _browsers)
            _log.Debug("Stagger drawn", ("browser", browser.Name), ("staggerMs", staggers[browser.Id]));

        var steps = new List<(DateTimeOffset At, string Name, Func<Task> Run)>();
        if (_options.WarmSeconds > 0)
            steps.Add((warmAt, "warm", () => { Warm(); return Task.CompletedTask; }));
        if (finalSync is not null)
            steps.Add((fireAt - _finalSyncLead, "final clock sync", () => finalSync(ct)));

        foreach (var step in steps.OrderBy(s => s.At))
        {
            var behind = _clock.Now - step.At;
            if (behind > TimeSpan.Zero && fireAt - _clock.Now < SkipWindow)
            {
                _log.Warn("Skipped a step - too close to the jump", ("step", step.Name), ("behindMs", behind.TotalMilliseconds));
                continue;
            }

            await WaitUntilAsync(step.At, ct);
            _log.Debug("Step", ("step", step.Name), ("lateMs", (_clock.Now - step.At).TotalMilliseconds));
            await step.Run();
        }

        await WaitUntilAsync(fireAt, ct);
        var jumpedAt = _clock.Now;
        _log.Info("Jump", ("lateMs", (jumpedAt - fireAt).TotalMilliseconds));

        var fires = await Task.WhenAll(_browsers.Select(b => FireAsync(b, staggers[b.Id], fireAt, ct)));
        return new LaunchReport(fires);
    }

    private void Warm()
    {
        foreach (var browser in _browsers)
        {
            var (file, arguments) = BrowserCommand.Warm(browser, _os);
            try
            {
                Start(browser, file, arguments, "Warming up");
            }
            catch (Exception ex)
            {
                _log.Warn("Could not warm up browser", ("browser", browser.Name), ("error", ex.Message));
            }
        }
    }

    private async Task<BrowserFire> FireAsync(Browser browser, int staggerMs, DateTimeOffset fireAt, CancellationToken ct)
    {
        try
        {
            if (staggerMs > 0) await Task.Delay(staggerMs, ct);

            var (file, arguments) = BrowserCommand.ForUrl(browser, _options.Url, _os);
            var lateMs = (_clock.Now - fireAt).TotalMilliseconds;
            Start(browser, file, arguments, "Opening ticket page");
            _log.Info("Opened", ("browser", browser.Name), ("staggerMs", staggerMs), ("lateMs", lateMs));
            return new BrowserFire(browser.Name, true, lateMs, staggerMs, null);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.Error("Could not open browser", ("browser", browser.Name), ("error", ex.Message));
            return new BrowserFire(browser.Name, false, (_clock.Now - fireAt).TotalMilliseconds, staggerMs, ex.Message);
        }
    }

    private void Start(Browser browser, string file, IReadOnlyList<string> arguments, string what)
    {
        _log.Debug(what, ("browser", browser.Name), ("command", file), ("arguments", string.Join(" ", arguments)), ("dryRun", _options.DryRun));
        if (_options.DryRun) return;
        _starter.Start(file, arguments);
    }

    private async Task WaitUntilAsync(DateTimeOffset target, CancellationToken ct)
    {
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            var remaining = target - _clock.Now;
            if (remaining <= TimeSpan.Zero) return;

            if (remaining > SpinBelow)
            {
                // Sleep most of the way, but never all of it - the last stretch is spun.
                var sleep = TimeSpan.FromMilliseconds(Math.Min(remaining.TotalMilliseconds - SpinBelow.TotalMilliseconds / 2, 1000));
                await Task.Delay(sleep, ct);
            }
            else
            {
                SpinWait.SpinUntil(() => _clock.Now >= target, remaining + TimeSpan.FromMilliseconds(50));
            }
        }
    }
}
