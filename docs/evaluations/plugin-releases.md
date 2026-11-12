# macOS release candidate evidence (#263)

This evaluation bounds the first macOS candidate implementation. It does not
complete the cross-platform issue or certify downloaded plugin installation.
Procedure and support decisions are in [plugin releases](../PLUGIN-RELEASES.md);
remaining acceptance stays in [validation](../VALIDATION.md#remaining-checks).

## Local signed candidate

The candidate was built from clean tracked source revision
[`1466753`](https://github.com/cliffom/gbc-scene-forge/commit/1466753),
observed on 2026-11-11 Pacific / 2026-11-12 UTC, macOS 27.0.1 ARM64 with Codex
CLI/app-server 0.167.1. Forge remains 0.46.1 and plugin 0.1.0-alpha.1 under the
milestone's deferred-release policy. The
[release metadata](assets/plugin-releases/release.json) records source/diff/tool
hashes, archive digest, build identity and exact pinned inputs. The
[archive report](assets/plugin-releases/archive-check.json) retains signatures,
Gatekeeper diagnostics, SDK and lifecycle results. The
[dependency inventory](assets/plugin-releases/dependency-inventory.json) is a
build-environment superset; complete license files remain inside the archive.
The [original checksum manifest](assets/plugin-releases/SHA256SUMS) refers to the
candidate archive and original JSON filenames. The signed archive is a local
build output, not committed or independently retained by this report.

The native build used the existing Developer ID Application identity. All four
Mach-O payloads passed strict signature verification; each has Developer ID
provenance, hardened runtime and a secure timestamp. This is signature validity
on this host, not an ordinary-user trust result. `spctl --assess --type execute`
returned **3**, with **“rejected (the code is valid but does not seem to be an
app)”**. No notarization, quarantine removal or OS trust override was performed.
The command assesses the raw executable; its rejection does not establish how a
client will treat a downloaded/notarized archive and copied plugin cache.

The actual archive was hashed, extracted and relocated to a directory with spaces
and an accented character. Installation write bits were removed. The installed
launcher returned its matching identity with no Python/Node/development tools on
PATH, and all installation contents remained unchanged. Official-SDK automation
created/edited/reviewed native artwork, rejected a stale save, committed/rendered
artwork and a scene, exported portable Tiled content and reopened it through a
fresh MCP process. Managed browser recovery exercised shared sessions, abrupt MCP
exit, restart/origin preservation, durable candidates and expired session previews.

The actual Codex executable installed the archive into isolated client state.
Synthetic grants/version changes exercised discovery, incomplete-copy rejection,
update/browser isolation, rollback, persisted disable and uninstall. User projects,
retained candidates and deliberate settings remained intact. This is actual client
installation with synthetic test interactions; it contains no model turn, native
folder-dialog acceptance or independent-user journey.

Chromium acceptance launched the extracted SDK-tested frozen runtime, created the
bundled sample, opened/reloaded its saved scene and captured rendering at
1440 × 1000. Local `make docs-check lint test` passed with 557 Python tests and
TypeScript suites; production `make build check-dist` passed all seven isolated
installed-wheel checks. This change adds no editor UI behavior. The final candidate
rebuild repeated packaging/native/archive acceptance to bind evidence to committed
source. The local browser reports and archive remain build outputs; raw JSON
above is retained evidence, not an archived binary or CI-pass claim.

## Qualification limits

The [native workflow](../../.github/workflows/plugin-macos.yml) retains separate
candidate and diagnostic artifacts for 30 days. Its ARM64 build host may predate
the advertised macOS 27 client floor: below-floor runs skip installed-plugin
launcher/lifecycle/client acceptance and test the frozen runtime separately.
A build or synthetic installed-client pass does not complete the downloaded
quarantine/trust, actual model/image/browser journey or clean-machine gates.
Protected signing/notarization configuration is code, not evidence that repository
credentials are configured or an Apple submission passed. Windows/Linux native
builds, named floors/libraries, client feasibility and acceptance remain required
milestone outcomes. No additional architectures or remote clients are advertised.

## Hosted startup failure

The first [macOS CI attempt](https://github.com/cliffom/gbc-scene-forge/actions/runs/43176845346)
failed the existing installed-wheel startup timeout before constructing the native
runtime. A [diagnostic attempt](https://github.com/cliffom/gbc-scene-forge/actions/runs/43177259586)
captured its stack in Python's `socket.getfqdn`, called by `HTTPServer.server_bind`
for the numeric loopback address. This was a real startup failure, not a passing
release check. The fix uses shared numeric-address binding for standalone and
managed browser servers, preserving TCP socket binding and ephemeral-port discovery
without reverse DNS. A regression makes reverse DNS raise and verifies both server
classes still bind. Installed-wheel timeout diagnostics now retain the blocked
child stack instead of reporting only an empty output queue.
