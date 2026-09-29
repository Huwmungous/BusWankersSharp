using System.Globalization;

namespace Autofills.LauncherHelper;

public sealed class OptionsException : Exception
{
    public OptionsException(string message) : base(message)
    {
    }
}

/// <summary>
/// What the person asked for, parsed from the command line. The page's Launcher tab
/// builds the command for them from the same settings it already holds (ticket URL,
/// sale time in UK time, jump-early and stagger milliseconds), so the names and
/// meanings here deliberately match launch/config.js.
/// </summary>
public sealed class LaunchOptions
{
    public const string DefaultUrl = "https://glastonbury.seetickets.com/";
    public const int DefaultLeadMs = 200;
    public const int DefaultStaggerMs = 300;
    public const int DefaultWarmSeconds = 45;

    public static readonly string[] DefaultNtpServers = ["uk.pool.ntp.org", "pool.ntp.org", "time.cloudflare.com"];

    private static readonly string[] WallFormats =
    [
        "yyyy-MM-dd'T'HH:mm",
        "yyyy-MM-dd'T'HH:mm:ss",
        "yyyy-MM-dd HH:mm",
        "yyyy-MM-dd HH:mm:ss",
    ];

    /// <summary>The ticket page to open.</summary>
    public string Url { get; set; } = DefaultUrl;

    /// <summary>The sale time as a UTC instant, or null when only rehearsing / listing.</summary>
    public DateTimeOffset? SaleAtUtc { get; set; }

    /// <summary>Open this many ms BEFORE the sale time (the jump itself takes a page load).</summary>
    public int LeadMs { get; set; } = DefaultLeadMs;

    /// <summary>Each browser waits its own random delay up to this many ms after the jump moment.</summary>
    public int StaggerMs { get; set; } = DefaultStaggerMs;

    /// <summary>Start every browser this many seconds early so the real jump is a quick hand-off. 0 = off.</summary>
    public int WarmSeconds { get; set; } = DefaultWarmSeconds;

    /// <summary>Rehearse: jump this many seconds from now instead of at the sale time.</summary>
    public int? RehearseSeconds { get; set; }

    public bool List { get; set; }

    public bool DryRun { get; set; }

    public bool Verbose { get; set; }

    public bool Help { get; set; }

    /// <summary>Only use these browsers (ids or names, lower case); empty = every browser found.</summary>
    public IReadOnlyList<string> Only { get; set; } = [];

    public IReadOnlyList<string> NtpServers { get; set; } = DefaultNtpServers;

    public static LaunchOptions Parse(IReadOnlyList<string> args)
    {
        var options = new LaunchOptions();

        for (var i = 0; i < args.Count; i++)
        {
            var raw = args[i];
            if (raw is "-h" or "/?" or "-?")
            {
                options.Help = true;
                continue;
            }

            if (!raw.StartsWith("--", StringComparison.Ordinal))
                throw new OptionsException($"Unexpected '{raw}'. Options start with --, for example --url. Try --help.");

            var name = raw[2..];
            string? inline = null;
            var equals = name.IndexOf('=');
            if (equals >= 0)
            {
                inline = name[(equals + 1)..];
                name = name[..equals];
            }

            // Reads this option's value: "--name=value" or "--name value".
            string Value()
            {
                if (inline is not null) return inline;
                if (i + 1 >= args.Count) throw new OptionsException($"--{name} needs a value.");
                i++;
                return args[i];
            }

            switch (name.ToLowerInvariant())
            {
                case "url":
                    options.Url = ParseUrl(Value());
                    break;
                case "at":
                    options.SaleAtUtc = ParseLondonWall(Value());
                    break;
                case "lead":
                    options.LeadMs = ParseInt(name, Value(), -60000, 60000);
                    break;
                case "stagger":
                    options.StaggerMs = ParseInt(name, Value(), 0, 10000);
                    break;
                case "warm":
                    options.WarmSeconds = ParseInt(name, Value(), 0, 600);
                    break;
                case "rehearse":
                    options.RehearseSeconds = ParseInt(name, Value(), 5, 3600);
                    break;
                case "only":
                    options.Only = SplitList(Value());
                    break;
                case "ntp":
                    options.NtpServers = SplitList(Value(), lower: false);
                    break;
                case "list":
                    options.List = true;
                    break;
                case "dry-run":
                    options.DryRun = true;
                    break;
                case "verbose":
                    options.Verbose = true;
                    break;
                case "help":
                    options.Help = true;
                    break;
                default:
                    throw new OptionsException($"Unknown option --{name}. Try --help.");
            }
        }

        if (!options.Help && !options.List && options.SaleAtUtc is null && options.RehearseSeconds is null)
            throw new OptionsException("Say when to open the browsers: --at 2026-10-01T09:00 (UK time), or --rehearse 30 to try it in 30 seconds.");

        if (options.NtpServers.Count == 0)
            throw new OptionsException("--ntp needs at least one server name.");

        return options;
    }

    private static string ParseUrl(string value)
    {
        var text = value.Trim();
        if (!Uri.TryCreate(text, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new OptionsException($"--url must be a full http(s) address, not '{value}'.");
        return text;
    }

    private static DateTimeOffset ParseLondonWall(string value)
    {
        if (!DateTime.TryParseExact(value.Trim(), WallFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var wall))
            throw new OptionsException($"--at must be UK time like 2026-10-01T09:00 or '2026-10-01 09:00', not '{value}'.");

        if (!LondonTime.TryWallToUtc(wall, out var utc))
            throw new OptionsException($"{value} does not exist in UK time - the clocks go forward over it.");

        return utc;
    }

    private static int ParseInt(string name, string value, int min, int max)
    {
        if (!int.TryParse(value.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var number))
            throw new OptionsException($"--{name} must be a whole number, not '{value}'.");
        if (number < min || number > max)
            throw new OptionsException($"--{name} must be between {min} and {max}, not {number}.");
        return number;
    }

    private static string[] SplitList(string value, bool lower = true) =>
        value.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => lower ? s.ToLowerInvariant() : s)
            .ToArray();
}
