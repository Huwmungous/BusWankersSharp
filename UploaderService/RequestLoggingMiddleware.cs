using System.Diagnostics;
using System.Security.Claims;

namespace Autofills.UploaderService;

/// <summary>
/// Puts <see cref="RequestLoggingMiddleware"/> at the very front of the pipeline.
/// Registered as a singleton IStartupFilter from Program.cs's ConfigureServices.
/// </summary>
public sealed class RequestLoggingStartupFilter : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) =>
        app =>
        {
            app.UseMiddleware<RequestLoggingMiddleware>();
            next(app);
        };
}

/// <summary>
/// One log line per request, written AFTER the response has been produced: method,
/// path, status, elapsed milliseconds and the signed-in caller. Without it a
/// request that never reached a controller action (a 401 for a missing or
/// expired token, a 404 for a wrong URL, a 413 for an oversized upload, a 403 from
/// the "Uploaders" policy) left no trace at all in the logs.
///
/// Where it sits: it has to be the OUTERMOST middleware. ServiceFactory's
/// ConfigurePipeline hook runs after UseAuthentication/UseAuthorization, and a 401
/// or 403 is answered by those two without ever reaching anything added there -
/// exactly the requests this exists to record. So it is added by an
/// IStartupFilter (<see cref="RequestLoggingStartupFilter"/>), which wraps the
/// whole pipeline. The caller is read after the response has been produced, by
/// which time authentication has populated HttpContext.User (an anonymous caller
/// is logged as "anonymous").
///
/// Deliberately light: the log call comes after next() has returned, so it can
/// never add to the time between the moments GET /api/time stamps its reply (the
/// sale-day launcher reads any delay there as clock error). /Health and the
/// Swagger pages are skipped - the health probe fires constantly and would bury
/// everything else. Query strings are never logged (they could carry tokens).
/// </summary>
public sealed class RequestLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<RequestLoggingMiddleware> _log;

    public RequestLoggingMiddleware(RequestDelegate next, ILogger<RequestLoggingMiddleware> log)
    {
        _next = next;
        _log = log;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (IsQuiet(context.Request.Path))
        {
            await _next(context);
            return;
        }

        var started = Stopwatch.GetTimestamp();
        try
        {
            await _next(context);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            RequestLog.Failed(_log, ex, context.Request.Method, context.Request.Path.Value ?? "/",
                ElapsedMs(started), CallerOf(context));
            throw;
        }

        var status = context.Response.StatusCode;
        var elapsedMs = ElapsedMs(started);
        var path = context.Request.Path.Value ?? "/";

        if (status >= 400)
            RequestLog.ClientError(_log, context.Request.Method, path, status, elapsedMs, CallerOf(context));
        else
            RequestLog.Completed(_log, context.Request.Method, path, status, elapsedMs, CallerOf(context));
    }

    private static bool IsQuiet(PathString path) =>
        path.StartsWithSegments("/Health", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWithSegments("/swagger", StringComparison.OrdinalIgnoreCase);

    private static long ElapsedMs(long startedTimestamp) =>
        (long)Stopwatch.GetElapsedTime(startedTimestamp).TotalMilliseconds;

    /// <summary>Same order of preference as UploadServiceController.CallerName; "anonymous" when nobody signed in.</summary>
    private static string CallerOf(HttpContext context)
    {
        var user = context.User;
        if (user.Identity?.IsAuthenticated != true)
            return "anonymous";

        return user.FindFirstValue("preferred_username")
            ?? user.Identity?.Name
            ?? user.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? user.FindFirstValue("sub")
            ?? "unknown";
    }
}
