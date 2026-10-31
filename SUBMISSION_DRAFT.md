# BREAKSHIFT Submission Draft

Status: locally verified candidate; owner review and hosted video link pending.
This is draft text, not an organizer submission or eligibility guarantee.

## Project

**BREAKSHIFT: A False Green Is Not A Repair**

BREAKSHIFT is a simulated robotic-workcell maintenance bay that makes AI repair
proposals falsifiable. Inspect a component, replay a retained Meta-model proposal,
compile a typed repair plan, challenge it against declared uncertainty, and save
or independently replay the evidence. Changed assumptions withdraw a previous
green result instead of silently leaving it trusted.

Suggested theme: Push the Frontier (software, robotics and modeled energy).
Suggested track: Indie Developer, subject to owner/organizer confirmation.

## Demonstrated Outcome

1. A nominal reference appears to pass but fails under the uncertainty envelope:
   1722.5 W worst peak and only 4/16 corners passing.
2. A recorded Muse Spark proposal passes the declared model at 1470.8 W worst
   peak and 2350 ms worst-case duration, with only 50 ms deadline margin.
3. Sensor-delay drift withdraws the green and locks stale export. A rechecked,
   current failed receipt remains downloadable as failed evidence, never clearance.
4. The saved experiment can be recomputed without applying it to the workcell.
5. The nominal energy comparison trades a 226.5 W peak reduction for 750 ms longer
   duration and greater Wh. Lower peak demand is not lower electricity bills.

Recorded SAM 3.1 tracking and Muse Wonder inspection are separate from engineering
verification. Muse Spark/Wonder also assisted development and post-repair review.
The video replays retained outputs; it does not show new live model execution.
Its narration uses Windows offline synthesis, not a Meta voice model.
Desktop Muse separately reviewed public source and the GET-only app. Its
missing-build guidance and simulator-qualified label suggestions were adopted
and tested; see demo/ACCEPTANCE_20261030.md. Phone execution is not claimed.

## Links And Deliverables

- Public source: https://github.com/BrandonDucar/breakshift
- Existing app: https://breakshift-maintenance-bay.dreamnet-intel.workers.dev/
- Demo-tooling review: https://github.com/BrandonDucar/breakshift/pull/1
- Candidate: 170 seconds, 1920x1080 H.264/AAC with burned-in captions.
- Hosted video URL: **not uploaded or verified yet**.
- Original code: Apache-2.0; third-party material retains its own terms.

See NEW_WORK.md, LICENSING.md, ASSET_PROVENANCE.md and demo/MODEL_RECHECK.md.
The source app runs offline with Node 22.12+; no package install or key is required.

## Final Owner Gates

- Listen to and approve the exact video, especially pronunciation and captions.
- Approve a video destination, upload and verify the judge-accessible link.
- Confirm eligible human contributors, team listing, event-only contributions,
  accepted official rules, track and deadline. AI agents are not human team members.
- Decide whether to merge the optional demo-tooling PR before submission.
- Check links signed-out and submit through the organizer form.

No calibrated hardware result, physical repair clearance, safety certification,
electricity-bill saving or world-first claim is established. Nothing here grants
upload, merge or submission authority.
