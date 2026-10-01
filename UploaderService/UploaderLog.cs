namespace Autofills.UploaderService;

// =============================================================================
// SOURCE-GENERATED LOG MESSAGES (the attribute pattern; hardcoded English)
// =============================================================================
// Every new log line the UploaderService writes is declared here as a
// [LoggerMessage] partial method rather than an inline LogDebug("...", args) call:
//   - the message template names each value ({Caller}, {Upload}, ...), and
//     IFLogger lifts those named values into first-class, searchable fields of
//     the stored log entry (log_data->>'caller' etc.), so a sequence of events
//     can be followed by filtering on an upload name or a caller rather than by
//     grepping message text. Values are never spliced into the template;
//   - each generated method checks IsEnabled before touching its arguments, so
//     the Debug lines cost nothing when Debug is off;
//   - the call sites are strongly typed, with no boxing or params object[].
// Each placeholder name matches its parameter name (ignoring case), which is how
// the generator pairs them up.
//
// Log messages stay in English (they are for diagnosis, not for the person using
// the page) and carry no registration numbers, names or postcodes - only file
// names, counts, caller ids and outcomes.
//
// Debug visibility: the shared-estate rule gives this service an Information
// floor, which would swallow every Debug line below. appsettings.json lifts the
// "Autofills" category to Debug through IFLogger:CategoryOverrides, so the Debug
// detail is shipped; take that entry out to quieten the service.
//
// NtpClock, TimeController and UploaderAuthorization already log with named
// placeholders of their own and are left as they were.
// =============================================================================

/// <summary>Log messages for UploadServiceController (the autofill routes).</summary>
internal static partial class ControllerLog
{
    // ---- POST /sheets and POST /generate ------------------------------------

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Sheets requested: Caller={Caller} Upload={Upload} Bytes={Bytes}")]
    public static partial void SheetsRequested(ILogger logger, string caller, string? upload, long? bytes);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Sheets listed: Upload={Upload} SheetCount={SheetCount} Sheets={Sheets}")]
    public static partial void SheetsListed(ILogger logger, string? upload, int sheetCount, string sheets);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Sheets request rejected: Upload={Upload} Reason={Reason}")]
    public static partial void SheetsRejected(ILogger logger, string? upload, string reason);

    [LoggerMessage(Level = LogLevel.Error,
        Message = "Sheets request failed unexpectedly: Upload={Upload}")]
    public static partial void SheetsFailed(ILogger logger, Exception exception, string? upload);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Generate requested: Caller={Caller} Upload={Upload} Sheet={Sheet} Bytes={Bytes}")]
    public static partial void GenerateRequested(ILogger logger, string caller, string? upload, string? sheet, long? bytes);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Generated an autofill file: Upload={Upload} Sheet={Sheet} Groups={Groups} Warnings={Warnings} Bytes={Bytes} DownloadName={DownloadName}")]
    public static partial void Generated(ILogger logger, string? upload, string sheet, int groups, int warnings, int bytes, string downloadName);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Generate request rejected: Upload={Upload} Sheet={Sheet} Reason={Reason}")]
    public static partial void GenerateRejected(ILogger logger, string? upload, string? sheet, string reason);

    [LoggerMessage(Level = LogLevel.Error,
        Message = "Generate request failed unexpectedly: Upload={Upload} Sheet={Sheet}")]
    public static partial void GenerateFailed(ILogger logger, Exception exception, string? upload, string? sheet);

    // ---- POST /ingest ---------------------------------------------------------

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Ingest requested: Caller={Caller} Upload={Upload} Bytes={Bytes}")]
    public static partial void IngestRequested(ILogger logger, string caller, string? upload, long? bytes);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Ingest request rejected: Caller={Caller} Upload={Upload} Reason={Reason}")]
    public static partial void IngestRejected(ILogger logger, string caller, string? upload, string reason);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Ingest workbook buffered: Upload={Upload} Bytes={Bytes}")]
    public static partial void IngestBuffered(ILogger logger, string? upload, int bytes);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Ingest sale sheets found: Upload={Upload} SheetCount={SheetCount} Sheets={Sheets}")]
    public static partial void IngestSheetsFound(ILogger logger, string? upload, int sheetCount, string sheets);

    [LoggerMessage(Level = LogLevel.Error,
        Message = "Ingest could not list the sale sheets: Upload={Upload}")]
    public static partial void IngestListFailed(ILogger logger, Exception exception, string? upload);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Ingest sheet starting: Upload={Upload} Sheet={Sheet} File={File} MaxInAGroup={MaxInAGroup}")]
    public static partial void IngestSheetStarting(ILogger logger, string? upload, string sheet, string file, int maxInAGroup);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Ingested sheet: Sheet={Sheet} File={File} Groups={Groups} Bytes={Bytes} Warnings={Warnings} Upload={Upload}")]
    public static partial void IngestSheetOk(ILogger logger, string sheet, string file, int groups, long bytes, int warnings, string? upload);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Ingest sheet is empty: Sheet={Sheet} File={File} Cleared={Cleared} Upload={Upload}")]
    public static partial void IngestSheetEmpty(ILogger logger, string sheet, string file, bool cleared, string? upload);

    [LoggerMessage(Level = LogLevel.Error,
        Message = "Clearing the file for an emptied sheet failed: Sheet={Sheet} File={File}")]
    public static partial void IngestClearFailed(ILogger logger, Exception exception, string sheet, string file);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Ingest sheet rejected by the reader: Sheet={Sheet} File={File} Reason={Reason}")]
    public static partial void IngestSheetRejected(ILogger logger, string sheet, string file, string reason);

    [LoggerMessage(Level = LogLevel.Error,
        Message = "Ingest of sheet failed unexpectedly: Sheet={Sheet} File={File} Upload={Upload}")]
    public static partial void IngestSheetFailed(ILogger logger, Exception exception, string sheet, string file, string? upload);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Ingest finished: Caller={Caller} Upload={Upload} SheetCount={SheetCount} Ok={Ok} Empty={Empty} Failed={Failed} RosterStatus={RosterStatus} ElapsedMs={ElapsedMs}")]
    public static partial void IngestFinished(ILogger logger, string caller, string? upload, int sheetCount, int ok, int empty, int failed, string rosterStatus, long elapsedMs);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Ingest ingested nothing: Caller={Caller} Upload={Upload} Failed={Failed}")]
    public static partial void IngestNothingIngested(ILogger logger, string caller, string? upload, int failed);

    // ---- the roster half of an ingest -------------------------------------

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Ingested roster sheet: Sheet={Sheet} File={File} Year={Year} People={People} Upload={Upload}")]
    public static partial void RosterIngested(ILogger logger, string sheet, string file, int year, int people, string upload);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Roster sheet is empty: File={File} Cleared={Cleared} Upload={Upload}")]
    public static partial void RosterEmpty(ILogger logger, string file, bool cleared, string upload);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "No roster sheet in the workbook - the stored running order is unchanged: Upload={Upload}")]
    public static partial void RosterSkipped(ILogger logger, string upload);

    [LoggerMessage(Level = LogLevel.Error,
        Message = "Clearing the running order for an emptied roster sheet failed: Upload={Upload}")]
    public static partial void RosterClearFailed(ILogger logger, Exception exception, string upload);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Roster sheet rejected by the reader: Upload={Upload} Reason={Reason}")]
    public static partial void RosterRejected(ILogger logger, string upload, string reason);

    [LoggerMessage(Level = LogLevel.Error,
        Message = "Reading the roster sheet failed unexpectedly: Upload={Upload}")]
    public static partial void RosterReadFailed(ILogger logger, Exception exception, string upload);

    [LoggerMessage(Level = LogLevel.Error,
        Message = "Saving the running order failed: Upload={Upload}")]
    public static partial void RosterSaveFailed(ILogger logger, Exception exception, string upload);

    // ---- the read routes ------------------------------------------------------

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Running order requested: Found={Found}")]
    public static partial void RunningOrderRequested(ILogger logger, bool found);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "File listing returned: Directory={Directory} FileCount={FileCount} Files={Files}")]
    public static partial void FilesListed(ILogger logger, string directory, int fileCount, string files);

    [LoggerMessage(Level = LogLevel.Error,
        Message = "Listing the autofill store failed: Directory={Directory}")]
    public static partial void FilesListFailed(ILogger logger, Exception exception, string directory);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Autofill file requested: File={File}")]
    public static partial void DownloadRequested(ILogger logger, string file);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Autofill file request refused - not a valid filename: File={File}")]
    public static partial void DownloadRefused(ILogger logger, string file);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Autofill file requested but not ingested yet: File={File}")]
    public static partial void DownloadNotFound(ILogger logger, string file);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Autofill file served: File={File} Hash={Hash}")]
    public static partial void DownloadServed(ILogger logger, string file, string hash);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Group data requested: File={File}")]
    public static partial void GroupsRequested(ILogger logger, string file);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Group data request refused - not a valid filename: File={File}")]
    public static partial void GroupsRefused(ILogger logger, string file);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Group data requested but not ingested yet: File={File}")]
    public static partial void GroupsNotFound(ILogger logger, string file);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Group data served: File={File}")]
    public static partial void GroupsServed(ILogger logger, string file);
}

/// <summary>Log messages for AutofillStore (the on-disk home of the live files).</summary>
internal static partial class StoreLog
{
    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Autofill store directory does not exist yet - listing is empty: Directory={Directory}")]
    public static partial void DirectoryMissing(ILogger logger, string directory);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Store write starting: File={File} Bytes={Bytes}")]
    public static partial void WriteStarting(ILogger logger, string file, int bytes);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Store write completed: File={File} Bytes={Bytes}")]
    public static partial void WriteCompleted(ILogger logger, string file, int bytes);

    [LoggerMessage(Level = LogLevel.Error,
        Message = "Store write failed: File={File} Directory={Directory}")]
    public static partial void WriteFailed(ILogger logger, Exception exception, string file, string directory);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Store file removed: File={File}")]
    public static partial void FileRemoved(ILogger logger, string file);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Store file to remove was not there: File={File}")]
    public static partial void FileNotThere(ILogger logger, string file);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Store refused an unsafe filename: File={File}")]
    public static partial void UnsafeFileName(ILogger logger, string? file);

    [LoggerMessage(Level = LogLevel.Debug,
        Message = "Content hash worked out: File={File} Hash={Hash}")]
    public static partial void HashComputed(ILogger logger, string file, string hash);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Content hash could not be worked out - the page will compare modified times instead: File={File}")]
    public static partial void HashFailed(ILogger logger, Exception exception, string file);
}

/// <summary>Log messages for the service's start-up and process-level faults.</summary>
internal static partial class StartupLog
{
    [LoggerMessage(Level = LogLevel.Information,
        Message = "UploaderService ready: Environment={Environment} StoreDirectory={StoreDirectory} StoreDirectoryExists={StoreDirectoryExists} UploadersGroup={UploadersGroup}")]
    public static partial void ServiceReady(ILogger logger, string environment, string storeDirectory, bool storeDirectoryExists, string uploadersGroup);

    [LoggerMessage(Level = LogLevel.Critical,
        Message = "Unhandled exception on a background thread: IsTerminating={IsTerminating}")]
    public static partial void UnhandledException(ILogger logger, Exception exception, bool isTerminating);

    [LoggerMessage(Level = LogLevel.Error,
        Message = "Unobserved task exception")]
    public static partial void UnobservedTaskException(ILogger logger, Exception exception);
}

/// <summary>Log messages for the request-logging middleware (see RequestLoggingMiddleware).</summary>
internal static partial class RequestLog
{
    [LoggerMessage(Level = LogLevel.Information,
        Message = "Request completed: Method={Method} Path={Path} Status={Status} ElapsedMs={ElapsedMs} Caller={Caller}")]
    public static partial void Completed(ILogger logger, string method, string path, int status, long elapsedMs, string caller);

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Request completed with a client error: Method={Method} Path={Path} Status={Status} ElapsedMs={ElapsedMs} Caller={Caller}")]
    public static partial void ClientError(ILogger logger, string method, string path, int status, long elapsedMs, string caller);

    [LoggerMessage(Level = LogLevel.Error,
        Message = "Request failed with an unhandled exception: Method={Method} Path={Path} ElapsedMs={ElapsedMs} Caller={Caller}")]
    public static partial void Failed(ILogger logger, Exception exception, string method, string path, long elapsedMs, string caller);
}
