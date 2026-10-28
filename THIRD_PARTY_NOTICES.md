# Third-Party Notices and Acknowledgments

This project incorporates third-party software, specifications, and open-source components under their respective licenses.

---

## 1. Original Project Code

- **Copyright:** (c) 2026 Brandon Ducar
- **License:** Apache License, Version 2.0
- **Details:** See `LICENSE` and `NOTICE` in the repository root.

---

## 2. Meta SAM Parser

- **Package:** `@meta-sam/parser` (version 0.1.0)
- **License:** BSD-3-Clause / MIT
- **Vendored Location:** `cloudflare/vendor/meta-sam-parser/LICENSE` (served at `/third-party/meta-sam-LICENSE.txt`)
- **Usage:** Used for parsing binary mask buffers and run-length encodings from Segment Anything Model (SAM) perception outputs in the Cloudflare Worker perception pipeline.

---

## 3. Robot Reference Profiles & Kinematic Specifications

- **References:**
  - Franka Emika Panda (`franka-description-family`)
  - Universal Robots UR5e (`universal-robots-ur5e`)
- **Notice:** Robot asset profiles in `public/robot-asset-catalog.json` represent open kinematic dimension and inertia citations from publicly published manufacturer specification sheets for educational and verification simulation.
- **Boundary:** No proprietary CAD models, vendor URDF mesh files, or closed-source controller binaries are bundled or distributed in this repository.

---

## 4. Recorded Model Outputs & Provenance

- **Models:** Meta SAM 3.1, Meta Wonder 3D, Meta Muse Spark 1.3
- **Notice:** Recorded model outputs packaged in `fixtures/` and `public/` represent deterministic response records captured during development and frozen with SHA-256 cryptographic digests for zero-cost offline reproducibility. Model weights and API credentials are not bundled.
