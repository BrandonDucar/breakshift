# BREAKSHIFT

A simulated robotic-workcell repair workbench. Inspect a component, replay a
recorded Meta-model proposal, challenge it against changed conditions, and export
or independently replay the resulting evidence. Passing a simulation does not
establish a real machine's condition or authorize a physical repair.

## Live Demo & Hosted Bay

Try the existing Cloudflare Worker deployment directly in any desktop or mobile browser:
**https://breakshift-maintenance-bay.dreamnet-intel.workers.dev/**

The hosted workbench opens without credentials or account sign-in. Its current
published build is identified by `/release.json`; a source checkout may include
newer, unpublished changes. Fresh paid model analysis remains operator-restricted.

## Offline Quick Start

Use Node.js 22.12 or newer. No packages, API keys or account access are required:

```sh
npm run build
npm test
npm start
```

Open http://127.0.0.1:5193. Set PORT to change the local port. The local preview
is read-only server-side; repair experiments run in your browser. Paid scans are
disabled. Historical Muse Spark and SAM/Wonder examples are labeled recorded,
not presented as new model execution. Tests block real network transports.

Optional browser checks use an already installed Playwright module, without
installing or bundling a browser dependency:

```sh
node verify-user-facing.mjs /absolute/path/to/playwright/index.mjs
```

That verifier starts and closes its own loopback server and checks phone, tablet
and desktop journeys, including nonblank WebGL pixels. Its fake camera is a
synthetic browser test, not a physical-device hardware test.

## Source And Evidence

For the reproducible 2:50 local demo recording, captions, and offline narration,
see [demo/README.md](demo/README.md). The demo tooling is optional and separate
from the dependency-free app. The exact retained recording was approved and
uploaded Unlisted on October 31; its link stays in the private submission handoff.
It is not an organizer submission or new live model execution. See
[submission draft](SUBMISSION_DRAFT.md) for completed and remaining gates.

The public browser app, Cloudflare backend source, deterministic compiler,
simulator, uncertainty verifier and offline tests are included. The historical
build fixtures are explicitly tracked; the generated .cf-preview directory is not.
`submission-manifest.json` lists exported source hashes and deliberate exclusions.
It is the original export snapshot, not a claim that later Git commits have the
same file hashes. Later acceptance evidence is summarized in
[demo/ACCEPTANCE_20261030.md](demo/ACCEPTANCE_20261030.md); Git records those changes.
The private host service, credential loaders, campaign runner, shared accounting
ledger and production deployment configuration are not distributed. The Cloudflare
backend is included for inspection and fixture tests, not enabled by this preview.

## Energy Scope

`energy-lab/energy-comparison.mjs` compares the same modeled disturbance using
the full batch horizon. Peak power, integrated batch Wh, duration and successful
output are different quantities. The recorded repair lowers peak power but can
increase total energy because it runs longer. Failed output has no claimed
Wh-per-successful-part efficiency. This abstract two-surge model is not a calibrated
motor model, utility-savings estimate or physical safety certification.

## Contributions And Licensing

See NEW_WORK.md for submission boundaries. Original project code is Apache-2.0;
retain LICENSE, NOTICE and third-party notices. Generated illustrations and the
synthetic tracking clip are not real-world inspection evidence. See
ASSET_PROVENANCE.md and LICENSING.md. Model weights and service credentials are
not included. Public source publication does not establish approval by the
hackathon organizer. Contributor dates, credits and final demo remain separate gates.
