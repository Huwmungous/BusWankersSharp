namespace Autofills.LauncherHelper;

public enum OsKind
{
    Windows,
    MacOs,
    Linux,
}

public enum BrowserKind
{
    /// <summary>Chrome, Edge, Brave, Opera, Vivaldi... - all take --new-window.</summary>
    Chromium,

    /// <summary>Firefox takes -new-window.</summary>
    Firefox,

    /// <summary>Safari (macOS only) is opened through "open -a" like everything on a Mac.</summary>
    Safari,
}

/// <summary>
/// One installed browser. <see cref="Command"/> is what gets run: the full path to the
/// executable on Windows and Linux, the application name (as "open -a" wants it) on macOS.
/// </summary>
public sealed record Browser(string Id, string Name, BrowserKind Kind, string Command);

/// <summary>What the machine looks like to the catalogue. A seam so tests can pretend to be any OS.</summary>
public interface IBrowserProbe
{
    OsKind Os { get; }

    bool FileExists(string path);

    bool DirectoryExists(string path);

    /// <summary>The full path of a command found on PATH, or null.</summary>
    string? FindOnPath(string command);

    string? Env(string name);
}

public sealed class SystemProbe : IBrowserProbe
{
    public OsKind Os { get; } = OperatingSystem.IsWindows() ? OsKind.Windows
        : OperatingSystem.IsMacOS() ? OsKind.MacOs
        : OsKind.Linux;

    public bool FileExists(string path) => File.Exists(path);

    public bool DirectoryExists(string path) => Directory.Exists(path);

    public string? FindOnPath(string command)
    {
        var path = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrEmpty(path)) return null;

        foreach (var directory in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = Path.Combine(directory, command);
            if (File.Exists(candidate)) return candidate;
        }

        return null;
    }

    public string? Env(string name) => Environment.GetEnvironmentVariable(name);
}

/// <summary>
/// Works out which browsers are installed. Each is a separate place in the ticket
/// queue (they don't share cookies or sessions), which is the whole point of opening
/// several. Only the mainstream browsers are looked for; anything else can be added
/// to <see cref="Definitions"/>.
/// </summary>
public static class BrowserCatalogue
{
    private sealed record Definition(
        string Id,
        string Name,
        BrowserKind Kind,
        string[] WindowsRelativePaths,
        string? MacApp,
        string[] LinuxCommands);

    // Folders (as environment variables) that Windows browsers install under.
    private static readonly string[] WindowsRoots = ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"];

    // Where macOS keeps applications.
    private static readonly string[] MacApplicationFolders = ["/Applications", "/System/Applications"];

    private static readonly Definition[] Definitions =
    [
        new("chrome", "Google Chrome", BrowserKind.Chromium,
            [@"Google\Chrome\Application\chrome.exe"], "Google Chrome", ["google-chrome", "google-chrome-stable"]),
        new("edge", "Microsoft Edge", BrowserKind.Chromium,
            [@"Microsoft\Edge\Application\msedge.exe"], "Microsoft Edge", ["microsoft-edge", "microsoft-edge-stable"]),
        new("firefox", "Mozilla Firefox", BrowserKind.Firefox,
            [@"Mozilla Firefox\firefox.exe"], "Firefox", ["firefox"]),
        new("brave", "Brave", BrowserKind.Chromium,
            [@"BraveSoftware\Brave-Browser\Application\brave.exe"], "Brave Browser", ["brave-browser", "brave"]),
        new("opera", "Opera", BrowserKind.Chromium,
            [@"Programs\Opera\opera.exe", @"Opera\opera.exe", @"Opera\launcher.exe"], "Opera", ["opera"]),
        new("operagx", "Opera GX", BrowserKind.Chromium,
            [@"Programs\Opera GX\opera.exe", @"Opera GX\opera.exe"], "Opera GX", []),
        new("vivaldi", "Vivaldi", BrowserKind.Chromium,
            [@"Vivaldi\Application\vivaldi.exe"], "Vivaldi", ["vivaldi", "vivaldi-stable"]),
        new("chromium", "Chromium", BrowserKind.Chromium,
            [@"Chromium\Application\chrome.exe"], "Chromium", ["chromium", "chromium-browser"]),
        new("safari", "Safari", BrowserKind.Safari,
            [], "Safari", []),
    ];

    /// <summary>The installed browsers, in a stable order; <paramref name="only"/> narrows it by id or name.</summary>
    public static IReadOnlyList<Browser> Discover(IBrowserProbe probe, IEnumerable<string>? only = null)
    {
        var found = new List<Browser>();
        foreach (var definition in Definitions)
        {
            var command = probe.Os switch
            {
                OsKind.Windows => FindOnWindows(definition, probe),
                OsKind.MacOs => FindOnMac(definition, probe),
                _ => FindOnLinux(definition, probe),
            };
            if (command is null) continue;
            found.Add(new Browser(definition.Id, definition.Name, definition.Kind, command));
        }

        var wanted = only?.Select(w => w.Trim().ToLowerInvariant()).Where(w => w.Length > 0).ToArray() ?? [];
        if (wanted.Length == 0) return found;

        return found
            .Where(b => wanted.Contains(b.Id) || wanted.Contains(b.Name.ToLowerInvariant()))
            .ToList();
    }

    private static string? FindOnWindows(Definition definition, IBrowserProbe probe)
    {
        foreach (var relative in definition.WindowsRelativePaths)
        {
            foreach (var rootVariable in WindowsRoots)
            {
                var root = probe.Env(rootVariable);
                if (string.IsNullOrEmpty(root)) continue;
                var candidate = Path.Combine(root, relative);
                if (probe.FileExists(candidate)) return candidate;
            }
        }

        return null;
    }

    private static string? FindOnMac(Definition definition, IBrowserProbe probe)
    {
        if (definition.MacApp is null) return null;

        var folders = new List<string>(MacApplicationFolders);
        var home = probe.Env("HOME");
        if (!string.IsNullOrEmpty(home)) folders.Add(Path.Combine(home, "Applications"));

        foreach (var folder in folders)
        {
            if (probe.DirectoryExists(Path.Combine(folder, definition.MacApp + ".app")))
                return definition.MacApp;
        }

        return null;
    }

    private static string? FindOnLinux(Definition definition, IBrowserProbe probe)
    {
        foreach (var command in definition.LinuxCommands)
        {
            var path = probe.FindOnPath(command);
            if (path is not null) return path;
        }

        return null;
    }
}

/// <summary>The command line that opens a browser on a URL.</summary>
public static class BrowserCommand
{
    /// <summary>
    /// Opens <paramref name="url"/> in a window of the browser. When the browser is already
    /// running (see <see cref="Warm"/>) this is a fast hand-off to the running copy, which is
    /// why the helper starts every browser a little before the moment.
    /// </summary>
    public static (string FileName, IReadOnlyList<string> Arguments) ForUrl(Browser browser, string url, OsKind os) =>
        os == OsKind.MacOs
            ? ("open", ["-a", browser.Command, url])
            : (browser.Command, [NewWindowFlag(browser.Kind), url]);

    /// <summary>Just gets the browser process up and its first window open, on a blank page.</summary>
    public static (string FileName, IReadOnlyList<string> Arguments) Warm(Browser browser, OsKind os) =>
        os == OsKind.MacOs
            ? ("open", ["-a", browser.Command])
            : (browser.Command, [NewWindowFlag(browser.Kind), "about:blank"]);

    private static string NewWindowFlag(BrowserKind kind) => kind == BrowserKind.Firefox ? "-new-window" : "--new-window";
}
