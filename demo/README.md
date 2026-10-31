# Reproducible Demo Draft

This records the actual offline app, not a mockup or a live provider call.
The closing energy and test-output cards are generated from real local results.
Recorded Meta output, fictional machinery, and physical-clearance limits remain
explicit. The voiceover uses Windows' installed offline speech engine; it is not
a Meta voice-model output. No presenter avatar is implied.

Prerequisites: the normal Node offline build, an already-installed Playwright
module and Edge, plus FFmpeg and Windows System.Speech for the optional render.
These tools are not needed for the app or its Node offline tests.

```powershell
node demo/capture.mjs C:/absolute/path/to/playwright/index.mjs .local/demo-rehearsal --rehearsal
node demo/capture.mjs C:/absolute/path/to/playwright/index.mjs .local/demo-draft
./demo/render.ps1 -OutputPath .local/demo-draft
node demo/verify-media.mjs .local/demo-draft
npm run test:demo
```

`--rehearsal` runs the same assertions without timed holds or video encoding.
Capture requires a new output directory; a failed or successful capture is not
overwritten. Rendering also refuses an existing output set. For a narration or
caption revision from the same capture, use a fresh render directory:

```powershell
./demo/render.ps1 -OutputPath .local/demo-draft -RenderPath .local/demo-render-v4
node demo/verify-media.mjs .local/demo-render-v4
```

The recorded run targets 170 seconds. The renderer adds captions and offline
narration; it does not alter application outcomes. All non-loopback requests
and all browser mutation requests are blocked. The capture stops on a failed
assertion, unexpected network attempt, JavaScript error, or shot overrun.

Output remains in ignored `.local/`: screenshots, raw video, actual offline
TAP output, an exported/replayed uncertainty receipt, an energy comparison,
capture receipt, narration WAV files, subtitles, and the final draft MP4.
The media verifier decodes the complete file, checks both stream durations,
samples a nonblank frame in each chapter, checks audio levels, and seals output
and tooling digests. Render-time source/WAV/filter hashes live in
`render-receipt.json`; verification refuses existing output receipts. The verifier
also measures the tempo-adjusted sample duration of all nine narration tracks,
checks the last word fits, and verifies every caption word is retained in order.
Speech timestamps use explicit 16 kHz synthesis to match the event clock.
These measurements do not substitute for listening or independent review.

The current `verify-media.mjs` is deliberately restricted to the retained
reviewed recording. `retained-evidence-binding.json` binds its video, canonical
capture metadata, TAP and both sidecars. It is a local reviewed-byte baseline,
not a signature, provider authentication or proof that tests executed. A new
capture or render will fail this gate until its evidence is separately reviewed
and a new version of the binding is approved. Do not replace pins just to make
verification pass. TAP verification supports only the flat, zero-suite Node
test output this capture produces; it reconciles result rows and counters.
See [ADVERSARIAL_REVIEW.md](ADVERSARIAL_REVIEW.md) for the rejected original draft
and its fixes, [POST_REVIEW_VERIFICATION.md](POST_REVIEW_VERIFICATION.md) for the
first replacement, and [MODEL_RECHECK.md](MODEL_RECHECK.md) for the newer
Muse/Copilot-reviewed candidate and open owner gates.
Larger demo-only state readbacks magnify actual UI values; they
do not add app functionality or new evidence.
The public fixture bytes, live deployment, paid allowance and private ledger
are not modified. A newly rendered draft needs separate review and approval.
The exact retained video was approved and hosted Unlisted on October 31; it has
not been submitted. Its link remains in the private owner handoff. Final
source review and signed-out player verification have since been reconciled;
owner promotion and organizer-entry gates remain open. See the
[final local review](FINAL_REVIEW_20261031.md). The
[dated readiness snapshot](submission-readiness-20261031.json) is retained unchanged
as historical evidence, not a current readiness declaration.

See [Fresh-Checkout Acceptance](ACCEPTANCE_20261030.md) for the later 149-test
regression run, source-versus-model finding reconciliation and retained-video
recheck. Historical test counts and receipts above are not rewritten.

To exercise the later asynchronous intake and pairing regressions against the
local build with an already-installed Playwright module and Edge:

```powershell
npm run build
node demo/verify-readiness-regressions.mjs C:/absolute/path/to/playwright/index.mjs
```

The harness blocks non-loopback traffic, uses a synthetic browser camera, and
answers pairing writes with local fixtures. It does not send a model request or
prove physical camera hardware, real pairing or a deployed release.
