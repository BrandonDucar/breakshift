# Demo Adversarial Review

The independent Antigravity review of the original 170-second draft found no
P0/P1 app-workflow failures, but required a demo re-render before upload.
Its seven adversarial replay tests and 21 state checks across three viewports
passed. The review does not establish physical repair or owner acceptance.

## Findings And Repairs

- BS-A01 (P1): narration overlapped chapters and the closing spoken disclaimer
  was cut off. Windows PowerShell selected `Math.Max(int,int)` for an integer
  first argument, silently rounding the tempo to 1. Explicit double operands
  preserve tempo and fractional trim. The media verifier now decodes each
  tempo-adjusted source and checks its actual sample duration and last word.
- BS-A02: captions now use speech-engine word timestamps, not equal chapter
  fractions. Explicit 16 kHz synthesis keeps event timestamps and WAV clocks
  aligned. Human listening remains required; timestamps are not a listening test.
- BS-V01: the narration explicitly distinguishes the nominal scenario from the
  separate versioned uncertainty reference. No app outcome is changed.
- BS-V02: demo-only larger readbacks mirror the actual UI verdict, export lock,
  and saved-file replay result. They are callouts, not additional verification.
- BS-P01: capture/render output sets and verification receipts cannot overwrite
  earlier evidence. A render receipt pins scripts, narration, captions, filter
  graph, raw capture and final video at render time. Earlier failed drafts remain
  retained locally; unavailable historical caption/WAV versions are not invented.
- BS-C01/C02: move the replay banner away from the logo and explicitly label
  2310 ms nominal versus 2350 ms envelope-worst-case batch duration.
- BS-C03/C04: reviewer attribution does not substitute for this evidence record;
  pronunciation and aesthetic acceptance remain a human gate.

Original rejected MP4 SHA-256:
`0f596de2f084196ef4d655e04cc040281a3807f450c0d3a2af0fad85e7546633`.

The independent original review receipt is retained privately with SHA-256
`40a032f78a99c19d6d848bae8fcd2ceffbd3ee9c48a053abbb8f051cc22cec2e`.
Its review target was `c976d8d`, not later repairs. Post-fix
review is a separate gate and must not be inferred from the original verdict.

No paid calls, model allowance changes, deployment, upload or teaching-runtime
access are required for these demo repairs.
