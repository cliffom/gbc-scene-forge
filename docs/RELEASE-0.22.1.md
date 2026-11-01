# Scene Forge 0.22.1

Single-project MCP startup can recover from brief browser/editor lock contention.
Before opening a session, the server retries only explicit project-busy failures
up to 21 attempts with two seconds of retry delays. It reports contention on stderr
and exits with a clear error if the project stays busy. Other opening errors fail
immediately; the declared path and `project` alias remain unchanged.

This compatible fix addresses [#115](https://github.com/cliffom/gbc-scene-forge/issues/115)
and the [MCP authoring reliability milestone](https://github.com/cliffom/gbc-scene-forge/milestone/12).
Install with `python -m pip install --upgrade 'gbc-scene-forge[mcp]==0.22.1'`.
Ordinary editor installs still require no runtime dependencies. Project, Tiled,
draft and tool schemas remain unchanged; no migration is required.

Transaction locks remain nonblocking. The server never retries a submitted tool;
revision conflicts and ambiguous transport/write failures are not replayed or
rebased. Browser drafts and Undo remain independent. See
[MCP retry boundaries](MCP.md#startup-contention-and-retry-boundaries) and
[validation](VALIDATION.md#mcp-startup-contention-115) for behavior and observed checks.
This prepares 0.22.1; tagging and publication are separate steps.
