# Demo Draft Verification - October 28, 2026

Historical draft, superseded by [MODEL_RECHECK.md](MODEL_RECHECK.md) and
[ACCEPTANCE_20261030.md](ACCEPTANCE_20261030.md). The old `0f596de2...` video below
is retained evidence, not the current submission candidate. The current retained
candidate is `82d6332bc339f9c95b716e999f8202b7843d4b0df9717057b1b0d0330a854857`.
Its public hosted URL and owner listening approval remain pending.

Status: locally recorded and tested; independent review and human listening pass
pending. Not uploaded, hosted, submitted, or deployed by this work.

## Results

- App offline tests: 147 passed, 0 failed, network blocked.
- Demo narrative/timeline/evaluator tests: 4 passed, 0 failed.
- Captured demo checkpoints: 9 passed, 0 browser JavaScript errors or attempted
  external requests. Capture source commit: `f94dc8b5f470d34692aa74f3512df72b78fcdb25`.
- Phone, tablet, desktop browser journeys: 24 passed, 0 failed. All 90 enabled
  button targets exercised in each viewport. WebXR correctly unavailable in the
  desktop browser harness; camera tests use synthetic browser media, not a phone.
- Final MP4: 1920x1080 H.264 video plus AAC narration; both streams 170.00 seconds.
- Full-file decode passes. A nonblank frame sampled in all 9 chapters. Audio
  mean -19.5 dB, peak -0.5 dB. Audio levels do not establish narration quality.
- Rebuilt app release remains `live-03370f1c283ea180`; no app/worker/fixture source
  changed. The existing public deployment is not republished.
- No paid provider calls or allowance/ledger changes. Incremental API spend $0.
  No live teaching-runtime access.

## Retained Evidence

Generated files remain local in `.local/demo-draft/`, outside the public Git
source package. The raw recording and earlier renders are retained. The
full source/tooling and output hashes are in `media-verification.json`.

| Artifact | SHA-256 |
| --- | --- |
| Final draft MP4 | `0f596de2f084196ef4d655e04cc040281a3807f450c0d3a2af0fad85e7546633` |
| Captions | `3a3a2eee5775d3aaa77ffc2ab7c641ab5001e5b8d997403ba21847fb172b51b4` |
| Capture receipt | `be3bac58234b288f1168cb7e501391c55aca16c6cef6f7b94042d9194bcfd8f1` |
| Actual offline TAP log | `dd1652f1e04e43736a28604e19586b75158ec4f3b9cad4630c4e8462b04f429b` |
| Exported/replayed uncertainty receipt | `000212def48e34c22d58b785d30805f5bf8ebc556d65eb14827d5114de52fbc2` |
| Energy comparison | `30b4b0fade6065307ad0e2f09e0b4d4f2a76b54e4ab763b1de1bad0681556197` |

The historical submission manifest still describes the standalone source export;
the optional demo scripts and this review record are supplemental, not a new app
release or a claim that the old export snapshot has changed.

## Remaining Owner Gates

Review narration and claim wording, obtain independent review of these exact
hashes, approve a video host/upload, verify the resulting public video URL, and
complete contributor/rules confirmation and organizer submission. A locally
valid media file does not complete those gates.
