# SAM 3.1 + Wonder Integration and Perception Architecture

This document describes the perception integration bridging visual worker intake, Meta SAM 3.1 segmentation tracking, and Wonder spatial diagnosis within the BREAKSHIFT workcell.

---

## 1. Architectural Principles

1. **Local-First Worker Intake:**

   Workers can capture short video clips (up to 2 seconds) or upload still inspection photos directly in the browser. Captured media remains strictly client-side until the operator explicitly clicks `Analyze`.
2. **Explicit Candidate Localization:**

   Meta SAM 3.1 generates polygon masks and stable object IDs across video frames. Masks represent detected candidate visual geometry—never automated repair clearance.
3. **Spatial Grounding with Wonder:**

   Wonder evaluates candidate components from the initial frame, proposing visual checks, failure hypotheses, and candidate repair plans. Wonder proposals do not authorize physical machine movement.
4. **Deterministic Twin Binding:**

   Candidate hypotheses from the perception pipeline are explicitly bound into the deterministic Repair Twin (`photo-repair-bridge.mjs`), where physical constraints, microgrid power limits, and timing tolerances are formally challenged.

---

## 2. Verified Recorded Replay

To allow complete offline verification and zero-cost reproducibility for hackathon judges, the repository packages frozen, cryptographic response records:

- **Recorded SAM Tracking:**

  `public/assets/verified-tracking-demo-v1.mp4` and `verified-tracking-demo-v1.jpg` demonstrate 17-frame object tracking with stable ID retention.
- **Canary Projection:**

  `public/verified-sam-wonder-demo.json` binds the visual masks, bounding boxes, and Wonder repair suggestions directly to the recorded media digests.
- **Zero-Network Execution:**

  In the standalone offline environment, clicking `Try tracking demo ↗` re-plays these recorded model responses deterministically without requiring Meta API keys or network calls.

---

## 3. Safety & Qualification Boundaries

- **No Hidden Pixel Persistence:**

  The Cloudflare Worker perception pipeline processes media in memory and does not store raw user photos or audio recordings.
- **Synthetic vs Physical Separation:**

  Passing perception and twin simulation does not certify real-world hardware. The system enforces that arbitrary camera images never grant physical repair authority without separate physical sensor calibration.
