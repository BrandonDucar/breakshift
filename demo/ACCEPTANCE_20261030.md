# Fresh-Checkout Acceptance

Version 1.0.0. Local acceptance evidence, not organizer acceptance or a release.

## Sources

- Public default branch tested: `a4a09202affd592c9499a937c546df158db0d355`.
- Demo candidate tested: `71d3e42ba67c24eefe224c121772442992f5efa2`.
- Follow-up changes add regression coverage and this report; app and worker
  behavior, frozen fixtures and generated demo video are unchanged.
- Public app: https://breakshift-maintenance-bay.dreamnet-intel.workers.dev/
- Public static readback: all 45 manifest assets matched the rebuilt
  `live-03370f1c283ea180` release. This is asset-byte parity, not backend authority.

## Reproduced Checks

| Check | Result | Scope |
| --- | --- | --- |
| Default-branch offline suite | 147 passed | Fresh clone; no dependency install or key |
| Demo-candidate offline suite | 147 passed | Exact candidate commit |
| Added regression coverage | 149 total passed | Two new tests, app behavior unchanged |
| Demo-tooling tests | 29 passed | Includes retention, evidence consistency and timing |
| Browser journeys | 24 passed | Phone 390x844, tablet 768x1024, desktop 1440x1000 |
| Enabled button targets | 90 exercised per viewport | No unexplained enabled target left unclicked |
| Browser errors / unexpected POSTs | 0 / 0 | Local preview, no model calls |
| Demo rehearsal | 9 checkpoints passed | Actual interactions and exported/replayed evidence |
| Status text geometry | Fits at 390, 768, 1024 and 1440 px | No page-level horizontal overflow |

The browser run completed using Node 24.22.1 and the existing Playwright 1.62.1
installation with Edge. An earlier Node 26.7.0 run stopped on a browser transport
parse error; it produced no final app verdict and remains retained privately.
The tests' fake camera is not a real phone hardware or permissions test.

## Muse Review And Disposition

Muse Wonder 1.0 reviewed nine public-source files and three rendered screenshots.
Muse Spark 1.3 rechecked the supplied source and challenged that
review. Both are developer API calls, not desktop/phone Muse app execution.
They did not run tests or inspect physical machinery. Their outputs are advisory.

| Finding | Host reproduction | Disposition |
| --- | --- | --- |
| Replay saved evidence under another robot profile | Both manufacturer reference profiles reject with `ROBOT_ADAPTER_UNQUALIFIED`, without changing state | Proposed relaxation rejected; preserve the qualification boundary. New test also proves review cannot restore stale export authority. |
| A rejected job might have no explanation | All 24 tested supported strategy/cap combinations had a nonempty reason when rejected | Not reproduced in the current model. New regression requires an explanation in every tested terminal rejection. |
| Supported-status label might be clipped | Text-range geometry fits at all four measured widths | Not reproduced; retain the screenshots and measured bounds, do not infer a defect from a reduced image. |

No finding was promoted to a verified defect solely because two models agreed.
No proposed cross-profile import change was applied.

## Continuous Verification

The public PR now includes a read-only, secret-free GitHub Actions workflow on a
standard Ubuntu runner, with pinned checkout/setup-node actions and Node 24.
It runs `npm test` and `npm run test:demo` without installing dependencies or
loading provider credentials. Two Windows-only rendering/speech tests skip on
Linux; their local Windows execution is recorded separately above. A workflow
definition is not a passing CI result; check the exact PR head's returned check.

## Retained Video

- SHA-256: `82d6332bc339f9c95b716e999f8202b7843d4b0df9717057b1b0d0330a854857`.
- 170 seconds, 1920x1080 H.264 video and AAC audio.
- Fresh full decode, stream durations, 27 spatial frame samples, audio levels,
  nine narration segments and caption-word checks passed.
- The original recording and receipts were not overwritten. A separate copied
  output tree was checked using the original hash-bound host inputs. This remains
  host-bound evidence, not a self-contained portable media verification bundle.
- The recording shows its historical 147-test run. The two later tests do not
  change the app demonstration or turn that recorded counter into 149.

## Still Required

The owner must listen to and approve the exact video. A judge-accessible hosted
video URL is still pending. Check the final links signed out and confirm current
organizer rules, eligible human contributors, track and submission fields before
submitting. The demo-tooling PR has not been merged by this acceptance work.

No deployment, submission, hardware control, paid-photo allowance change, held
reservation release, new service or live teaching-runtime access occurred.
