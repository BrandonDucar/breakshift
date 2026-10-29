# Demo Evidence Retention Hardening

Local review found that capture/render commands could overwrite earlier output
when pointed at the same folder. Capture now requires a fresh output directory.
Rendering rejects existing output artifacts before speech synthesis or encoding.
An optional fresh `-RenderPath` supports caption/narration revisions without
overwriting the capture, prior WAV files, captions, video, or verification receipt.

Both negative tests exercise the commands with sentinel evidence and confirm a
nonzero exit while the original bytes remain intact. The expanded demo suite
passes 6/6 tests. App source, worker, frozen model fixtures, and the existing
170-second MP4 are unchanged.

The original media-verification receipt retains the exact tooling hashes used
before this retention-only patch. It is intentionally not rewritten to imply the
old video was produced with newer tools. Independent review remains separate.
