# BREAKSHIFT Submission Draft

Status as of October 31, 2026: a reviewed app release and its source branch have
been published; the exact demo is approved and hosted Unlisted. Later mobile and
camera closeout changes require their own exact-source verification and release
approval. Organizer submission remains pending.
This is draft text, not an organizer submission or eligibility guarantee.

## Project

**BREAKSHIFT: A False Green Is Not A Repair**

BREAKSHIFT is a simulated robotic-workcell maintenance bay that makes AI repair
proposals falsifiable. Inspect a component, replay a retained Meta-model proposal,
compile a typed repair plan, challenge it against declared uncertainty, and save
or independently replay the evidence. Changed assumptions withdraw a previous
green result instead of silently leaving it trusted.

Owner-confirmed team: DreamNet; Brandon Ducar is the sole human team member.
Owner-confirmed theme: Push the Frontier (software, robotics and modeled energy).
Owner-confirmed track: Indie Developer.

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
- Hosted video: the approved recording is uploaded Unlisted; its link is retained
  in the private owner handoff for the entry, not published in this repository.
  Authenticated HD playback was verified. A retained independent signed-out
  browser check also verified player readiness and the 170-second duration;
  that automated check is not another human listening pass.
- Original code: Apache-2.0; third-party material retains its own terms.

See NEW_WORK.md, LICENSING.md, ASSET_PROVENANCE.md and demo/MODEL_RECHECK.md.
The source app runs offline with Node 22.12+; no package install or key is required.

## Completed Video Gates

- The owner approved the exact retained video and then its Unlisted upload.
- Upload completed on the existing channel; authenticated playback verified
  170.021 seconds at 1920x1080. The original recording is unchanged.
- Video SHA-256: `82d6332bc339f9c95b716e999f8202b7843d4b0df9717057b1b0d0330a854857`.
- These completed gates do not imply organizer submission or a new app release.

## Remaining Owner Gates

- Review the reconciled private entry packet for the exact source candidate.
- Confirm eligibility, event-only contributions and accepted official rules.
  Team listing and track are confirmed; AI agents are not human team members.
- Decide whether to merge the optional demo-tooling PR before submission.
- Recheck links before entry and approve the exact completed organizer submission.

The October 31 publication receipt binds source
`5340e96d337f841b85d332c90433b936795a9488` to `live-46011f8bdd4bae08`.
Read the hosted app's `/release.json` and the selected Git commit for current
identity; do not use an older draft's release name as live deployment evidence.
Later closeout changes and their tests must be pinned in the final entry handoff.
The optional demo-tooling PR is not itself the identity of the deployed source.
See [dated readiness snapshot](demo/submission-readiness-20261031.json) for the
historical completed/pending split. It is not current readiness or a live status service.

The [Meta event page](https://dev.meta.ai/events/global-hackathon), checked
October 31, lists November 4 at 9:00 PM Eastern as the submission deadline.
The organizer submission form has now been inspected in the accepted account.
It asks for team members, track, theme, project description, a public GitHub
repository, a three-minute demo video, Meta product usage and importance, API
feedback, and permission to promote submitted materials. The owner selected
Somewhat likely and Somewhat favorable for API feedback. The final
permission/submission action remains an owner decision.

No calibrated hardware result, physical repair clearance, safety certification,
electricity-bill saving or world-first claim is established. Nothing here grants
upload, merge or submission authority.
