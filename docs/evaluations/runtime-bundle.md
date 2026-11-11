# Runtime bundle measurements (#255)

The maintained [runtime build](../../runtime/build.py) implements the PyInstaller
folder approach selected by [the feasibility comparison](plugin-feasibility.md).
The [runtime guide](../RUNTIME-BUNDLES.md) owns commands, inputs and launch behavior.
This record owns measured observations and portability boundaries.

## Environment and method

Measurements use macOS 27.0.1 arm64 on 2026-11-11, integration base
`72c4c68` plus the sources hashed in the archived results. Build inputs are
standalone CPython 3.13.13/build 20260602, uv 0.13.7, PyInstaller 6.22.3,
hooks 2026.10, MCP 1.30.0 and a production Forge 0.46.1 wheel with the
read-only-template staging correction. This is unpublished integration work;
no package or plugin release was created.

The installed-bundle test uses the official MCP SDK as a driver, an empty child
PATH, deliberately invalid external Python settings, a moved read-only bundle and
external project paths containing spaces/non-ASCII characters. Raw stdio checking
parses every stdout line as JSON-RPC. A separate Chromium test creates a sample
through the frozen browser and opens/reloads its saved scene at 1440 × 1000.

## Observed results

[Archived results](assets/runtime-bundle/results.json) retain exact wheel/input
hashes, OS library names, verification-source hashes and the successful SDK run.
The root agent inspected [the captured editor](assets/runtime-bundle/bundled-editor.png):
Riverside's terrain, cottage, sprites, palette and Inspector render from the
bundled sample in headless Chromium 156.0.8078.4. This is agent inspection of a
synthetic capture, not a human/client acceptance report.

| Measure | #254 PyInstaller baseline | Maintained bundle |
| --- | ---: | ---: |
| Installed file bytes (symlink targets counted) | 37,034,985 | 37,953,952 |
| gzip size sample bytes | 18,871,116 | 19,034,650 |
| Process start through SDK initialized response, seconds | 0.680 | 0.264 |
| Discovered MCP tools | 61 | 61 |

The added notices/metadata increase installed bytes by about 2.5% and compressed
bytes by about 0.9%. Build construction took 9.622 seconds with cached dependency
downloads, including extraction/environment setup and excluding the final gzip
size sample. The earlier baseline's construction scope differs, so it is not a
build-speed comparison. Both startup values are single warm-host observations;
the new run follows help/framing checks and does not establish a speedup.

The successful smoke run created/reopened a project, rejected a stale review,
saved/rendered/reopened exact native artwork, saved/rendered a scene, exported its
Tiled map and matching atlas, reopened the exported project in a fresh process,
restored the packaged demo and served production HTTP assets. Raw stdout was
valid JSON-RPC, diagnostics stayed on stderr, all installed content hashes were
unchanged and runtime PATH was empty. Existing optional-MCP regression and
installed-wheel browser suites are separate evidence; the driver needs the SDK.

## Material findings and limits

The first read-only sample restoration failed with permission denied: `copytree`
retained template permissions in staging, preventing the new project's name from
being written. Sample creation now makes only its newly owned staging tree
owner-writable, before renaming it to the external destination. Regression
coverage verifies a named project can be created and its scene saved while the
read-only template's files and permissions remain unchanged.

Only native macOS arm64 construction/execution is implemented. The executable
and CPython link to Apple-provided libSystem, zlib, ncurses/panel, libedit,
CoreFoundation and SystemConfiguration; the archived dependency list identifies
libiconv used by collected Python extensions. Those OS
libraries are required. No Homebrew Python, Node or non-system absolute native
library path is required by the inspected bundle. Browser review additionally
requires an installed supported browser. Headless Chromium is a verification
tool, not part of the runtime.

One host and one SDK dependency graph do not establish a minimum macOS version,
Windows/Linux support, clean-VM installation, download/quarantine behavior,
signing/notarization or native Codex image review. #254 retains its native client
visual gate; #258/#263 own platform delivery and release validation. Runtime PATH
is empty during automation, but developer tools remain installed elsewhere on the
host. APNG/client model ingestion and the default OS browser opener were not
assessed by this issue. Startup observations are process-through-initialize
measurements, not cold-start distributions or end-to-end plugin installation time.
Build and gzip timestamps/native signatures are environment inputs; hashes record
provenance rather than claiming bit reproducibility.
