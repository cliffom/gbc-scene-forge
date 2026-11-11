# Self-contained Codex plugin feasibility (#254)

The macOS arm64 runtime prototype works through Codex's local plugin installer
and app-server MCP connection. Prefer a PyInstaller folder bundle for the next
packaging step: it passed the same checks as private Python at 28% of its installed
file bytes and 53% of its compressed bytes. This is a **conditional go for further
development**, not a supported plugin release. Native chat image inspection and
user-visible review remain unverified, so #254 is not complete.

The [source probe](../../examples/plugin_probe/entry.py),
[builder](../../examples/plugin_probe/build.py),
[verification harness](../../examples/plugin_probe/verify.py) and
[client bridge](../../examples/plugin_probe/client.py) reuse the unchanged 0.46.1
wheel, official MCP SDK and normal domain services. No product UI, remote MCP
transport or arbitrary filesystem tools were added. The small packaged skill
introduces a task, image review, revision guards and browser handoff; it is not the
full onboarding planned in #256.

## Environment and client boundary

Measured on 2026-11-11, integration baseline
`ba3faf05dc353dce50cce4051728bd4fb39f8954` plus the probe sources identified by
SHA-256 in [archived results](assets/plugin-feasibility/results.json).
The host was macOS 27.0.1 (26A434), Apple Silicon arm64. Builds used standalone
CPython 3.13.13, uv 0.13.7, PyInstaller 6.22.3/hooks 2026.10, MCP 1.30.0,
Pydantic 2.14.3 and pydantic-core 2.50.4. Source checks used Python 3.13.13 and
Node 24.22.1. The runtime has no Node requirement.

| Surface | Classification | Evidence boundary |
| --- | --- | --- |
| Codex CLI 0.167.1 local plugin install and app-server, macOS arm64 | Verified, bounded | Actual installer/cache, plugin discovery, 61 tools, direct MCP calls and resource reads, guarded save and export |
| Native CLI chat/model turn and inline image UI | Deferred | The app-server bridge did not start a model turn; PNG transport does not establish native chat visibility |
| Codex IDE and desktop plugin execution | Deferred | Neither client installed/launched this plugin in this investigation |
| WSL and remote workspaces | Deferred | No execution or locality proof |
| Linux, Windows and Intel macOS bundles | Deferred | No builds; this prototype launcher explicitly rejects non-Darwin/arm64 |
| Loopback editor in Chromium 156.0.8078.4 | Verified, bounded | Headless Playwright 1.64.1, 1440 × 1000, saved scene and Artwork view |
| VS Code integrated browser, Electron 43.8.3/Chrome 150.0.7871.250 | Unverified after failure | Shell loaded, but image decoding did not settle; no pageerror was captured |

The architecture guard is a prototype restriction, not evidence that other
platforms are inherently unsupported. No minimum macOS version is established.
Only one native machine and one Codex version were tested.

## Comparison and measured behavior

| Measure | Private bundled Python | PyInstaller folder |
| --- | ---: | ---: |
| Installed file bytes (symlink targets counted) | 132,288,887 | 37,034,985 |
| gzip archive bytes | 35,507,260 | 18,871,116 |
| Bundle construction, seconds | 7.649 | 10.582 |
| SDK process start through initialized response, seconds | 0.974 | 0.680 |
| SDK and actual Codex discovered tools | 61 | 61 |
| Inline PNGs received by Codex bridge | 2 | 2 |

Use the JSON for exact observations and archive/wheel digests. Build time excludes
the shared environment/dependency setup and includes archive creation. Startup is
one observation per final bundle, not a cold-start distribution, installation time
or Codex end-to-end startup measurement. Archives are not bit-reproducible: gzip,
tar and native build metadata retain time/environment inputs. Locked dependencies,
source hashes and wheel hash make the comparison inspectable.

Both bundles include the optional MCP dependency graph and native libraries,
including Pydantic's extension. The private runtime copies an unpacked
python-build-standalone prefix and isolated site-packages; the frozen alternative
collects Forge package data, Pydantic data and MCP metadata. Neither runtime
installs dependencies on first use. Build-time downloads are separate.

Each final verification run:

1. Extracted the archive under a relocated `moved source café` path and installed
   its local marketplace with the real `codex plugin` commands into disposable
   client-managed state. Personal Codex configuration and authentication were not
   copied or edited.
2. Executed the cache copy with its marketplace source temporarily unavailable,
   executable bits preserved, the entire plugin tree read-only and `PATH` pointing
   to an empty directory. Deliberately invalid `PYTHONHOME` and `PYTHONPATH` tested
   private Python isolation. SHA-256 contents were unchanged after all operations.
3. Selected an existing external project root before startup, created a project
   and a two-frame sprite candidate, changed pixels, rejected a stale review
   receipt, rendered PNG/APNG resources and committed with the exact current
   receipt. Reopening matched RGBA and descriptor; a new MCP process read the
   saved revision. A sprite placement was saved in a Tiled scene and exported.
4. Restored the marketplace source, let the actual Codex app-server discover and
   launch the plugin, then read the saved candidate, added a pale highlight,
   received two inline PNGs, committed, reopened exact RGBA/descriptor and exported
   a ZIP whose atlas equals the reviewed PNG. The source must remain registered
   for discovery even though cached execution itself survives its absence.
5. Started the bundled loopback browser server against the same selection, served
   HTML/JS/CSS/branding and scene APIs, and checked final atlas bytes against both
   saved storage and the client export. A separate Chromium capture opened the
   final scene and double-clicked its artwork into the editor.

### Visual evidence and its limits

The root agent inspected the archived [native PNG](assets/plugin-feasibility/native.png),
[integer nearest-neighbor PNG](assets/plugin-feasibility/enlarged.png),
[frame contact sheet](assets/plugin-feasibility/frames.png) and
[Codex bridge refinement PNG](assets/plugin-feasibility/client-preview-1.png)
through the host image tool. The amber and cyan frames remain distinct; the final
amber frame includes the added pale highlight. The contact sheet is a static
inspection fallback with frame rectangles; the probe sequence declares 120/240 ms
durations. [APNG bytes](assets/plugin-feasibility/animation.apng) include animation
chunks, but playback was not assessed.

The saved [scene](assets/plugin-feasibility/browser-final-scene.png) and
[Artwork editor](assets/plugin-feasibility/browser-final-artwork.png) captures show
the same refined sprite at 1440 × 1000. This establishes agent inspection of
artifacts from an installed plugin and synthetic browser rendering. It does not
establish native client model image ingestion, human review, animation comfort or
an unguided onboarding outcome. The remaining acceptance gate is tracked only in
[Remaining checks](../VALIDATION.md#remaining-checks).

## Installation and selection contract

Use the official portable layout: root `plugin.json` and `mcp.json`,
`skills/forge-probe/SKILL.md`, and `bin/forge`. The manifest identifies a required
local executor. The verified MCP launch declaration uses a **contained relative
command** plus an explicit plugin working directory:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "forge": {
      "type": "stdio",
      "command": "./bin/forge",
      "cwd": "${PLUGIN_ROOT}",
      "args": ["mcp"],
      "env": {"FORGE_PLUGIN_PROBE_SETTINGS": "/absolute/external/selection.json"}
    }
  }
}
```

The external selection file contains `{"project_root":"/absolute/existing/projects"}`.
The builder records its absolute path in the generated manifest. The launcher
rejects missing/relative/nonexistent selections, bundle-contained paths including
symlink aliases, and attempts to override the root through command arguments.
It uses the settings parent for logs so a read-only cache remains usable. Project
creation, conflict-aware saves, loopback binding and browser mutation tokens still
belong to existing Forge services.

This selection is deliberately a probe fixture, not a production setup flow.
Each archive contains a machine-specific settings path and must be rebuilt or
reconfigured for a different selection location. #256 must define explicit
selection/reconfiguration before the MCP server starts; #257 must turn this
runtime experiment into a maintained build contract. #258 must retain executable
permissions and source discovery semantics. The skill cannot launch/manage a
browser through MCP today; use the external `bin/forge browser` command. Browser
process management belongs to the downstream handoff contract.

### Material failures and corrections

- PyInstaller `--collect-all mcp` imported its optional CLI and exited because
  Typer was absent. The final build follows stdio imports and copies MCP metadata;
  it does not add an unused CLI dependency.
- An initial executable declaration using `${PLUGIN_ROOT}/bin/forge` failed
  discovery/launch. A compatibility-layout experiment did not resolve that
  placeholder. Portable-only manifests with `./bin/forge` and the explicit `cwd`
  above passed. The earlier failure does not establish portable-format rejection.
- Removing the local marketplace source made client discovery return no plugin,
  despite the installed executable working with the SDK. Restore the source
  before client discovery; cached bytes alone do not prove source-independent
  lifecycle behavior in this client.
- A browser launched with its working directory inside the read-only cache could
  not place logs there. The final launcher changes to external probe data.
- The integrated-browser attempt stalled while decoding an atlas. Chromium
  headless rendered the same saved bytes. This is an unresolved client/browser
  boundary, not a universal browser pass.

## Delivery decision

Repository/local marketplace distribution can carry an executable and its private
runtime on this client/platform. The probe proves a roughly 19 MB gzip archive
works locally; it establishes no documented upper size limit, hosted marketplace
upload limit or automatic OS/architecture asset selection. Keep the platform
boundary explicit instead of shipping a universal launcher claim.

Signing, notarization, quarantine/download behavior, oldest supported macOS,
third-party notice completeness, upgrades/uninstall and production archive
verification were not established by local extraction. These are delivery
contract inputs for #257/#258/#265, not evidence of release readiness.

Public directory eligibility is separate from repository installation. The
[official plugin packaging guide](https://developers.openai.com/plugins/build/plugins)
and [desktop-only submission guidance](https://developers.openai.com/plugins/deploy/desktop-only)
were consulted on 2026-11-11. Local MCP public submission has a separate
allowlisting/partner constraint; a working local marketplace does not grant public
directory approval. No public submission was attempted.

Proceed with PyInstaller-based development while retaining private Python as the
tested fallback. Do not designate a supported client or publish the milestone
until the outstanding visual/client and delivery boundaries have evidence. There
is no Forge version bump, tag or release from this experimental issue PR.

## Reproduce

Use macOS arm64, the normal repository build prerequisites, Codex CLI 0.167.1 and
uv 0.13.7. Build the production wheel first; build dependencies require network
access, whereas installed Forge runtime calls do not require downloads.

```sh
FORGE_BUILD_MODE=production make build check-dist
uv python install 3.13.13 --install-dir build/plugin-probe/python
mkdir -p build/plugin-probe/data/projects
python3 - <<'PY'
import json
from pathlib import Path
data = Path('build/plugin-probe/data').resolve()
(data / 'selection.json').write_text(json.dumps({'project_root': str(data / 'projects')}))
PY
.venv/bin/python examples/plugin_probe/build.py \
  --wheel dist/gbc_scene_forge-0.46.1-py3-none-any.whl \
  --python build/plugin-probe/python/cpython-3.13.13-macos-aarch64-none/bin/python3.13 \
  --settings build/plugin-probe/data/selection.json \
  --output build/plugin-probe/comparison --uv "$(command -v uv)"
build/plugin-probe/comparison/build-env/bin/python examples/plugin_probe/verify.py \
  --archive build/plugin-probe/comparison/private-python.tar.gz \
  --output build/plugin-probe/private-check --codex "$(command -v codex)"
build/plugin-probe/comparison/build-env/bin/python examples/plugin_probe/verify.py \
  --archive build/plugin-probe/comparison/pyinstaller.tar.gz \
  --output build/plugin-probe/frozen-check --codex "$(command -v codex)"
make docs-check lint test
```

Outputs must be new disposable directories. Run the harness normally, without
Python's `-O` flag: its fidelity checks use assertions. It leaves local source,
client cache, reports and projects for inspection. Logs/full tool schemas are
local diagnostics; only sanitized results and small images are committed here.
The client bridge requests no model turn or credentials, although app-server
prewarming may attempt a Responses connection and log failure without affecting
MCP calls. Dependency locks record their regeneration commands; do not silently
substitute the host Python for python-build-standalone.

For native chat acceptance, use a separately authenticated native Codex client
with the generated marketplace installed, the external selection configured and
the source still available. Ask it to inspect both actual review PNGs, explain
the highlight, inspect animation frames/timing, refine and commit the exact
reviewed candidate, then reopen/export. Record which images the client displays
and what the model can actually inspect; do not substitute the bridge report for
those observations or copy personal credentials into probe outputs.

For browser inspection, launch the installed cache's `bin/forge browser --port 0
--no-browser` with the same external settings environment. Open the reported URL
with `projects/<report.project>/scenes/<report.scene_id>` appended, then
double-click `lantern/idle` to open saved artwork. The automated HTTP probe does
not perform this visual step or launch the default OS browser; all captured
browser observations above used headless Chromium.
