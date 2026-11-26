# Repository plugin distribution

The macOS preview installs as `gbc-scene-forge-macos@gbc-scene-forge-repository`.
In Codex it appears as **GBC Scene Forge** with the project's pixel-art anvil icon.
The initial artifact requires **local macOS 27.0+ on Apple Silicon**, with Codex
CLI/app-server **0.167.1** as its tested client baseline. The conservative OS floor
bounds this artifact to the observed major OS; older macOS has not been tested.
The [native macOS candidate workflow](PLUGIN-RELEASES.md) prepares archives,
checksums, inventories and trust evidence. Milestone 25 targets the Apple Silicon
preview, with installed-client and release acceptance in [#263](https://github.com/cliffom/gbc-scene-forge/issues/263).
Windows x64 and Linux x64 are deferred to [#283](https://github.com/cliffom/gbc-scene-forge/issues/283)
and [#284](https://github.com/cliffom/gbc-scene-forge/issues/284), respectively.
Intel macOS, WSL, remote/cloud execution and other clients are not supported by
this artifact.
A shell host check rejects other architectures before trying the executable;
the manifest does not select or download native binaries.

The [manifest](../plugin/plugin.json), [MCP configuration](../plugin/mcp.json),
[entry skill](../plugin/skills/forge-start/SKILL.md) and
[catalog template](../plugin/marketplace.json) follow the
[official plugin packaging guide](https://developers.openai.com/plugins/build/plugins),
consulted on 2026-11-11. Portable packages discover root `skills/`; the entry skill
links its bundled compatibility resource. The packaged
[artwork](../plugin/skills/forge-artwork/SKILL.md) and
[animation](../plugin/skills/forge-animation/SKILL.md) skills include local editing
contracts and representative workflow checks, so authoring does not depend on a
source checkout or external image service. The
[scene skill](../plugin/skills/forge-scenes/SKILL.md) also bundles outcome routes,
portable export/reopen guidance and representative blockout/composition checks.
No lifecycle hooks or first-use dependency
installation are needed. Client availability and public-directory eligibility are
separate from repository distribution (#265).

## Build and install

First [build and verify the runtime](RUNTIME-BUNDLES.md), then:

```sh
make package-plugin PYTHON=.venv/bin/python BUNDLE=build/runtime/forge-0.47.1-macos-arm64
codex plugin marketplace add "$PWD/build/plugin-repository/gbc-scene-forge-0.47.1-macos-arm64"
codex plugin add gbc-scene-forge-macos@gbc-scene-forge-repository
```

The [packager](../runtime/package_plugin.py) produces a versioned directory and
matching `.tar.gz`. The directory is a complete repository source, containing
`.agents/plugins/marketplace.json` and `plugins/gbc-scene-forge-macos/` with launcher, skills,
compatibility resource, frozen runtime, production editor, demo and notices.
This source checkout itself does not contain the native binary. Extract archives
preserving executable modes/internal symlinks, move the entire directory to its
final location, then register it. Keep the source available while configured.

The [Git marketplace on `main`](../.agents/plugins/marketplace.json) lists the
latest released build for each supported platform. Register the repository and
install the macOS listing:

```sh
codex plugin marketplace add cliffom/gbc-scene-forge
codex plugin add gbc-scene-forge-macos@gbc-scene-forge-repository
```

Each entry uses `git-subdir` to pin a verified bundle by commit. For a checkout
registered with the old `distribution/plugins` ref, remove that marketplace
registration and add the default marketplace using the commands above.

The client copies the plugin into its managed cache; runtime launch uses only that
copy. Start with [project selection](PLUGIN-START.md). `bin/forge --identity` and
`plugin_status.installation` expose plugin/runtime versions, target and content
build ID. `--version` retains the ordinary Forge runtime version.

## Publish a bundle

1. Set the Forge package, runtime, plugin manifest, and plugin compatibility pin to
   the same version. Cut the matching `v<semver>` source tag from `main`, complete
   the [macOS signing and archive checks](PLUGIN-RELEASES.md), and use that source
   tag for the GitHub release.
2. Commit the verified bundle in a disposable Git checkout. Preserve executable
   modes and symlinks. Publish an annotated `gbc-scene-forge-bundle-<release-tag>-<target>`
   tag at that commit, such as `gbc-scene-forge-bundle-v0.47.1-macos-arm64`.
   GitHub tag protection prevents moving or deleting the published tag.
3. Attach the exact signed archive, checksums and verification evidence to the
   GitHub release. Link the immutable bundle tag in the release notes.
4. Update that platform's pin on `main` through a PR. Keep other platform entries
   at their current release commits. Verify installation from the default catalog
   and compare the public release download with the signed archive.

## Compatibility and incomplete installations

The [compatibility resource](../plugin/compatibility.json) binds a plugin version
to exactly one Forge version, project manifest format 1 and selection format 1.
Startup checks these before project/settings access; domain readers independently
reject unsupported project versions before mutation. No migration is implemented.
A future format change needs an explicit backup/recovery plan before promising
rollback.

Each stage receives `install.json`, a content inventory and build ID covering
binaries, static resources, skills, configuration and notices. Startup rejects
missing/changed files, lost executable modes, external symlinks and mixed contents.
These hashes detect incomplete copies; they do not authenticate a publisher.
Use the eventual #263 release verification policy. Errors explain how to restore
a complete bundle without downloading dependencies or repairing projects.

Packaging verifies a private temporary stage and atomically renames the complete
repository into view. Existing destinations are rejected. An interrupted stage is
never a registered source; retain the previous complete directory. Interruption
after directory publication can leave a complete directory without its archive;
rebuild under a new output directory instead of replacing it in place.

## Update and rollback

Treat each installed version/build as immutable. Extract updates into a new
versioned directory and retain the old source for rollback. **Finish/save or export
work, explicitly stop the managed browser and close old chats before installing
an update.** Codex 0.167.1 removes the previous cache when adding the new version;
separate versioned source directories do not preserve running cache files. Never
overwrite running resources or reuse a plugin version for different bytes.
For local sources, remove the old marketplace registration, add
the new directory with the same catalog identity, then run
`codex plugin add gbc-scene-forge-macos@gbc-scene-forge-repository`. Git sources use
`codex plugin marketplace upgrade gbc-scene-forge-repository` before adding the update.
Start a fresh conversation to load its skills/MCP; refresh does not update a running
session.

When moving to alpha.9, remove the older plugin and marketplace before adding the
new source. Alpha.8 used `scene-forge-macos@scene-forge-repository`. Alpha.7 and
earlier used `scene-forge@scene-forge-repository`. Run `codex plugin remove` with
the installed selector, then run `codex plugin marketplace remove scene-forge-repository`.
Select or reopen the same game folder after installing the new plugin.

MCP sessions pin their installation and reject changes before tool dispatch.
Managed browsers check their pinned installation before project requests.
Each session hashes the full installation at startup, then checks file/directory
metadata (including the receipt, inode, modes, size, mtime and ctime) on requests.
A metadata change triggers full content/compatibility validation against the
pinned build before access continues. Unchanged polling and project-lock guards
do not reread runtime contents. Changes during validation are rejected rather
than cached. This local-filesystem optimization retains the corruption-detection
boundary; it does not authenticate a publisher or protect against privileged
tampering with filesystem metadata.
If an update removes a live session's cache, its next tool/project request fails
closed with recovery instructions. This is safe rejection, not uninterrupted
session availability. Its authenticated status/stop endpoint remains usable by
the new runtime; inspect and explicitly stop that instance before reopening.
Different builds cannot reuse one browser even if their Forge versions match.
Inspect status, then only on explicit user request stop that exact browser instance,
let admitted saves finish and reopen. Its stable origin preserves draft recovery.
Chat closure, updates and selection reset do not clear retained project work or
browser storage. Availability still requires a complete compatible installation.

Rollback selects the previous complete repository source and starts a fresh
conversation. It is safe only while that runtime supports the project's format;
there is no rollback promise across migration. If a client removes the previous
cache, restore its complete matching bundle before recovering that session.
Do not kill unknown processes or work around an installation error with another
runtime.

## Disable and uninstall

Finish or export unpublished work before removing old caches. Removing files
from a running installation can make its tools/browser unavailable; guards reject
replacement resources. Disable through the client UI or its tested plugin-enabled
configuration (`[plugins."gbc-scene-forge-macos@gbc-scene-forge-repository"]`, `enabled = false`
in the user configuration). The tested app-server plugin loader did not apply the
generic `-c` override; persisted configuration did disable it in a new conversation.
Uninstall with `codex plugin remove gbc-scene-forge-macos@gbc-scene-forge-repository`;
remove the source registration separately with
`codex plugin marketplace remove gbc-scene-forge-repository`. Disable/uninstall does
not itself stop an existing browser. Use its explicit stop flow first when needed.

Projects/retained candidates remain in the chosen directory. Selection settings
remain under `~/Library/Application Support/Scene Forge/`; ownership/logs use
`~/Library/Caches/Scene Forge/`. Checkpoints, Undo and deliberate workspace layout
belong to the browser's origin/profile. Plugin removal must not clear these
locations. Reset forgets only the grant. Do not clear browser data or change its
origin during recovery. See [process/draft ownership](PLUGIN-START.md#managed-browser-handoff-and-process-recovery).
Scoped evidence and remaining client/platform/release checks stay in the
[validation record](VALIDATION.md#remaining-checks).

## Verify a staged repository

Run the macOS-only isolated client harness without changing personal client state:

```sh
.venv/bin/python tests/packaging/plugin_distribution_smoke.py \
  --archive build/plugin-repository/gbc-scene-forge-0.47.1-macos-arm64.tar.gz \
  --codex /absolute/path/to/codex --output build/plugin-distribution-check
```

Use a new output directory. The harness uses synthetic selection and a synthetic
second plugin version; it needs the actual Codex executable, not model credentials.
It leaves diagnostics and `result.json` in that output. It does not claim a native
model turn, human usability, hosted Git delivery or signed-download acceptance.
