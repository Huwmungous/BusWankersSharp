using Autofills.LauncherHelper;
using Xunit;

namespace LauncherHelper.Tests;

/// <summary>A machine that has exactly the files, folders and commands it is told about.</summary>
internal sealed class FakeProbe : IBrowserProbe
{
    public FakeProbe(OsKind os) => Os = os;

    public OsKind Os { get; }

    public HashSet<string> Files { get; } = [];

    public HashSet<string> Directories { get; } = [];

    public Dictionary<string, string> Commands { get; } = [];

    public Dictionary<string, string> Environment { get; } = [];

    public bool FileExists(string path) => Files.Contains(path);

    public bool DirectoryExists(string path) => Directories.Contains(path);

    public string? FindOnPath(string command) => Commands.GetValueOrDefault(command);

    public string? Env(string name) => Environment.GetValueOrDefault(name);
}

public class BrowserCatalogueTests
{
    private static FakeProbe Windows()
    {
        var probe = new FakeProbe(OsKind.Windows);
        probe.Environment["ProgramFiles"] = @"C:\Program Files";
        probe.Environment["ProgramFiles(x86)"] = @"C:\Program Files (x86)";
        probe.Environment["LocalAppData"] = @"C:\Users\camp\AppData\Local";
        return probe;
    }

    [Fact]
    public void Windows_FindsBrowsersInTheirUsualFolders()
    {
        var probe = Windows();
        probe.Files.Add(Path.Combine(@"C:\Program Files", @"Google\Chrome\Application\chrome.exe"));
        probe.Files.Add(Path.Combine(@"C:\Program Files (x86)", @"Microsoft\Edge\Application\msedge.exe"));
        probe.Files.Add(Path.Combine(@"C:\Program Files", @"Mozilla Firefox\firefox.exe"));
        probe.Files.Add(Path.Combine(@"C:\Users\camp\AppData\Local", @"Programs\Opera\opera.exe"));

        var found = BrowserCatalogue.Discover(probe);

        Assert.Equal(["chrome", "edge", "firefox", "opera"], found.Select(b => b.Id));
        Assert.Equal(BrowserKind.Firefox, found.Single(b => b.Id == "firefox").Kind);
        Assert.Equal(BrowserKind.Chromium, found.Single(b => b.Id == "edge").Kind);
        Assert.Equal(Path.Combine(@"C:\Program Files", @"Mozilla Firefox\firefox.exe"), found.Single(b => b.Id == "firefox").Command);
    }

    [Fact]
    public void Windows_WithNoBrowsersInstalled_FindsNothing()
    {
        Assert.Empty(BrowserCatalogue.Discover(Windows()));
    }

    [Fact]
    public void Windows_ToleratesMissingEnvironmentVariables()
    {
        var probe = new FakeProbe(OsKind.Windows);
        Assert.Empty(BrowserCatalogue.Discover(probe));
    }

    [Fact]
    public void Mac_FindsApplicationsInTheSystemAndUserFolders()
    {
        var probe = new FakeProbe(OsKind.MacOs);
        probe.Environment["HOME"] = "/Users/camp";
        probe.Directories.Add("/Applications/Google Chrome.app");
        probe.Directories.Add("/Applications/Firefox.app");
        probe.Directories.Add("/System/Applications/Safari.app");
        probe.Directories.Add(Path.Combine("/Users/camp", "Applications", "Brave Browser.app"));

        var found = BrowserCatalogue.Discover(probe);

        Assert.Equal(["chrome", "firefox", "brave", "safari"], found.Select(b => b.Id));
        // On a Mac the command is the application's name, which "open -a" wants.
        Assert.Equal("Google Chrome", found.Single(b => b.Id == "chrome").Command);
        Assert.Equal(BrowserKind.Safari, found.Single(b => b.Id == "safari").Kind);
    }

    [Fact]
    public void Linux_FindsBrowsersOnThePath_TakingTheFirstNameThatExists()
    {
        var probe = new FakeProbe(OsKind.Linux);
        probe.Commands["google-chrome-stable"] = "/usr/bin/google-chrome-stable";
        probe.Commands["firefox"] = "/usr/bin/firefox";
        probe.Commands["chromium-browser"] = "/usr/bin/chromium-browser";

        var found = BrowserCatalogue.Discover(probe);

        Assert.Equal(["chrome", "firefox", "chromium"], found.Select(b => b.Id));
        Assert.Equal("/usr/bin/google-chrome-stable", found.Single(b => b.Id == "chrome").Command);
    }

    [Fact]
    public void Linux_NeverReportsSafariOrOperaGxWithoutACommand()
    {
        var probe = new FakeProbe(OsKind.Linux);
        Assert.Empty(BrowserCatalogue.Discover(probe));
    }

    [Fact]
    public void Only_NarrowsByIdOrByName_IgnoringCase()
    {
        var probe = new FakeProbe(OsKind.Linux);
        probe.Commands["google-chrome"] = "/usr/bin/google-chrome";
        probe.Commands["firefox"] = "/usr/bin/firefox";
        probe.Commands["microsoft-edge"] = "/usr/bin/microsoft-edge";

        Assert.Equal(["firefox"], BrowserCatalogue.Discover(probe, ["FIREFOX"]).Select(b => b.Id));
        Assert.Equal(["edge"], BrowserCatalogue.Discover(probe, ["microsoft edge"]).Select(b => b.Id));
        Assert.Equal(["chrome", "edge"], BrowserCatalogue.Discover(probe, ["chrome", "edge"]).Select(b => b.Id));
        Assert.Empty(BrowserCatalogue.Discover(probe, ["netscape"]));
    }
}

public class BrowserCommandTests
{
    private static readonly Browser Chrome = new("chrome", "Google Chrome", BrowserKind.Chromium, "/usr/bin/google-chrome");
    private static readonly Browser Firefox = new("firefox", "Mozilla Firefox", BrowserKind.Firefox, "/usr/bin/firefox");
    private static readonly Browser MacChrome = new("chrome", "Google Chrome", BrowserKind.Chromium, "Google Chrome");

    [Fact]
    public void ChromiumBrowsers_GetANewWindowOnTheUrl()
    {
        var (file, arguments) = BrowserCommand.ForUrl(Chrome, "https://example.com/", OsKind.Linux);
        Assert.Equal("/usr/bin/google-chrome", file);
        Assert.Equal(["--new-window", "https://example.com/"], arguments);
    }

    [Fact]
    public void Firefox_UsesItsOwnSpellingOfTheFlag()
    {
        var (_, arguments) = BrowserCommand.ForUrl(Firefox, "https://example.com/", OsKind.Windows);
        Assert.Equal(["-new-window", "https://example.com/"], arguments);
    }

    [Fact]
    public void OnAMac_EverythingGoesThroughOpenDashA()
    {
        var (file, arguments) = BrowserCommand.ForUrl(MacChrome, "https://example.com/", OsKind.MacOs);
        Assert.Equal("open", file);
        Assert.Equal(["-a", "Google Chrome", "https://example.com/"], arguments);
    }

    [Fact]
    public void Warming_OpensABlankPage_OrOnAMacJustLaunchesTheApp()
    {
        var (file, arguments) = BrowserCommand.Warm(Chrome, OsKind.Linux);
        Assert.Equal("/usr/bin/google-chrome", file);
        Assert.Equal(["--new-window", "about:blank"], arguments);

        var (macFile, macArguments) = BrowserCommand.Warm(MacChrome, OsKind.MacOs);
        Assert.Equal("open", macFile);
        Assert.Equal(["-a", "Google Chrome"], macArguments);
    }

    [Fact]
    public void TheUrlIsOneArgument_SoAmpersandsAndSpacesCannotSplitIt()
    {
        var (_, arguments) = BrowserCommand.ForUrl(Chrome, "https://example.com/?a=1&b=two words", OsKind.Linux);
        Assert.Equal(2, arguments.Count);
        Assert.Equal("https://example.com/?a=1&b=two words", arguments[1]);
    }
}
