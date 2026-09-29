using System.Globalization;
using System.Text;

namespace Autofills.LauncherHelper;

public enum LogLevel
{
    Debug,
    Info,
    Warn,
    Error,
}

/// <summary>
/// Tiny console logger. Messages are a fixed sentence plus key=value attributes
/// (never values spliced into the sentence), so a run can be grepped and a pasted
/// log says exactly what happened and when: "12:00:00.123 INFO  Opened browser
/// browser=Firefox lateMs=2.1". Debug lines only appear with --verbose.
/// </summary>
public sealed class Log
{
    private readonly TextWriter _writer;
    private readonly bool _verbose;
    private readonly object _gate = new();

    public Log(TextWriter writer, bool verbose)
    {
        _writer = writer;
        _verbose = verbose;
    }

    public void Debug(string message, params (string Key, object? Value)[] attributes) => Write(LogLevel.Debug, message, attributes);

    public void Info(string message, params (string Key, object? Value)[] attributes) => Write(LogLevel.Info, message, attributes);

    public void Warn(string message, params (string Key, object? Value)[] attributes) => Write(LogLevel.Warn, message, attributes);

    public void Error(string message, params (string Key, object? Value)[] attributes) => Write(LogLevel.Error, message, attributes);

    public static string Format(DateTimeOffset when, LogLevel level, string message, IEnumerable<(string Key, object? Value)> attributes)
    {
        var text = new StringBuilder();
        text.Append(when.ToString("HH:mm:ss.fff", CultureInfo.InvariantCulture));
        text.Append(' ');
        text.Append(level.ToString().ToUpperInvariant().PadRight(5));
        text.Append(' ');
        text.Append(message);
        foreach (var (key, value) in attributes)
        {
            text.Append(' ');
            text.Append(key);
            text.Append('=');
            text.Append(Render(value));
        }
        return text.ToString();
    }

    private void Write(LogLevel level, string message, IEnumerable<(string Key, object? Value)> attributes)
    {
        if (level == LogLevel.Debug && !_verbose) return;
        var line = Format(DateTimeOffset.Now, level, message, attributes);
        lock (_gate)
        {
            _writer.WriteLine(line);
            _writer.Flush();
        }
    }

    private static string Render(object? value)
    {
        var text = value switch
        {
            null => "null",
            IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
            _ => value.ToString() ?? string.Empty,
        };
        return text.IndexOfAny([' ', '"', '=']) >= 0 ? "\"" + text.Replace("\"", "\\\"") + "\"" : text;
    }
}
