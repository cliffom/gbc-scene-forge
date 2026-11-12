# macOS plugin release candidates

The [native candidate workflow](../.github/workflows/plugin-macos.yml) builds the
macOS Apple Silicon portion of #263. It prepares downloadable Actions artifacts;
it does not publish a GitHub release or a distribution repository. Milestone 25
issue PRs retain Forge 0.46.1 and plugin 0.1.0-alpha.1 until integration assesses
the product release. Do not install different development builds under one
version as if they were published updates.

## Platform and client boundaries

| Target | Build baseline | Advertised runtime/client floor | Acceptance boundary |
| --- | --- | --- | --- |
| macOS ARM64 | Native hosted `macos-15`, architecture asserted before building | macOS 27.0+, local Codex CLI/app-server 0.167.1 | Archive/SDK/browser automation; actual client qualification on the named OS remains separate |
| Windows x64 | Not selected | Not advertised | Required milestone outcome; native build, OS floor, trust and installed-client journey remain open |
| Linux x64 | Not selected | Not advertised | Required milestone outcome; select a build baseline and glibc range before delivery |

Intel macOS, ARM Windows/Linux, WSL and remote execution remain deferred. The
build baseline is deliberately distinct from the tested client floor. The
packager checks installation contents without requiring its build host to meet
the client floor; installed entry points always enforce that floor before access.
On an older CI host, candidate verification explicitly skips the installed plugin
launcher, lifecycle and native-client checks. SDK/browser checks use a separate
copy of the frozen runtime and do not establish plugin client support there.

The runtime ships CPython and native dependencies. Its `bundle.json` records
actual external libraries from `otool -L`; links outside `/usr/lib/` and
`/System/Library/` fail the build. macOS supplies its system libraries, frameworks,
window server and browser. Python, Node and development tools are build/test
requirements only. Empty-PATH child tests do not establish a clean-machine test.

## Build and inspect a candidate

Follow [runtime build prerequisites](RUNTIME-BUNDLES.md), then use a new output
directory for every build. Sign during PyInstaller construction, before content
inventories and archives are generated. Optional signing uses a Developer ID
Application identity already authorized in the build keychain:

```sh
FORGE_BUILD_MODE=production make build check-dist
.venv/bin/python runtime/build.py \
  --wheel dist/gbc_scene_forge-0.46.1-py3-none-any.whl \
  --python-archive build/runtime-inputs/python.tar.zst \
  --output build/runtime-candidate --uv uv \
  --codesign-identity 'Developer ID Application: YOUR IDENTITY'
.venv/bin/python runtime/release.py \
  --bundle build/runtime-candidate/forge-0.46.1-macos-arm64 \
  --output build/plugin-candidate --revision "$(git rev-parse HEAD)" \
  --python build/runtime-candidate/build-env/bin/python \
  --codex /absolute/path/to/codex
```

Omit the signing option for ad-hoc development candidates. Omit `--codex` when the
client is unavailable; the result records the missing acceptance. The optional
native harness installs into isolated client/home directories using synthetic
grants; it neither changes personal client configuration nor performs a model
turn or native directory-dialog journey.

The [release driver](../runtime/release.py) packages first, hashes the actual
archive, safely extracts it, relocates it under spaces/non-ASCII paths and removes
installation write permission. It verifies executable modes/content inventory,
all discovered Mach-O signatures, empty-PATH launcher identity (on a qualified
host), official-SDK create/edit/review/save/reopen/render/Tiled export and managed
process recovery/shutdown. It checks installation contents remain unchanged.
The workflow then runs Chromium against the extracted SDK-tested runtime copy.
No runtime interpreter or SDK is supplied by the test driver's PATH.

Candidate artifacts contain the `.tar.gz`, `SHA256SUMS`, `release.json`,
`dependency-inventory.json` and `archive-check.json`. Metadata includes full source
revision, tracked dirty-diff digest, build/tool/lock hashes, installation build ID,
archive digest and explicit trust/client limits. Local dirty builds are not exact
commit builds. The dependency inventory covers the build-environment superset;
complete CPython/native/Python/frontend license notices stay inside the archive.
Checksums detect corruption; obtain them through an authenticated channel. They
do not authenticate a publisher independently.

Both candidate and diagnostic artifacts have 30-day Actions retention. Download
and retain the exact archive, checksums, metadata, logs, SDK outputs, screenshots
and browser reports in the eventual release record before they expire. Keep a
specific Actions run link with each CI claim. A green native job establishes only
the checks it ran; it does not close #263.

Verify a separately obtained archive before installation, using a trusted digest:

```sh
build/runtime-candidate/build-env/bin/python runtime/release.py \
  --archive /absolute/path/to/scene-forge-0.1.0-alpha.1-macos-arm64.tar.gz \
  --sha256 EXPECTED_SHA256 --output build/download-check \
  --codex /absolute/path/to/codex
```

Register the extracted repository through the
[installation and update procedure](PLUGIN-DISTRIBUTION.md). Preserve its modes
and internal symlinks. Do not register this source checkout as a native binary
marketplace. Hosted Git/release delivery requires a separately reviewed publication
step after milestone integration; no issue workflow publishes these candidates.

## Signing, notarization and trust

Local signature verification and Gatekeeper assessment are recorded independently.
Ad-hoc signatures satisfy Apple Silicon executable integrity but carry no publisher
identity. A Developer ID signature identifies a signer; it does not establish
notarization or normal-user download behavior. The driver records `spctl` exit
status and diagnostics even when assessment rejects the executable. Do not remove
quarantine attributes or disable Gatekeeper to turn a rejection into a pass.

A manually dispatched workflow may select signing. Configure the protected
`plugin-signing` GitHub environment with required reviewers and these secrets:

| Secret | Purpose |
| --- | --- |
| `FORGE_SIGNING_P12` | Base64 Developer ID Application certificate/private key export |
| `FORGE_SIGNING_PASSWORD` | Export password |
| `FORGE_SIGNING_IDENTITY` | Exact signing identity |
| `FORGE_APPLE_ID` | Apple account permitted to notarize |
| `FORGE_APPLE_PASSWORD` | App-specific notarization password |
| `FORGE_APPLE_TEAM` | Developer team ID |

PR builds receive no signing credentials. Manual signed builds import the identity
into an unlocked temporary runner keychain, sign with hardened runtime and secure
timestamps through PyInstaller, and submit a ZIP of the same packaged repository
to Apple's notary service. Missing credentials, signing failure or an unaccepted
submission fail the signed job. Cleanup removes the temporary keychain, certificate
export and submission ZIP on success or failure; never commit them or print secret
values. Rotate/revoke credentials through Apple and GitHub, outside this checkout.

The notarization response is a separate retained observation and checksum. The
original archive and its build-time trust report remain unchanged. Bare Mach-O
executables have no supported stapling container in this distribution; an accepted
submission alone does not establish offline trust. This workflow does not claim
that signing secrets or notarization are configured, or that a signed dispatch has
passed. Before advertising ordinary installation, test an actual downloaded,
quarantined archive under a normal user account and record the client-managed
copy's signature/trust behavior, online/offline limits and any rejection. Complete
project selection, model PNG inspection, user image review, browser handoff,
create/reopen/edit/export and shutdown on the exact advertised client/OS. Keep
unavailable checks in [Remaining checks](VALIDATION.md#remaining-checks), including
Windows/Linux feasibility and their OS/library/signing decisions.
