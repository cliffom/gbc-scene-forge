# Self-contained runtime bundles

The experimental milestone 25 runtime is a native PyInstaller folder containing
Forge, CPython, the optional MCP SDK/dependencies, the production editor and demo.
It needs no installed Python, Node, npm, Poetry or checkout at runtime. Keep the
whole folder together when moving it. This is build infrastructure for the
[authoring plugin milestone](https://github.com/cliffom/gbc-scene-forge/milestone/25),
not an installable supported plugin release. Ordinary zero-required-dependency
Python wheels and their launchers remain supported.

The initial target is **macOS arm64**, following the
[feasibility decision](evaluations/plugin-feasibility.md). The builder rejects
other hosts. The [repository packager](PLUGIN-DISTRIBUTION.md) stages initial-platform
delivery. The [macOS candidate workflow](PLUGIN-RELEASES.md) adds native CI,
archive verification and optional Developer ID signing. Windows x64/Linux x64
builds and final release/client qualification remain #263. No universal OS or client compatibility is
claimed. See [measurements and limitations](evaluations/runtime-bundle.md).

## Launch contract

Use an absolute, existing project directory outside the runtime folder and its
parents. Symlink aliases are resolved before checking containment. The browser
can create projects inside a selected parent; `--project` opens one existing
project. There is no implicit current-directory selection. Alternatively,
`mcp --plugin` starts with per-user selection and a native setup dialog;
see [plugin selection and first task](PLUGIN-START.md).

```sh
/path/to/forge-folder/forge --version
/path/to/forge-folder/forge --help
/path/to/forge-folder/forge browser --help
/path/to/forge-folder/forge browser --project-root '/path/to/My projects'
/path/to/forge-folder/forge browser --project '/path/to/My projects/forest' --no-browser --port 0
/path/to/forge-folder/forge mcp --project-root '/path/to/My projects'
/path/to/forge-folder/forge mcp --project '/path/to/My projects/forest'
/path/to/forge-folder/forge mcp --plugin
/path/to/forge-folder/forge browser --plugin --project-name forest
```

Browser mode binds to loopback, defaults to an available port and prints its URL
to stderr. Without `--no-browser`, it calls the existing OS browser opener. Logs
live under `.forge-logs/` in the selected directory for direct launch arguments;
plugin mode uses the separate per-user cache. Browser diagnostics and
launch errors use stderr; MCP stdout contains only newline-delimited JSON-RPC.
Help/version output goes to stdout and exits without opening a project. No
runtime downloads or writes to the installation are needed. Save revisions,
review receipts, mutation tokens and declared project path guards remain owned by
the existing services. Stop a foreground process with Ctrl+C. Plugin launches use [managed browser handoff](PLUGIN-START.md#managed-browser-handoff-and-process-recovery),
with authenticated reuse, an idle lifetime and a stable restart address. Direct
launches remain foreground processes.

## Build and inspect

Build on native macOS arm64 with the ordinary repository prerequisites, uv
**0.13.7**, Apple command-line build tools (`otool`) and a `tar` with zstd support
(e.g. bsdtar plus `zstd`). These are build tools only. Use new disposable build
and smoke directories; existing directories are rejected instead of overwritten.

```sh
mkdir -p build/runtime-inputs
curl -fL 'https://github.com/astral-sh/python-build-standalone/releases/download/20260602/cpython-3.13.13%2B20260602-aarch64-apple-darwin-pgo%2Blto-full.tar.zst' \
  -o build/runtime-inputs/python.tar.zst
make build-bundle PYTHON=python3.13
make check-bundle
make test-bundle-browser
```

`build-bundle` rebuilds the production wheel, verifies the CPython archive's
SHA-256 from [the versioned configuration](../runtime/config.json), extracts its
private runtime and creates an isolated build environment. The two hashed locks
pin MCP 1.30.0 and PyInstaller 6.22.3/hooks 2026.10 plus their dependency graphs.
Only binary dependency wheels are accepted; the local Forge wheel is installed
without dependency resolution. Build-time downloads require network access.

The output is `build/runtime/forge-VERSION-macos-arm64/forge` alongside
`_internal/`, `notices/` and `bundle.json`. Override `BUNDLE_BUILD`, `BUNDLE`,
`BUNDLE_CHECK`, `PYTHON_ARCHIVE` or `UV` to use other locations. The source
archive includes [the build sources](../runtime/); the ordinary wheel does not
include build tooling. Build metadata records schema version, target, wheel hash,
configuration/source/lock hashes and external OS libraries. The build rejects
native links to absolute non-system paths. The adjacent build report records
construction time, installed file bytes and a temporary gzip size sample. Native
signatures, timestamps and archive metadata mean outputs are not bit-reproducible.

`notices/` includes license files and a versioned inventory from all installed
build-environment distributions (a superset of frozen runtime packages), CPython's
license, its upstream native-library license collection and frontend notices.
This includes the PyInstaller bootloader exception. Preserve these files when
delivering the folder. The full standalone archive is used so native notices are
available; the smaller install-only archive is intentionally not accepted.

Lock headers show their uv regeneration commands. Regenerate on the named target,
review version and hash changes, then rebuild and rerun checks. Python itself is
pinned by archive URL/digest, separately from the dependency locks. Changing the
runtime platform requires its own Python archive, dependency resolution and native
build evidence; replacing the target name alone is insufficient.

## Verification boundaries

[The bundle smoke driver](../tests/packaging/bundle_smoke.py) imports the official
SDK without importing Forge. It copies and moves the built folder under a path
with spaces/non-ASCII characters, makes it read-only and launches from inside it
with an empty PATH and invalid external Python settings. It checks protocol
framing, help/version/errors, project creation, stale review rejection, native
artwork save/render/reopen, scene save/render, ZIP/Tiled export and reopen,
fresh-process reads, packaged HTTP assets and demo restoration. It verifies all
installed file hashes remain unchanged and restores test-copy permissions afterward.
The driver needs the SDK in its test environment; the launched runtime does not
use that interpreter. A clean PATH is not a clean-OS virtual-machine test.

[The optional Chromium test](../tests/playwright/packaging/bundle.spec.ts) launches
the frozen browser with an empty PATH, creates a bundled sample and opens/reloads
its saved scene. It captures the actual editor. Existing installed-wheel, MCP and
browser suites remain separate checks. Runtime tests do not establish native
Codex model image inspection, client installation, default OS browser opening,
oldest supported macOS, signing or quarantine behavior. Outstanding acceptance
stays in [Remaining checks](VALIDATION.md#remaining-checks).
