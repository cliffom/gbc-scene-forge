# macOS release candidate evidence (#263)

This evaluation bounds the first macOS candidate implementation. It does not
complete the cross-platform issue or certify downloaded plugin installation.
Procedure and support decisions are in [plugin releases](../PLUGIN-RELEASES.md);
remaining acceptance stays in [validation](../VALIDATION.md#remaining-checks).

## Local signed candidate

The candidate was built from clean tracked source revision
[`4720f9a`](https://github.com/cliffom/gbc-scene-forge/commit/4720f9a),
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
app)”**. At build time, no notarization, quarantine removal or OS trust override was performed.
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
1440 × 1000. Local `make docs-check lint test` passed with 558 Python tests and
TypeScript suites; production `make build check-dist` passed all seven isolated
installed-wheel checks. This change adds no editor UI behavior. The final candidate
rebuild repeated packaging/native/archive acceptance to bind evidence to committed
source. The local browser reports and archive remain build outputs; raw JSON
above is retained evidence, not an archived binary or CI-pass claim.

## Local notarization and quarantined download

On 2026-11-12 UTC, the user configured the local `forge-notary` Keychain profile
and authorized submission of the same signed candidate. The original tar archive
SHA-256 remains
`34981c5dc53e2475e2871c99d6db1fa3d5824a13fe5b0cc8644db59e1c9e6a3b`,
from source revision `4720f9a36d005b2df1cef092dbc767446856c203`. `ditto` wrapped
its extracted repository in a ZIP with SHA-256
`240d2c66c4408f0dd512e1ab6ca210f61efa6d456e0cb51b38904709b6ec57eb`.
Apple [accepted the submission](assets/plugin-releases/notarization.json)
`1227be35-3516-4e7e-b947-a71834bb8d49`; the
[notary log](assets/plugin-releases/notarization-log.json) reports no issues and
tickets for all four ARM64 Mach-O payloads. The original build-time reports remain
unchanged; this later observation establishes local notarization, not a signed
CI-dispatch or publication result.

On the existing macOS 27.0.1 ARM64 developer host, headful Chrome
157.0.8103.78 used an isolated temporary profile to download the actual tar archive
over loopback HTTP. The [download observation](assets/plugin-releases/quarantined-download.json)
records Chrome's `com.apple.quarantine` value. Playwright `saveAs` lost that marker;
that saved copy is not qualification evidence. A subsequent download retained its
original attributes through macOS `ditto`, and Archive Utility propagated the
marker to the extracted launcher, runtime and native libraries. The archive hash
matched the signed candidate. This is browser automation on the developer account,
not hosted HTTPS delivery or an independent-user/clean-machine test.

All four extracted Mach-O files passed strict signature verification with
`--check-notarization`. However, the
[quarantined launcher observation](assets/plugin-releases/quarantined-launch.json)
failed: `bin/forge --identity` terminated with SIGKILL (return code -9).
The [scoped macOS policy log](assets/plugin-releases/quarantined-launch.log)
records a system prompt followed by Gatekeeper rejection for the signed `forge`
executable. The user subsequently confirmed dismissing that prompt and requested
a retry; its wording was not captured. Before retry, an explicit `-R=notarized`
requirement returned 3 on both the extracted and original executables despite
Apple's accepted submission. Signature verification without that requirement
did not establish local ticket availability.
The separate raw-executable `spctl` assessment still returns 3, “the code is valid
but does not seem to be an app.” No quarantine marker was removed or synthesized,
and no system trust override was used.

A separate [static Codex cache observation](assets/plugin-releases/quarantined-cache.json)
successfully registered and installed the quarantined extracted repository into
isolated HOME/CODEX_HOME state with Codex CLI 0.167.1. All copied file bytes matched
the source, and the launcher/runtime/CPython dylib retained Chrome's quarantine
marker. This static observation preceded the launch retry.

The [user-requested retry](assets/plugin-releases/quarantined-retry.json) at
13:44 UTC succeeded from that client-managed copy: the launcher returned the
expected installation identity with no developer tools on PATH, and an actual
isolated Codex app-server started the plugin and returned matching `plugin_status`.
The user reported that **no prompt appeared on this retry**. The runtime retained
its original Chrome quarantine marker before and after launch. The
[final verification](assets/plugin-releases/notarization-verification.json)
at 13:45 UTC passed strict verification and the explicit `notarized` requirement
for all four native files; the original extracted executable also then satisfied
that requirement. Source/cache file bytes still matched the submitted payload.
These observations establish the successful online quarantined cache launch on
this host; they do not prove why the earlier ticket requirement failed or establish
a guaranteed ticket propagation interval. The raw `spctl` assessment still returns
3 despite that successful launch and explicit notarization verification.

Offline first launch, uncached trust, actual model/browser/user journeys and
protected CI notarization remain outside this observation. The retry did not
remove/synthesize quarantine, invoke Open Anyway or change system trust policy.

## Qualification limits

The [native workflow](../../.github/workflows/plugin-macos.yml) retains separate
candidate and diagnostic artifacts for 30 days. Its ARM64 build host may predate
the advertised macOS 27 client floor: below-floor runs skip installed-plugin
launcher/lifecycle/client acceptance and test the frozen runtime separately.
A build or synthetic installed-client pass does not complete the downloaded
quarantine/trust, actual model/image/browser journey or clean-machine gates.
Protected signing/notarization configuration is code, not evidence that repository
credentials are configured or a signed CI submission passed. Windows/Linux native
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

The subsequent [archive-check attempt](https://github.com/cliffom/gbc-scene-forge/actions/runs/43177742681)
built the native runtime successfully, then exposed a workflow interpreter error:
archive verification used the global Python without Forge installed. The workflow
now explicitly runs that build-time verifier through Poetry. The SDK test driver
continues using the separate pinned build interpreter; the launched runtime needs
neither interpreter. Earlier signed evidence is preserved in
[the original committed record](https://github.com/cliffom/gbc-scene-forge/blob/4720f9a/docs/evaluations/plugin-releases.md).

The next [archive acceptance attempt](https://github.com/cliffom/gbc-scene-forge/actions/runs/43178255784)
reached the official-SDK smoke driver, but macOS 15 denied renaming its disposable
copy because `copytree` inherited the restricted source directory's mode. Test
staging now grants owner-write only to that scratch directory for relocation,
then removes write bits before launch. The installed source remains restricted
and its content inventory remains checked. This setup failure did not establish
an SDK acceptance pass on that runner.

## Native hosted candidate

The corrected [native CI run](https://github.com/cliffom/gbc-scene-forge/actions/runs/43178752574)
passed on **macOS 15.8.2 ARM64**, building PR merge revision
`c9c67effb5867899fead7aeabc1910a77c8db52a` from branch revision `494549c`.
The [CI release metadata](assets/plugin-releases/ci-release.json) and
[CI archive report](assets/plugin-releases/ci-archive-check.json) are retained here.
This is an **ad-hoc** candidate; its original downloaded checksum manifest passes
for all four delivered files. Its archive SHA-256 is
`c17bc9ca02433bdc87d55292b80ad209c9b399fbff1df391f479a928a9c75e1d`.

The native build, extracted/relocated read-only runtime, official-SDK smoke and
Chromium sample rendering/reload passed. The
[candidate artifact](https://github.com/cliffom/gbc-scene-forge/actions/runs/43178752574/artifacts/13924962912)
and [diagnostic artifact](https://github.com/cliffom/gbc-scene-forge/actions/runs/43178752574/artifacts/13925641643)
expire on **2026-12-12 UTC**. Retain them beyond expiry before release qualification;
these committed JSON records alone do not retain the binary/browser evidence.
The actual runner predates the macOS 27 client floor, so installed-plugin launcher,
managed lifecycle and Codex installation are explicitly unperformed in this CI
run. Those local signed checks above belong to their separate macOS 27 scope.
CI Gatekeeper assessment also rejects the ad-hoc executable (exit 3). The protected
signed/notarized dispatch remains unverified. The later local notarization and
quarantined-launch failure/retry have their separate scope above.
