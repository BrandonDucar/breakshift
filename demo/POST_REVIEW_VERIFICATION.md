# Post-Review Demo Verification

The original independent review required a re-render, not an app repair. The
rejected original and review are retained; see [ADVERSARIAL_REVIEW.md](ADVERSARIAL_REVIEW.md).

## Replacement Draft

- Capture tooling commit: `ad4dbf058b57eccab9b27611d26acf7d5c4d5c07`.
- Local capture: `.local/demo-reviewed-recording/`; replacement render:
  `.local/demo-reviewed-final/`. Neither overwrites the original draft.
- Nine timed browser checkpoints pass; zero JavaScript errors or attempted
  external requests. App tests during capture: 147 passed, zero failed.
- Demo/regression tests: 8 passed, zero failed (including synthesis word clocks,
  fractional tempo and capture/render/verification retention).
- Independent reviewer's original replay/tamper harness rerun by Codex: 7 passed,
  zero failed. This rerun is builder evidence, not a second independent verdict.
- 1920x1080 H.264/AAC, 170.00-second video and audio streams; full-file decode
  passes, nine chapters sampled nonblank. Audio mean -19.7 dB, peak -1.3 dB.
- All nine tempo-adjusted narration tracks fit their chapter slots, every last
  word timestamp precedes its audio end, and caption words match the story in
  sequence. Render-time source, WAV, caption, filter and output hashes are bound.
- An additional builder-run offline Whisper check recognizes the complete final
  sentence, ending at approximately 168.78 seconds. Measured speech spans around
  the three formerly overlapping boundaries are now separated. ASR is fallible
  and is not a human listening pass or independent review.

| Retained Artifact | SHA-256 |
| --- | --- |
| Replacement MP4 | `1411e0b610d07b5159342a620147a097fa6a896c80ff4763a8132032474d131a` |
| Captions | `ff5e7c5edc49c23fab73563c56bb7f60be28d44bbc665359fa1e3dfc64706f7a` |
| Capture receipt | `ff1cb9dac40d8691a1f7a9cefbd3729020870833f90c91e7ff5c72e7bba5c28f` |
| Render receipt | `729fc6a20ec1258baef94a20ef5a9a7b3b5fc6aae231db4d82d044ae103f7eba` |
| Media verification | `5ba1eedc12d789182b2e8e061687738187d61b56ce3b25123593b88516724873` |
| Word timing | `49a4c01ea6d53ed5abf10331d7c52758abae350a299e9004b9a94b6985199943` |
| Filter graph | `cbf13514b10858663ad8db5ae6532c434764d5ba80a2763b49b8d4a72e08438c` |

## Boundaries And Open Gates

The existing Antigravity conversation received the post-fix recheck request,
but stopped with "Your AI credits balance is too low to continue." No credits
were purchased and no second sign-off is claimed. Human listening, pronunciation
and final presentation acceptance remain pending. UI reviewer attribution means
software/fixture checks, not physical inspection or certified machine clearance.

App/worker/frozen fixtures are unchanged: rebuilding still produces
`live-03370f1c283ea180`, 45 assets, 4,886,070 bytes. Paid API calls and incremental
API spend are zero in this round; the $50 ceiling and paid allowance/held receipt
are unchanged. Local compute and existing assistant subscription usage are not
claimed to be free. No teaching-runtime access, upload, deployment or submission.

Partial renderer attempts in `.local/demo-render-reviewed-v4/` and `v5/` are
retained (word-timestamp integration errors); `v6/` is an intermediate audio fix
render before the new contextual capture. None is the replacement submission
candidate, and none replaces the failed original's evidence.
