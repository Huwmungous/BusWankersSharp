using System.Globalization;

namespace Autofills.LauncherHelper;

/// <summary>
/// Exit codes: 0 every browser opened, 1 one or more failed to open, 2 bad options,
/// 3 no browsers found, 4 the sale time has already passed, 130 cancelled (Ctrl+C).
/// </summary>
public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        var interactive = args.Length == 0 && !Console.IsInputRedirected;

        LaunchOptions options;
        try
        {
            options = interactive ? Interactive() : LaunchOptions.Parse(args);
        }
        catch (OptionsException ex)
        {
            Console.Error.WriteLine(ex.Message);
            Console.Error.WriteLine();
            Console.Error.WriteLine(Usage.Text);
            return Finish(interactive, 2);
        }

        if (options.Help)
        {
            Console.WriteLine(Usage.Text);
            return 0;
        }

        var log = new Log(Console.Out, options.Verbose);
        var probe = new SystemProbe();
        var browsers = BrowserCatalogue.Discover(probe, options.Only);
        log.Info("Browsers found", ("count", browsers.Count), ("names", string.Join(", ", browsers.Select(b => b.Name))), ("os", probe.Os));

        if (options.List)
        {
            foreach (var browser in browsers)
                Console.WriteLine($"{browser.Id,-9} {browser.Name,-16} {browser.Command}");
            return 0;
        }

        if (browsers.Count == 0)
        {
            log.Error("No supported browsers found on this computer",
                ("hint", options.Only.Count > 0 ? "--only matched none of them; try --list" : "run with --list to see what was looked for"));
            return Finish(interactive, 3);
        }

        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
        };

        var clock = new TrueClock();
        var exchanges = 3;
        var timeout = TimeSpan.FromMilliseconds(1500);

        var sync = await NtpClient.SyncAsync(options.NtpServers, exchanges, timeout, log, cts.Token);
        if (sync is null)
        {
            log.Warn("Could not reach an NTP server - using this computer's own clock, which may be seconds out");
        }
        else
        {
            clock.Offset = sync.Offset;
            log.Info("Clock synced",
                ("server", sync.Server),
                ("computerClockIsMs", -sync.Offset.TotalMilliseconds),
                ("roundTripMs", sync.RoundTrip.TotalMilliseconds));
        }

        var saleUtc = options.SaleAtUtc
            ?? clock.Now + TimeSpan.FromSeconds(options.RehearseSeconds ?? 0) + TimeSpan.FromMilliseconds(options.LeadMs);
        if (options.RehearseSeconds is not null)
            log.Info("Rehearsal - not the real sale time", ("seconds", options.RehearseSeconds));

        var fireAt = saleUtc - TimeSpan.FromMilliseconds(options.LeadMs);
        if (fireAt <= clock.Now)
        {
            log.Error("That sale time has already passed", ("sale", LondonTime.Format(saleUtc)), ("now", LondonTime.Format(clock.Now)));
            return Finish(interactive, 4);
        }

        log.Info("Sale opens in", ("time", Describe(saleUtc - clock.Now)));

        var launcher = new Launcher(options, browsers, clock, new ProcessStarter(), probe.Os, log);

        LaunchReport report;
        try
        {
            report = await launcher.RunAsync(saleUtc, async ct =>
            {
                var fresh = await NtpClient.SyncAsync(options.NtpServers, exchanges, timeout, log, ct);
                if (fresh is null)
                {
                    log.Warn("Final clock sync failed - keeping the earlier offset");
                    return;
                }

                clock.Offset = fresh.Offset;
                log.Info("Clock re-synced", ("computerClockIsMs", -fresh.Offset.TotalMilliseconds), ("roundTripMs", fresh.RoundTrip.TotalMilliseconds));
            }, cts.Token);
        }
        catch (OperationCanceledException)
        {
            log.Warn("Cancelled - nothing further will be opened");
            return 130;
        }

        var failed = report.Fires.Count(f => !f.Started);
        if (failed == 0)
            log.Info("All browsers opened - leave this window open until you are through", ("count", report.Fires.Count));
        else
            log.Error("Some browsers did not open", ("failed", failed), ("of", report.Fires.Count));

        return Finish(interactive, failed == 0 ? 0 : 1);
    }

    private static LaunchOptions Interactive()
    {
        Console.WriteLine("Bus Wankers launcher - opens the ticket page in every browser on this computer at the sale time.");
        Console.WriteLine("(Run with --help to see the options this asks about.)");
        Console.WriteLine();

        var url = Ask("Ticket page", LaunchOptions.DefaultUrl);
        var when = Ask("Sale time in UK time, like 2026-10-01 09:00 (just press Enter to rehearse in 30 seconds)", null);

        var arguments = new List<string> { "--url", url };
        if (string.IsNullOrWhiteSpace(when))
        {
            arguments.Add("--rehearse");
            arguments.Add("30");
        }
        else
        {
            arguments.Add("--at");
            arguments.Add(when.Trim());
        }

        return LaunchOptions.Parse(arguments);
    }

    private static string Ask(string question, string? fallback)
    {
        Console.Write(fallback is null ? $"{question}: " : $"{question} [{fallback}]: ");
        var answer = Console.ReadLine();
        return string.IsNullOrWhiteSpace(answer) ? fallback ?? string.Empty : answer.Trim();
    }

    // Double-clicked from a file manager the window would vanish the instant we return, taking the
    // message with it - so when we were started without arguments, wait for a key.
    private static int Finish(bool interactive, int code)
    {
        if (interactive)
        {
            Console.WriteLine();
            Console.Write("Press Enter to close this window.");
            Console.ReadLine();
        }

        return code;
    }

    private static string Describe(TimeSpan span)
    {
        if (span.TotalDays >= 1) return $"{(int)span.TotalDays}d {span.Hours}h {span.Minutes}m";
        if (span.TotalHours >= 1) return $"{(int)span.TotalHours}h {span.Minutes}m {span.Seconds}s";
        return string.Create(CultureInfo.InvariantCulture, $"{(int)span.TotalMinutes}m {span.Seconds}s");
    }
}

public static class Usage
{
    public const string Text = """
        BusWankersLauncher - opens the ticket page in every browser installed on this computer,
        at the sale time, on true (NTP) time. Each browser is its own place in the queue.

        Usage:
          BusWankersLauncher --url <ticket page> --at <UK time>  [options]
          BusWankersLauncher --rehearse 30                       (try it: opens 30 seconds from now)
          BusWankersLauncher --list                              (show the browsers it can find)

        Options:
          --url <address>      the ticket page (default https://glastonbury.seetickets.com/)
          --at <time>          the sale time in UK time, e.g. 2026-10-01T09:00 or "2026-10-01 09:00:00"
          --rehearse <secs>    jump this many seconds from now instead of at the sale time
          --lead <ms>          open this many ms BEFORE the sale time (default 200)
          --stagger <ms>       each browser waits its own random delay up to this (default 300; 0 = off)
          --warm <secs>        start every browser this many seconds early on a blank page (default 45; 0 = off)
          --only <a,b,...>     only these browsers, e.g. --only chrome,firefox
          --ntp <a,b,...>      NTP servers to ask (default uk.pool.ntp.org, pool.ntp.org, time.cloudflare.com)
          --dry-run            do everything except actually start the browsers
          --verbose            show debug detail
          --list               list the browsers found and stop
          --help               this text

        With no options at all it asks for the ticket page and the sale time.
        """;
}
