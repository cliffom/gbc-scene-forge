# Scene Forge 0.3.2

## Server console and activity logs

The server now displays a compact status view with the editor URL, absolute
Project Root path, log location and live client/failure totals. Terminal colors
highlight useful information; redirected output remains plain text.

Clients are identified by IP address and User-Agent. Multiple tabs from the same
browser count once. A client expires after 120 seconds without a request, even
if its tab is still open, and becomes active on its next request.

HTTP requests, client arrivals and expirations, and error details are written to
`.forge-logs/server-PORT.log` under the launch directory. Logs append across launches
and rotate at 1 MiB with three backups. Routine activity does not grow the terminal
output. Each failed HTTP response increments the failure total once, including
unsupported methods and malformed requests; diagnostic details remain in the log.

## Browser icons

Both Apple touch icon URLs now serve the Forge logo in project-root and
direct-project modes, avoiding routine browser icon 404s.

## Compatibility and installation

Manifest schema remains version 1. Existing projects need no format migration.
Loopback binding, host checks, mutation-token protection and conflict-aware
storage remain unchanged. Python 3.10+ is supported, with no additional runtime
dependencies or Node requirement for the installed editor.

```sh
python -m pip install --upgrade gbc-scene-forge==0.3.2
gbc-scene-forge
```

See the [README](../README.md) for setup and the
[editor guide](STANDALONE.md) for controls and project storage.
