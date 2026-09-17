using System.Text.RegularExpressions;

namespace Autofills.UploaderService;

/// <summary>
/// The on-disk home of the "live" autofill files - the ones the documentation
/// page's dropdown offers and the AutoFill Options extension pulls by URL.
///
/// Before this existed the autofill files were static assets checked into
/// ReactApp/public/ and served by holly's nginx, so refreshing one meant a
/// commit and a frontend redeploy. Now an uploaded spreadsheet is "ingested":
/// every sale sheet in it is generated straight into this directory (one
/// file per sale, named by UploadServiceController.DownloadNameFor), and the
/// service serves them back out via GET /api/autofill/files/{filename}.
///
/// Alongside the autofill files the store keeps ONE non-csv file,
/// running_order.json - the master roster ("Glasto nnnn" sheet) as read at
/// the last ingest, which is where the page gets the festival year and the
/// running-order list from. It is excluded from List() (that's autofill files
/// only) and served by its own route.
///
/// The directory lives OUTSIDE the deploy path on purpose -
/// buswankers-remote-install.sh wipes /srv/BusWankersSharp/WebServices/UploaderService
/// on every deploy, so anything ingested would vanish with the next release
/// if it lived there. The installer creates the default location below and
/// hands it to the service account; override with AutofillStore:Directory
/// in appsettings (appsettings.Development.json points it at a relative
/// folder so a local `dotnet run` needs no /srv tree).
/// </summary>
public sealed class AutofillStore
{
    public const string ConfigKey = "AutofillStore:Directory";
    public const string DefaultDirectory = "/srv/BusWankersSharp/Data/autofill";
    public const string RunningOrderFileName = "running_order.json";

    /// <summary>
    /// Exactly the shape DownloadNameFor produces - a lowercase slug plus the
    /// "_autofill.csv" suffix (or the bare fallback "autofill.csv"). Anything
    /// else is refused on the way in AND the way out, which is what keeps the
    /// download route from ever being a path-traversal into the filesystem.
    /// </summary>
    private static readonly Regex SafeFileName =
        new("^(?:[a-z0-9]+(?:_[a-z0-9]+)*_)?autofill\\.csv$", RegexOptions.Compiled);

    private readonly string _directory;

    public AutofillStore(IConfiguration config)
    {
        var configured = config[ConfigKey];
        _directory = string.IsNullOrWhiteSpace(configured)
            ? DefaultDirectory
            : Path.GetFullPath(configured);
    }

    public string Directory => _directory;

    public static bool IsSafeFileName(string? fileName) =>
        !string.IsNullOrEmpty(fileName) && SafeFileName.IsMatch(fileName);

    /// <summary>
    /// Every autofill file currently in the store, newest first. A store that
    /// doesn't exist yet (first run before anything's been ingested) is simply
    /// empty, not an error.
    /// </summary>
    public IReadOnlyList<StoredAutofillFile> List()
    {
        if (!System.IO.Directory.Exists(_directory))
            return Array.Empty<StoredAutofillFile>();

        return new DirectoryInfo(_directory)
            .EnumerateFiles("*.csv", SearchOption.TopDirectoryOnly)
            .Where(f => IsSafeFileName(f.Name))
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .Select(ToStored)
            .ToList();
    }

    /// <summary>Full path of a stored file, or null if it isn't there (or isn't a safe name).</summary>
    public string? PathOf(string? fileName)
    {
        if (!IsSafeFileName(fileName))
            return null;

        var path = Path.Combine(_directory, fileName!);
        return File.Exists(path) ? path : null;
    }

    /// <summary>
    /// Writes (or replaces) one autofill file. Written to a temp name first and
    /// then moved into place, so a download that lands mid-write never sees a
    /// half-written file.
    /// </summary>
    public async Task<StoredAutofillFile> SaveAsync(string fileName, byte[] content, CancellationToken ct = default)
    {
        if (!IsSafeFileName(fileName))
            throw new ArgumentException($"'{fileName}' is not a valid autofill filename.", nameof(fileName));

        var finalPath = await WriteAtomicAsync(fileName, content, ct);
        return ToStored(new FileInfo(finalPath));
    }

    /// <summary>
    /// Removes one autofill file - what an ingest does when the sale sheet for
    /// it has been emptied, so the store never advertises a file for a sale
    /// that no longer has anyone on it. True if a file was actually removed.
    /// </summary>
    public bool Delete(string fileName)
    {
        if (!IsSafeFileName(fileName))
            throw new ArgumentException($"'{fileName}' is not a valid autofill filename.", nameof(fileName));

        var path = Path.Combine(_directory, fileName);
        if (!File.Exists(path))
            return false;

        File.Delete(path);
        return true;
    }

    /// <summary>Full path of running_order.json, or null if no roster has been ingested.</summary>
    public string? RunningOrderPath
    {
        get
        {
            var path = Path.Combine(_directory, RunningOrderFileName);
            return File.Exists(path) ? path : null;
        }
    }

    public Task SaveRunningOrderAsync(byte[] json, CancellationToken ct = default) =>
        WriteAtomicAsync(RunningOrderFileName, json, ct);

    /// <summary>Removes running_order.json (an emptied roster sheet clears it). True if there was one.</summary>
    public bool DeleteRunningOrder()
    {
        var path = Path.Combine(_directory, RunningOrderFileName);
        if (!File.Exists(path))
            return false;

        File.Delete(path);
        return true;
    }

    /// <summary>
    /// The suffix for a sale's structured-groups sidecar, alongside its autofill
    /// CSV - "coach_autofill.csv" gets "coach_autofill.groups.json". This is what
    /// the bookmarklet itself fetches live, cross-origin, at click time (see
    /// UploadServiceController.DownloadGroups and bookmarkletSource/FILL_SOURCE
    /// in ReactApp/src/bookmarklet.js): the same RegistrationGroup data
    /// GenerateAutofillTextFromGroups turns into CSV, written straight to JSON
    /// instead, so there is no CSV-parsing logic to duplicate in the bookmarklet's
    /// own (deliberately old-school) JavaScript.
    /// </summary>
    public const string GroupsFileSuffix = ".groups.json";

    public static string GroupsFileNameFor(string autofillFileName) =>
        Path.GetFileNameWithoutExtension(autofillFileName) + GroupsFileSuffix;

    /// <summary>Full path of a sale's groups sidecar, or null if it isn't there (or the autofill filename isn't safe).</summary>
    public string? PathOfGroups(string? autofillFileName)
    {
        if (!IsSafeFileName(autofillFileName))
            return null;

        var path = Path.Combine(_directory, GroupsFileNameFor(autofillFileName!));
        return File.Exists(path) ? path : null;
    }

    public Task SaveGroupsAsync(string autofillFileName, byte[] json, CancellationToken ct = default)
    {
        if (!IsSafeFileName(autofillFileName))
            throw new ArgumentException($"'{autofillFileName}' is not a valid autofill filename.", nameof(autofillFileName));

        return WriteAtomicAsync(GroupsFileNameFor(autofillFileName), json, ct);
    }

    /// <summary>Removes a sale's groups sidecar (an emptied sale sheet clears it, same as its CSV). True if there was one.</summary>
    public bool DeleteGroups(string autofillFileName)
    {
        if (!IsSafeFileName(autofillFileName))
            throw new ArgumentException($"'{autofillFileName}' is not a valid autofill filename.", nameof(autofillFileName));

        var path = Path.Combine(_directory, GroupsFileNameFor(autofillFileName));
        if (!File.Exists(path))
            return false;

        File.Delete(path);
        return true;
    }

    private async Task<string> WriteAtomicAsync(string fileName, byte[] content, CancellationToken ct)
    {
        System.IO.Directory.CreateDirectory(_directory);

        var finalPath = Path.Combine(_directory, fileName);
        var tempPath = Path.Combine(_directory, $".{fileName}.{Guid.NewGuid():N}.tmp");

        try
        {
            await File.WriteAllBytesAsync(tempPath, content, ct);
            File.Move(tempPath, finalPath, overwrite: true);
        }
        finally
        {
            if (File.Exists(tempPath))
                File.Delete(tempPath);
        }

        return finalPath;
    }

    private static StoredAutofillFile ToStored(FileInfo f) =>
        new(f.Name, f.Length, new DateTimeOffset(f.LastWriteTimeUtc, TimeSpan.Zero));
}

/// <summary>One file in the store, as reported by GET /api/autofill/files.</summary>
public sealed record StoredAutofillFile(string Filename, long Size, DateTimeOffset LastModified);
