import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReviewPreviewServer } from '../preview-review.mjs';

assert.ok(process.argv[2], 'Pass the existing Playwright module/shim path as argv[2]');
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, `artifacts/mobile-readability-${Date.now()}`);
await mkdir(output, { recursive: false });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const releaseBytes = await readFile(resolve(root, '.cf-preview/release.json'));
const release = JSON.parse(releaseBytes);
const report = {
  schema: 'breakshift.mobile-readability.v1', version: '1.0.0',
  evidence: 'LOCAL_BROWSER_LAYOUT_AND_SYNTHETIC_TEXT_ENLARGEMENT',
  release: release.id, releaseManifestSha256: sha(releaseBytes),
  textEnlargement: 'Computed CSS font sizes doubled by test stylesheet; not browser zoom',
  floors: { controls: 16, explanations: 16, metadata: 14, touch: 44 },
  touchTargetScope: 'Touch viewports at 768px and below',
  geometryExceptions: '.hotspot, .photo-region and #spatial-pins excluded from font and target floors',
  providerCalls: 0, productionChanged: false, teachingRuntimeTouched: false,
  blockedRequests: [], errors: [], sourceBindings: [], checks: [],
};
for (const entry of release.manifest) {
  const bytes = await readFile(resolve(root, '.cf-preview', entry.path));
  assert.equal(sha(bytes), entry.sha256, `STALE_BUILT_ASSET: ${entry.path}`);
  if (/\.(css|mjs|js)$/.test(entry.path)) {
    const sourcePath = entry.path === 'style.css' ? 'public/style.css' : entry.path;
    const source = await readFile(resolve(root, sourcePath));
    assert.equal(sha(source), entry.sha256, `SOURCE_NOT_BUILT: ${entry.path}`);
    report.sourceBindings.push({ path: entry.path, sourcePath, sha256: entry.sha256 });
  }
}

const server = createReviewPreviewServer();
let browser;
try {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const cases = [320, 360, 390, 768, 1440].flatMap(width =>
    (width <= 390 ? [1, 2] : [1]).map(scale => ({ width, height: width < 768 ? 844 : 1000, scale })));
  for (const { width, height, scale } of cases) {
    const name = `${width}px-text-${scale * 100}`;
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width <= 768, serviceWorkers: 'block' });
    try {
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        const local = url.origin === base;
        if (!local || !['GET', 'HEAD'].includes(request.method())) {
          report.blockedRequests.push({ case: name, origin: url.origin, method: request.method(), pathname: url.pathname });
          return route.abort();
        }
        return route.continue();
      });
      // Reject WebSockets as well: ordinary request routing does not guard them.
      assert.equal(typeof context.routeWebSocket, 'function', 'Playwright WebSocket interception is required');
      await context.routeWebSocket('**/*', socket => {
        report.blockedRequests.push({ case: name, kind: 'WEBSOCKET', origin: new URL(socket.url()).origin });
        socket.close();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', error => report.errors.push({ case: name, error: error.message }));
      await page.addInitScript(() => {
        window.__applyReadabilityScale = factor => {
          document.querySelector('#readability-test-text-scale')?.remove();
          if (factor === 1) return;
          const elements = [...document.body.querySelectorAll('*')].filter(el => el instanceof HTMLElement);
          const rules = elements.map((el, index) => {
            el.dataset.readabilityText = String(index);
            const baseline = parseFloat(getComputedStyle(el).fontSize);
            el.dataset.readabilityBaseline = String(baseline);
            // Outrank authored !important control sizes without changing page zoom.
            return `html body [data-readability-text="${index}"]:not(#readability-test-never):not(#readability-test-never-2){font-size:${baseline * factor}px!important}`;
          });
          const style = document.createElement('style');
          style.id = 'readability-test-text-scale'; style.textContent = rules.join('\n');
          document.head.append(style);
          // App renders can replace nodes and discard the test attributes.
          if (!window.__readabilityObserver) {
            window.__readabilityObserver = new MutationObserver(records => {
              if (records.some(record => [...record.addedNodes].some(node => node instanceof HTMLElement)))
                window.__applyReadabilityScale(factor);
            });
            window.__readabilityObserver.observe(document.body, { childList: true, subtree: true });
          }
        };
      });
      const click = selector => page.locator(selector).first().click();
      const ready = async () => {
        await page.goto(base);
        await page.locator('#sync-pill').filter({ hasText: 'DEVICE-LOCAL' }).waitFor();
        await page.waitForFunction(() => /^v\d+$/.test(document.querySelector('#mission-version')?.textContent || ''));
        await page.evaluate(factor => window.__applyReadabilityScale(factor), scale);
      };
      const audit = async (state, focus, extraViolations = [], geometry) => {
        await page.evaluate(factor => window.__applyReadabilityScale(factor), scale);
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); });
        const metrics = await page.evaluate(({ mobile, scale }) => {
          const violations = [], counts = { text: 0, controls: 0, explanations: 0, metadata: 0, touch: 0, clipping: 0, excludedGeometry: 0 };
          const scaling = { checked: 0, missing: 0, mismatched: 0, samples: [] };
          const visible = el => {
            const css = getComputedStyle(el), rect = el.getBoundingClientRect();
            return el.getClientRects().length > 0 && rect.width > 0 && rect.height > 0 && css.visibility === 'visible' && Number(css.opacity) > 0;
          };
          const identity = el => ({ selector: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${[...el.classList].map(c => `.${c}`).join('')}`, text: (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 180) });
          const add = (kind, el, details) => violations.push({ kind, ...identity(el), ...details });
          const controls = 'button, select, textarea, input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), summary, [role="button"], .photo-upload';
          const metadata = 'small, code, pre, dt, th, td, time, .eyebrow, .scope-meta, .session-meta, .scene-key, .scene-topline, .scene-fault, .masthead-state, .build-tag, .brand-word, .public-access-banner, #public-access-state, .twin-picker, .detail-index, .detail-metric span, .status-label, .component-detail h4, .photo-source-row, .photo-findings h4, .job-tag, .job-progress, .clip-playback-speed, .repair-controls label, .repair-controls > span, .repair-art-toolbar > span, .repair-art-caption, .repair-art-badges, .repair-meters span, .muse-citations, .muse-evidence, .muse-callout > span, .fix-footer > span, .fix-heading > span, .experiment-trail > strong, .reasoning-hud-title, .reasoning-hud-tag, .reasoning-step-head, .schematic-footnote, #experiment-state, #mission-version, #scene-mode, #wave-summary, footer';
          const critical = 'button.primary, .primary, .inspector-action, .scope-note, .scope-warning, .check-text, #reasoning-hud, #repair-log, #repair-scope, #repair-verdict, #uncertainty-failure, #job-freshness';
          const compactMetadata = '#twins header, #wasd-badge, kbd, .repair-plot-heading';
          for (const el of document.body.querySelectorAll('*')) {
            if (!(el instanceof HTMLElement) || !visible(el) || el.closest('svg, .sr-only, .hotspot, .photo-region, #spatial-pins')) continue;
            const direct = [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            if (el.matches('input[type="checkbox"], input[type="radio"], input[type="range"], input[type="file"], input[type="hidden"]')) continue;
            const input = el.matches('input,select,textarea');
            if (!direct.length && !input) continue;
            const category = input ? 'controls' : el.closest(`${metadata}, ${compactMetadata}`) ? 'metadata' : el.closest(controls) ? 'controls' : 'explanations';
            counts.text++; counts[category]++;
            const font = parseFloat(getComputedStyle(el).fontSize), floor = category === 'metadata' ? 14 : 16;
            if (scale === 2) {
              const baseline = Number(el.dataset.readabilityBaseline);
              scaling.checked++;
              if (!Number.isFinite(baseline) || !el.hasAttribute('data-readability-text')) {
                scaling.missing++; add('text-scale-unbound', el, { actual: font });
              } else {
                if (Math.abs(font - baseline * scale) > .1) {
                  scaling.mismatched++; add('text-scale-not-applied', el, { baseline, actual: font, expected: baseline * scale });
                }
                if (el.matches('button,select,textarea') && scaling.samples.length < 12)
                  scaling.samples.push({ ...identity(el), baseline, actual: font });
              }
            }
            if (mobile && font + .1 < floor * scale) add('font-floor', el, { category, font, required: floor * scale });
            if (!el.closest(critical)) continue;
            counts.clipping++;
            if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'visible') add('text-overflow-x', el, { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
            for (const node of direct) {
              const range = document.createRange(); range.selectNodeContents(node);
              for (const rect of range.getClientRects()) {
                for (let parent = el; parent; parent = parent.parentElement) {
                  const css = getComputedStyle(parent), box = parent.getBoundingClientRect();
                  const clipsX = /hidden|clip/.test(css.overflowX), clipsY = /hidden|clip/.test(css.overflowY);
                  if ((clipsX && (rect.left < box.left - 2 || rect.right > box.right + 2)) || (clipsY && (rect.top < box.top - 2 || rect.bottom > box.bottom + 2))) {
                    add('clipped-text', el, { clippedBy: identity(parent).selector }); break;
                  }
                }
              }
            }
          }
          for (const el of document.querySelectorAll('button, .photo-upload, summary, a.inspector-action, a.start-job-link')) {
            if (!visible(el)) continue;
            if (el.closest('.hotspot, .photo-region, #spatial-pins')) { counts.excludedGeometry++; continue; }
            const rect = el.getBoundingClientRect(), minimum = 44;
            counts.touch++;
            if (mobile && (rect.width + .5 < minimum || rect.height + .5 < minimum)) add('touch-target', el, { width: rect.width, height: rect.height, required: minimum });
          }
          for (const input of document.querySelectorAll('input[type="checkbox"], input[type="radio"], input[type="range"]')) {
            if (!visible(input)) continue;
            const target = input.labels?.[0] || input.closest('label') || input;
            const rect = target.getBoundingClientRect(); counts.touch++;
            if (mobile && (rect.width + .5 < 44 || rect.height + .5 < 44))
              add('input-label-touch-target', target, { input: input.id, width: rect.width, height: rect.height, required: 44 });
          }
          const pageWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
          if (pageWidth > innerWidth + 1) violations.push({ kind: 'page-overflow', pageWidth, viewport: innerWidth });
          if (!counts.text || !counts.touch || !counts.clipping) violations.push({ kind: 'empty-audit-coverage', counts });
          return { viewport: innerWidth, pageWidth, counts, scaling, violations: [...new Map(violations.map(value => [JSON.stringify(value), value])).values()] };
        }, { mobile: width <= 768, scale });
        metrics.violations.push(...extraViolations);
        const screenshots = [];
        for (const [label, selector] of [['entry', 'body'], ['focus', focus]]) {
          if (label === 'entry') await page.evaluate(() => scrollTo(0, 0));
          else await page.locator(selector).scrollIntoViewIfNeeded();
          const filename = `${name}-${state}-${label}.png`;
          await page.screenshot({ path: resolve(output, filename) }); screenshots.push(filename);
        }
        report.checks.push({ case: name, state, passed: metrics.violations.length === 0, ...metrics, geometry, screenshots });
        await writeFile(resolve(output, 'progress.json'), JSON.stringify(report, null, 2));
      };
      const state = async (label, run) => {
        try { await ready(); await run(); }
        catch (error) {
          const filename = `${name}-${label}-failure.png`;
          await page.screenshot({ path: resolve(output, filename) }).catch(() => {});
          report.checks.push({ case: name, state: label, passed: false, error: error.message, screenshots: [filename] });
          await writeFile(resolve(output, 'progress.json'), JSON.stringify(report, null, 2));
        }
      };
      await state('first-entry', async () => {
        const workcell = await page.locator('#workcell-image').evaluate(el => ({ loaded: el.complete && el.naturalWidth > 0, width: el.naturalWidth, height: el.naturalHeight }));
        assert.equal(workcell.loaded, true, 'WORKCELL_IMAGE_NOT_LOADED');
        assert.ok(await page.locator('#reasoning-hud-list').textContent(), 'RECOVERY_TRACE_NOT_POPULATED');
        report.checks.push({ case: name, state: 'workcell-asset', passed: true, workcell });
        await audit('first-entry', '#scene');
      });
      await state('photo-recorded', async () => {
        await click('[data-view="photo"]'); await click('#photo-demo-track');
        await page.locator('#photo-first-frame').waitFor(); await click('#photo-first-frame');
        assert.match(await page.locator('#photo-source').textContent(), /VERIFIED SYNTHETIC DEMO/);
        const geometry = await page.evaluate(() => {
          const rect = selector => {
            const el = document.querySelector(selector), box = el.getBoundingClientRect();
            return { selector, visible: Boolean(el.getClientRects().length && !el.hidden && box.width && box.height),
              x: box.x, y: box.y, width: box.width, height: box.height };
          };
          return { image: rect('#photo-image'), overlays: [rect('#photo-pins'), rect('#sam-mask-overlay')] };
        });
        const violations = [];
        if (!geometry.image.visible) violations.push({ kind: 'photo-image-not-visible' });
        for (const overlay of geometry.overlays) {
          if (overlay.selector === '#sam-mask-overlay' && !overlay.visible) continue;
          const differences = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.abs(overlay[key] - geometry.image[key])]));
          if (!overlay.visible || Object.values(differences).some(value => value > 1))
            violations.push({ kind: 'photo-overlay-alignment', selector: overlay.selector, differences, tolerance: 1 });
        }
        await audit('photo-recorded', '#photo-findings', violations, geometry);
      });
      await state('completed-job', async () => {
        for (let step = 0; step < 5; step++) await click('#job-next');
        assert.match(await page.locator('#job-freshness').textContent(), /Complete/);
        assert.equal(await page.locator('#job-download').isEnabled(), true);
        await audit('completed-job', '#bay-job');
      });
      await state('repair', async () => {
        await page.locator('#muse-fixes [data-run-fix="coordinated_repair"]').waitFor();
        await click('#muse-fixes [data-run-fix="coordinated_repair"]'); await click('#repair-finish');
        assert.match(await page.locator('#repair-verdict').textContent(), /PASS/);
        await audit('repair', '#repair-twin');
      });
      await state('uncertainty', async () => {
        await click('[data-uncertainty-candidate="muse"]'); await click('#uncertainty-run');
        await page.locator('#uncertainty-workspace[data-state="supported"]').waitFor();
        await audit('uncertainty', '#uncertainty-workspace');
      });
      await state('spatial-canvas', async () => {
        await click('[data-view="spatial"]');
        await page.locator('#spatial-canvas').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => window.__breakshiftSpatial?.sampleNonBlankPixels().nonBackgroundPixels > 120);
        const diagnostics = await page.evaluate(() => ({ pixels: window.__breakshiftSpatial.sampleNonBlankPixels(), scene: window.__breakshiftSpatial.getDiagnostics() }));
        const filename = `${name}-spatial.png`; await page.screenshot({ path: resolve(output, filename) });
        report.checks.push({ case: name, state: 'spatial-canvas', passed: true, diagnostics, screenshots: [filename] });
        await audit('spatial-layout', '#scene');
      });
    } finally { await context.close(); }
  }
} catch (error) {
  report.errors.push({ stage: 'harness', error: error.message });
} finally {
  await browser?.close().catch(error => report.errors.push({ stage: 'browser-close', error: error.message }));
  if (server.listening) await new Promise(done => server.close(done));
  try {
    assert.equal(sha(await readFile(resolve(root, '.cf-preview/release.json'))), report.releaseManifestSha256, 'BUILD_CHANGED_DURING_VERIFICATION');
    for (const binding of report.sourceBindings) {
      assert.equal(sha(await readFile(resolve(root, binding.sourcePath))), binding.sha256, `SOURCE_CHANGED_DURING_VERIFICATION: ${binding.sourcePath}`);
      assert.equal(sha(await readFile(resolve(root, '.cf-preview', binding.path))), binding.sha256, `BUILD_CHANGED_DURING_VERIFICATION: ${binding.path}`);
    }
  } catch (error) { report.errors.push({ stage: 'artifact-integrity', error: error.message }); }
  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.length === 64 && report.checks.every(check => check.passed) && report.errors.length === 0 && report.blockedRequests.length === 0;
  report.failedChecks = report.checks.filter(check => !check.passed).length;
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ output, release: report.release, passed: report.passed, checks: report.checks.length,
  failedChecks: report.failedChecks, errors: report.errors, blockedRequests: report.blockedRequests,
  failures: report.checks.filter(check => !check.passed).map(check => ({ case: check.case, state: check.state,
    error: check.error, violations: check.violations?.length, kinds: [...new Set(check.violations?.map(v => v.kind))] })) }, null, 2));
if (!report.passed) process.exitCode = 1;
