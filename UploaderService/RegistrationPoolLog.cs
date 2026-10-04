namespace Autofills.UploaderService;

// =============================================================================
// SOURCE-GENERATED LOG MESSAGES for the registration allocation tab
// (the attribute pattern; hardcoded English - see UploaderLog.cs for why)
// =============================================================================
// Registration numbers and postcodes are credentials for the ticket sale, so
// they never appear in these messages - only counts, outcomes, upload names
// and the first few characters of the opaque browser id (enough to follow one
// browser's sequence of events through the log without identifying anyone).
// =============================================================================

/// <summary>Log messages for RegistrationAllocationController and RegistrationPoolStore.</summary>
internal static partial class PoolLog
{
    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Registration pool file not present yet: Directory={Directory}")]
    public static partial void NoPoolFile(ILogger logger, string directory);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Registration pool read: Total={Total} Remaining={Remaining}")]
    public static partial void PoolRead(ILogger logger, int total, int remaining);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Registration pool saved: Total={Total} Remaining={Remaining}")]
    public static partial void PoolSaved(ILogger logger, int total, int remaining);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Registration shown: Browser={Browser} Mode={Mode} Total={Total} Remaining={Remaining} HasEntry={HasEntry}")]
    public static partial void Shown(ILogger logger, string browser, string mode, int total, int remaining, bool hasEntry);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Registration claim: Browser={Browser} Outcome={Outcome} Total={Total} Remaining={Remaining}")]
    public static partial void Claimed(ILogger logger, string browser, string outcome, int total, int remaining);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Every registration in the pool has now been allocated: Total={Total}")]
    public static partial void PoolExhausted(ILogger logger, int total);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Registration request rejected: Route={Route} Reason={Reason}")]
    public static partial void Rejected(ILogger logger, string route, string reason);

    [LoggerMessage(Level = LogLevel.Error,
        Message = "Registration request failed unexpectedly: Route={Route}")]
    public static partial void Failed(ILogger logger, Exception exception, string route);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Registration pool load requested: Caller={Caller} Upload={Upload} Bytes={Bytes}")]
    public static partial void LoadRequested(ILogger logger, string caller, string? upload, long? bytes);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Registration pool loaded: Upload={Upload} Sheet={Sheet} Total={Total} Added={Added} StillAllocated={StillAllocated} DroppedAllocated={DroppedAllocated} SkippedRows={SkippedRows} DuplicateRows={DuplicateRows}")]
    public static partial void Loaded(ILogger logger, string? upload, string sheet, int total, int added, int stillAllocated, int droppedAllocated, int skippedRows, int duplicateRows);
}
