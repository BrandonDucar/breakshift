# Reproducible Demo Draft

This records the actual offline app, not a mockup or a live provider call.
The closing energy and test-output cards are generated from real local results.
Recorded Meta output, fictional machinery, and physical-clearance limits remain
explicit. The voiceover uses Windows' installed offline speech engine; it is not
a Meta voice-model output. No presenter avatar is implied.

Prerequisites: the normal Node offline build, an already-installed Playwright
module and Edge, plus FFmpeg and Windows System.Speech for the optional render.
These tools are not needed for the app or its 147 offline tests.

```powershell
node demo/capture.mjs C:/absolute/path/to/playwright/index.mjs .local/demo-rehearsal --rehearsal
node demo/capture.mjs C:/absolute/path/to/playwright/index.mjs .local/demo-draft
./demo/render.ps1 -OutputPath .local/demo-draft
```

`--rehearsal` runs the same assertions without timed holds or video encoding.
The recorded run targets 170 seconds. The renderer adds captions and offline
narration; it does not alter application outcomes. All non-loopback requests
and all browser mutation requests are blocked. The capture stops on a failed
assertion, unexpected network attempt, JavaScript error, or shot overrun.

Output remains in ignored `.local/`: screenshots, raw video, actual offline
TAP output, an exported/replayed uncertainty receipt, an energy comparison,
capture receipt, narration WAV files, subtitles, and the final draft MP4.
The public fixture bytes, live deployment, paid allowance and private ledger
are not modified. A finished draft still needs human/independent visual review,
hosting approval, a working public video link, and organizer submission.
