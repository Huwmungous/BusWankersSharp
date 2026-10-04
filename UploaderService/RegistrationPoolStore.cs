using System.Text.Json;
using Autofills.Common;

namespace Autofills.UploaderService;

/// <summary>What registration_pool.json holds.</summary>
public sealed record PoolDocument(string Source, DateTimeOffset? LoadedAt, List<PoolEntry> Entries);

/// <summary>
/// Keeps the registration pool (see Common/RegistrationPool.cs) in
/// registration_pool.json in the autofill store, and is the one place that
/// changes it.
///
/// "Once copied, it can't go to another user" is only true if two people
/// pressing Copy at the same moment can't both win. The controller is built
/// per request (like the others here), so the lock is STATIC: every request
/// in this process queues behind the same gate, and each one reads the file,
/// applies its change and writes it back before the next is let in. The
/// service is a single instance behind holly's nginx, so a process-wide lock
/// is enough; running a second instance against the same directory would
/// need a different mechanism. At a couple of hundred entries the read/write
/// is trivial.
///
/// A file that can't be read is an error, never "an empty pool": silently
/// starting afresh would hand out pairs that had already been given away.
/// </summary>
public sealed class RegistrationPoolStore
{
    private static readonly SemaphoreSlim Gate = new(1, 1);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    private readonly AutofillStore _store;
    private readonly ILogger _log;
    private readonly TimeSpan _holdFor;

    /// <param name="holdFor">How long a pair shown to someone stays held for them (see RegistrationPool.HoldFor).</param>
    public RegistrationPoolStore(AutofillStore store, ILogger log, TimeSpan holdFor)
    {
        _store = store;
        _log = log;
        _holdFor = holdFor;
    }

    /// <summary>
    /// Runs <paramref name="work"/> against the current pool while holding the
    /// lock, and saves the pool afterwards if the work says it changed it.
    /// </summary>
    public async Task<T> UseAsync<T>(Func<RegistrationPool, (T Result, bool Changed)> work, CancellationToken ct = default)
    {
        await Gate.WaitAsync(ct);
        try
        {
            var pool = await LoadAsync(ct);
            var (result, changed) = work(pool);

            if (changed)
                await SaveAsync(pool, ct);

            return result;
        }
        finally
        {
            Gate.Release();
        }
    }

    private async Task<RegistrationPool> LoadAsync(CancellationToken ct)
    {
        var path = _store.RegistrationPoolPath;
        if (path == null)
        {
            PoolLog.NoPoolFile(_log, _store.Directory);
            return new RegistrationPool(holdFor: _holdFor);
        }

        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var document = await JsonSerializer.DeserializeAsync<PoolDocument>(stream, JsonOptions, ct);

        var pool = new RegistrationPool(document?.Entries, document?.Source ?? string.Empty, document?.LoadedAt, _holdFor);
        PoolLog.PoolRead(_log, pool.Total, pool.Remaining);
        return pool;
    }

    private async Task SaveAsync(RegistrationPool pool, CancellationToken ct)
    {
        var document = new PoolDocument(pool.Source, pool.LoadedAt, pool.Entries.ToList());
        var json = JsonSerializer.SerializeToUtf8Bytes(document, JsonOptions);
        await _store.SaveRegistrationPoolAsync(json, ct);
        PoolLog.PoolSaved(_log, pool.Total, pool.Remaining);
    }
}
