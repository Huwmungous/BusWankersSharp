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

        return ToStored(new FileInfo(finalPath));
    }

    private static StoredAutofillFile ToStored(FileInfo f) =>
        new(f.Name, f.Length, new DateTimeOffset(f.LastWriteTimeUtc, TimeSpan.Zero));
}

/// <summary>One file in the store, as reported by GET /api/autofill/files.</summary>
public sealed record StoredAutofillFile(string Filename, long Size, DateTimeOffset LastModified);
