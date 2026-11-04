# BREAKSHIFT Audit Fixes v0.1.0

Local hardening candidate based on public main eb3eaeb616f613c1ecc4e9c64d59b9b56b34cb17, which reproduced hosted release live-21257de71f79977a. The older demo-ready checkout was preserved, including its unrelated working changes. No hosted deployment is implied by these fixes.

## Corrected Behavior

1. Breaker and uncertainty sliders have explicit label associations. Previously the enclosing label named the output element rather than the range input.
2. Photo fix/region/mapping selections restore keyboard focus after rerendering.
3. Expired live assessments are removed from browser result/cache state, their overlays and downstream photo-twin verdict are withdrawn, and binding validation refuses expired results. No automatic rescan occurs. Explicit recorded demos remain available.
4. Offscreen 3D settings updates do not restart the render loop; visibility checks agree on the 5% threshold.
5. Orbit drag detection measures total travel, preventing slow drags from becoming unintended component clicks.
6. XR setup failures end acquired sessions and clean up hit-testing/immersive state, allowing another attempt.
7. Tablet landscape and coarse-pointer devices retain readable text and 44px controls. Spatial controls and the fault caption occupy separate rows on handheld layouts.
8. Presentation illustrations use same-dimension WebP derivatives and lazy secondary references; original PNGs and hash-bound inspection JPEG/video are untouched. Initial trace space and caption geometry are reserved to prevent startup layout shifts.
9. Shared-room clipboard failure no longer reports a false successful copy. This control is hidden on the hosted public preview.
10. Browser verification reads the tested release rather than labeling remote results with a local release ID. Partial/unavailable response-body captures remain explicitly unverified, not successful integrity evidence.

## Verification

```powershell
npm run build
npm test
npm run test:demo
node verify-audit-regressions.mjs <existing-playwright-index.mjs> <output-folder>
node verify-user-facing.mjs <existing-playwright-index.mjs>
```

The targeted browser suite covers 12 viewport sizes from 320 to 2560 pixels and five inspection views, keyboard focus/names, slow dragging, offscreen rendering, synthetic XR setup failure/retry, timed assessment expiry, CSS zoom, reduced motion, no-WebGL/no-recorder fallback, and a controlled cold-load measurement. Camera/XR fixtures do not prove physical-device operation. CSS zoom is not native browser/OS zoom. Chromium-family emulation is not Safari/Firefox certification.

Controlled cold-load measurements use 4 Mbps, 150ms simulated network latency and 4x CPU slowdown. The retained before/after evidence records actual timings; it is not a promise for every device or connection.

## Scope

No provider calls, subscriber sends, paid scans, credential changes, hardware control, public push or deployment were performed. Original source, recorded inference and fresh execution remain distinct. Public-facing safety and physical-verification limitations are retained.
