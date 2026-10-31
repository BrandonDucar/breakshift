# Handheld Readability

The handheld stylesheet applies at 900 CSS pixels and below. Desktop typography
and the existing simulation, model access, billing and evidence logic are unchanged.

- Explanations and editable controls use 16px text; supporting labels use 14px.
- Ordinary touch controls have a minimum height of 44px.
- Image-selection regions and spatial hotspots retain their geometry rather than
  expanding to a generic button size. Equivalent named component controls remain.
- Notes and repair badges flow below their media. Overlay coordinate spaces must
  still match the media, not the combined media-and-caption height.
- Wide technical comparisons scroll inside their own container.
- Font sizes are not tied to viewport width, and browser zoom is not disabled.

Build first, then pass an existing Playwright installation or ESM shim:

```sh
npm run build
npm run test:readability -- /absolute/path/to/playwright-shim.mjs
```

The harness uses a fresh local GET/HEAD-only preview, blocks external traffic and
WebSockets, and retains timestamped reports and screenshots under `artifacts/`.
It checks 320, 360, 390, 768 and 1440px widths, including synthetic doubled text
sizes on phones, rendered font floors, clipping, overflow, media/pin alignment,
the guided job, recorded photo, repair, uncertainty and nonblank spatial canvas.
Synthetic doubled CSS text is not native browser zoom or a physical-device test.
These checks are focused regression evidence, not an accessibility certification.
