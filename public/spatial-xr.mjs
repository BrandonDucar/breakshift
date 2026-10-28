// Zero-dependency 3D WebGL + WebXR (immersive-ar) Spatial Workcell Anchor Engine.
// Renders the simulated BreakShift workcell with layer-aware 3D geometry, interactive
// component hit-testing, offscreen/reduced-motion loop gating, and WebXR passthrough.
import { COMPONENTS, componentState } from './component-model.mjs';
import { referencePlate, bindReferenceFallback } from './visual-assets.mjs';

const ANCHOR_WORLD_POS = Object.freeze({
  'PANEL-BUS-48V': [0.42, 0.30, -0.24],
  'GANTRY-STA-A': [-0.20, 0.28, -0.08],
  'JBOX-OPT-S1': [-0.02, 0.16, 0.12],
  'GANTRY-STB-B': [0.24, 0.28, 0.24],
});

const PALETTE = Object.freeze({
  metalDark: [0.19, 0.21, 0.21],
  metalMid: [0.55, 0.58, 0.57],
  ceramic: [0.87, 0.86, 0.79],
  copper: [0.72, 0.43, 0.24],
  belt: [0.12, 0.14, 0.12],
  plinth: [0.09, 0.11, 0.09],
  grid: [0.22, 0.26, 0.20],
  lime: [0.86, 0.98, 0.53],
  red: [1.0, 0.45, 0.38],
  amber: [0.94, 0.75, 0.47],
  green: [0.62, 0.92, 0.56],
  puck: [0.82, 0.86, 0.76],
});

function colorVec(name) {
  if (name === 'red') return PALETTE.red;
  if (name === 'amber') return PALETTE.amber;
  if (name === 'green' || name === 'green-scoped') return PALETTE.green;
  return PALETTE.lime;
}

// Minimal column-major 4x4 matrix math (WebGL & WebXR native layout)
function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function mat4Perspective(fovRad, aspect, near, far) {
  const f = 1 / Math.tan(fovRad / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

function mat4LookAt(eye, target, up = [0, 1, 0]) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const out = new Float32Array(16);
  out[0] = xx; out[4] = xy; out[8] = xz; out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[1] = yx; out[5] = yy; out[9] = yz; out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[2] = zx; out[6] = zy; out[10] = zz; out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

function mat4Translate(tx, ty, tz) {
  const m = mat4Identity();
  m[12] = tx; m[13] = ty; m[14] = tz;
  return m;
}

function mat4Scale(sx, sy, sz) {
  const m = mat4Identity();
  m[0] = sx; m[5] = sy; m[10] = sz;
  return m;
}

function mat4RotateY(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  const m = mat4Identity();
  m[0] = c; m[8] = s;
  m[2] = -s; m[10] = c;
  return m;
}

function projectToScreen(vpMat, worldPt, width, height) {
  const [x, y, z] = worldPt;
  const cx = vpMat[0] * x + vpMat[4] * y + vpMat[8] * z + vpMat[12];
  const cy = vpMat[1] * x + vpMat[5] * y + vpMat[9] * z + vpMat[13];
  const cz = vpMat[2] * x + vpMat[6] * y + vpMat[10] * z + vpMat[14];
  const cw = vpMat[3] * x + vpMat[7] * y + vpMat[11] * z + vpMat[15];
  if (cw <= 0.01) return null;
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  const ndcZ = cz / cw;
  if (ndcZ < -1 || ndcZ > 1) return null;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (0.5 - ndcY * 0.5) * height,
  };
}

// Push an oriented 3D beam between two 3D points p0 -> p1 with thickness `radius`
function pushBox(verts, cx, cy, cz, sx, sy, sz, rgb, emissive = 0.0) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const faces = [
    // +Y top
    [[cx - hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz + hz], [cx + hx, cy + hy, cz + hz], [cx + hx, cy + hy, cz - hz], [0, 1, 0]],
    // -Y bottom
    [[cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz + hz], [cx - hx, cy - hy, cz + hz], [0, -1, 0]],
    // +Z front
    [[cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz], [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz], [0, 0, 1]],
    // -Z back
    [[cx + hx, cy - hy, cz - hz], [cx - hx, cy - hy, cz - hz], [cx - hx, cy + hy, cz - hz], [cx + hx, cy + hy, cz - hz], [0, 0, -1]],
    // +X right
    [[cx + hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy + hy, cz - hz], [cx + hx, cy + hy, cz + hz], [1, 0, 0]],
    // -X left
    [[cx - hx, cy - hy, cz - hz], [cx - hx, cy - hy, cz + hz], [cx - hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz - hz], [-1, 0, 0]],
  ];
  for (const [p0, p1, p2, p3, n] of faces) {
    for (const p of [p0, p1, p2, p0, p2, p3]) {
      verts.push(p[0], p[1], p[2], n[0], n[1], n[2], rgb[0], rgb[1], rgb[2], emissive);
    }
  }
}

function pushSegmentBoxes(verts, p0, p1, steps, radius, rgb, emissive = 0.45, dashed = false) {
  if (!dashed) { pushTube(verts, p0, p1, radius / 2, radius / 2, rgb, emissive); return; }
  for (let i = 0; i < steps; i++) {
    if (dashed && i % 2 === 1) continue;
    const t = (i + 0.5) / steps;
    const x = p0[0] + (p1[0] - p0[0]) * t;
    const y = p0[1] + (p1[1] - p0[1]) * t;
    const z = p0[2] + (p1[2] - p0[2]) * t;
    const segLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) / steps;
    const s = Math.max(radius, segLen * (dashed ? 0.85 : 1.15));
    pushBox(verts, x, y, z, s, radius, s, rgb, emissive);
  }
}

// Smooth articulated housings and straight conduits share the concept art's materials.
// These are illustrative geometry, not dimensions acquired from a physical robot.
function pushTube(verts, a, b, r0, r1, rgb, emissive = 0.03) {
  const d = b.map((v,i)=>v-a[i]), len=Math.hypot(...d);
  if (!len) return;
  const n=d.map(v=>v/len), ref=Math.abs(n[1])<.9?[0,1,0]:[1,0,0];
  const cross=(p,q)=>[p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]];
  let u=cross(n,ref);const ul=Math.hypot(...u);u=u.map(v=>v/ul);const v=cross(n,u);
  const radial=t=>u.map((x,i)=>x*Math.cos(t)+v[i]*Math.sin(t));
  const point=(p,r,s)=>p.map((x,i)=>x+r*s[i]);
  const emit=(p,normal)=>verts.push(...p,...normal,...rgb,emissive);
  for(let i=0;i<16;i++){
    const s0=radial(i*Math.PI/8),s1=radial((i+1)*Math.PI/8);
    const p=point(a,r0,s0),q=point(a,r0,s1),r=point(b,r1,s0),s=point(b,r1,s1);
    for(const [pos,normal] of [[p,s0],[r,s0],[q,s1],[q,s1],[r,s0],[s,s1]])emit(pos,normal);
    for(const pos of [a,q,p])emit(pos,n.map(x=>-x));
    for(const pos of [b,r,s])emit(pos,n);
  }
}

function pushArm(verts, base, elbow, wrist, stateColor) {
  const shoulder=[base[0],.16,base[2]];
  pushTube(verts,[base[0],.015,base[2]],shoulder,.066,.052,PALETTE.ceramic);
  pushTube(verts,shoulder,elbow,.044,.035,PALETTE.ceramic);
  pushTube(verts,elbow,wrist,.035,.024,PALETTE.ceramic);
  for(const p of [shoulder,elbow,wrist]){
    pushTube(verts,[p[0]-.038,p[1],p[2]],[p[0]+.038,p[1],p[2]],.038,.038,PALETTE.metalDark);
    pushTube(verts,[p[0]+.038,p[1],p[2]],[p[0]+.043,p[1],p[2]],.029,.029,PALETTE.copper);
  }
  pushTube(verts,wrist,[wrist[0],wrist[1]-.055,wrist[2]],.026,.022,PALETTE.metalMid);
  pushBox(verts,wrist[0],wrist[1]-.032,wrist[2]+.023,.039,.009,.006,stateColor,.45);
  for(const dx of [-.022,.022])pushBox(verts,wrist[0]+dx,wrist[1]-.072,wrist[2],.008,.04,.016,PALETTE.metalDark,.02);
}

const VERT_SRC = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute float aEmissive;
uniform mat4 uMVP;
uniform mat4 uModel;
varying vec3 vNormal;
varying vec3 vColor;
varying float vEmissive;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vNormal = mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNormal;
  vColor = aColor;
  vEmissive = aEmissive;
}
`;

const FRAG_SRC = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vColor;
varying float vEmissive;
void main() {
  vec3 n = normalize(vNormal);
  vec3 lightDir = normalize(vec3(0.45, 0.85, 0.52));
  float diff = max(dot(n, lightDir), 0.0);
  float hemi = 0.34 + 0.22 * (n.y * 0.5 + 0.5);
  vec3 lit = vColor * (hemi + 0.58 * diff) + vColor * vEmissive;
  gl_FragColor = vec4(min(lit, vec3(1.0)), 1.0);
}
`;

function compileProgram(gl) {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, VERT_SRC);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(vs) || 'VS_FAIL');

  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, FRAG_SRC);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(fs) || 'FS_FAIL');

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'LINK_FAIL');
  return prog;
}

export function createSpatialXrController({
  stageEl,
  canvasEl,
  pinsEl,
  fallbackEl,
  xrButtonEl,
  xrStatusEl,
  domOverlayRoot,
  onSelectZone,
  disableWebGl = false,
} = {}) {
  if (stageEl) {
    const reference = document.createElement('aside');
    reference.className = 'spatial-reference';
    reference.innerHTML = referencePlate('workcell', 'Same cell / spatial signal map');
    stageEl.append(reference); bindReferenceFallback(reference);
  }
  let gl = null;
  let program = null;
  let vbo = null;
  let attribs = null;
  let uniforms = null;
  let webglAvailable = false;

  let xrSupported = false;
  let xrSession = null;
  let xrRefSpace = null;
  let xrHitTestSource = null;
  let xrWorldAnchor = [0, -0.32, -1.25];
  let xrReticlePos = null;

  let yaw = 0.58;
  let pitch = 0.44;
  let distance = 1.48;
  let isVisible = false;
  let isStageActive = false;
  let rafId = 0;
  let renderedFrames = 0;
  let currentSession = null;
  let currentTrace = 'working';
  let lastProjectedAnchors = {};

  const reducedMotionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function setStatus(text) {
    if (xrStatusEl) xrStatusEl.textContent = text;
  }

  function initWebGl() {
    if (disableWebGl || !canvasEl) return false;
    try {
      gl = canvasEl.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: true });
      if (!gl) return false;
      program = compileProgram(gl);
      vbo = gl.createBuffer();
      attribs = {
        aPos: gl.getAttribLocation(program, 'aPos'),
        aNormal: gl.getAttribLocation(program, 'aNormal'),
        aColor: gl.getAttribLocation(program, 'aColor'),
        aEmissive: gl.getAttribLocation(program, 'aEmissive'),
      };
      uniforms = {
        uMVP: gl.getUniformLocation(program, 'uMVP'),
        uModel: gl.getUniformLocation(program, 'uModel'),
      };
      webglAvailable = true;
      if (fallbackEl) fallbackEl.hidden = true;
      canvasEl.hidden = false;
      return true;
    } catch {
      webglAvailable = false;
      return false;
    }
  }

  function renderFallbackCards() {
    if (!fallbackEl || !currentSession) return;
    fallbackEl.hidden = webglAvailable;
    if (webglAvailable) return;
    if (canvasEl) canvasEl.hidden = true;
    if (pinsEl) pinsEl.innerHTML = '';
    if (stageEl) {
      stageEl.classList.add('fallback-mode');
      stageEl.querySelectorAll('[data-cam]').forEach(btn => { btn.hidden = true; });
    }
    const cards = Object.entries(COMPONENTS)
      .map(([zoneId, part]) => {
        const st = componentState(zoneId, currentSession, currentTrace);
        const pressed = zoneId === currentSession.activeZoneId;
        return `<button type="button" class="spatial-fallback-btn ${st.color}" data-zone="${zoneId}" aria-pressed="${pressed}"><strong>${part.number} / ${part.short}</strong><span>${st.label} · ${st.metric} ${st.unit}</span></button>`;
      })
      .join('');
    fallbackEl.innerHTML = `<p class="scope-note">3D WebGL context unavailable on this device. Interactive isometric anchor matrix remains synchronized with ${currentSession.evidenceSnapshotId}:</p><div class="spatial-fallback-grid">${cards}</div>`;
  }

  function buildSceneVertices(timeSec, inImmersiveAr) {
    const verts = [];
    if (!currentSession) return new Float32Array(0);
    const layers = currentSession.visibleLayers || ['mechanical', 'electrical', 'software', 'energy'];
    const result = currentSession.twins[currentTrace] || currentSession.twins.working;
    const verified = currentSession.repairOverlayMode === 'VERIFIED_SIMULATED_OVERLAY';

    // Subtle reference tabletop plinth
    if (!inImmersiveAr) {
      pushBox(verts, 0, -0.02, 0, 1.24, 0.03, 0.84, PALETTE.plinth, 0.0);
      for (let gx = -0.5; gx <= 0.51; gx += 0.25) {
        pushBox(verts, gx, -0.002, 0, 0.006, 0.003, 0.80, PALETTE.grid, 0.05);
      }
      for (let gz = -0.35; gz <= 0.36; gz += 0.35) {
        pushBox(verts, 0, -0.002, gz, 1.18, 0.003, 0.006, PALETTE.grid, 0.05);
      }
    } else {
      // Minimal tabletop frame in AR passthrough
      pushBox(verts, 0, -0.005, 0, 1.18, 0.008, 0.012, PALETTE.lime, 0.35);
      if (xrReticlePos) {
        pushBox(verts, xrReticlePos[0], xrReticlePos[1], xrReticlePos[2], 0.14, 0.008, 0.14, PALETTE.lime, 0.6);
      }
    }

    // 1. ENERGY LAYER: 48V Microgrid Cabinet + Overhead Shared Busbar
    if (layers.includes('energy')) {
      const busState = componentState('PANEL-BUS-48V', currentSession, currentTrace);
      const busCol = colorVec(busState.color);
      // Cabinet housing
      pushBox(verts, 0.42, 0.16, -0.24, 0.20, 0.32, 0.16, PALETTE.metalDark, 0.04);
      // Status beacon strip on cabinet door
      pushBox(verts, 0.42, 0.27, -0.155, 0.15, 0.035, 0.015, busCol, 0.55);
      // Overhead 48V DC busbar trunk + drops to Arm A and Arm B
      pushSegmentBoxes(verts, [0.42, 0.34, -0.24], [-0.20, 0.34, -0.08], 10, 0.018, busCol, 0.42, false);
      pushSegmentBoxes(verts, [0.10, 0.34, -0.16], [0.24, 0.34, 0.24], 9, 0.016, busCol, 0.42, false);
    }

    // 2. MECHANICAL LAYER: Conveyor + Moving Order Pucks + Station A & B Arms
    if (layers.includes('mechanical')) {
      // Conveyor bed
      pushBox(verts, 0, 0.05, 0.08, 0.98, 0.07, 0.16, PALETTE.belt, 0.02);
      pushBox(verts, 0, 0.09, 0.165, 0.98, 0.02, 0.015, PALETTE.metalMid, 0.05);
      pushBox(verts, 0, 0.09, -0.005, 0.98, 0.02, 0.015, PALETTE.metalMid, 0.05);

      // Moving order pucks (paused under reduced motion or breaker trip)
      const speedScale = result.breakerTrip ? 0 : currentTrace === 'working' ? 0.35 : 0.24;
      const phase = reducedMotionQuery.matches ? 0.35 : (timeSec * speedScale) % 1;
      for (let i = 0; i < 3; i++) {
        const t = (phase + i / 3) % 1;
        const px = -0.42 + t * 0.84;
        pushBox(verts, px, 0.105, 0.08, 0.055, 0.035, 0.055, PALETTE.puck, 0.08);
      }

      // Station A Arm (faulted pinch gripper -> wrist stays RED!)
      pushArm(verts, [-.20,0,-.11], [-.27,.36,-.16], [-.20,.28,.01], PALETTE.red);

      // Station B Arm (secondary handoff manipulator)
      const bState = componentState('GANTRY-STB-B', currentSession, currentTrace);
      const bSwing = !reducedMotionQuery.matches && currentTrace !== 'working' && !result.breakerTrip
        ? Math.sin(timeSec * 2.1) * 0.04
        : 0;
      pushArm(verts, [.24,0,.26], [.30,.36,.30], [.24+bSwing,.28,.11], colorVec(bState.color));
    }

    // 3. ELECTRICAL LAYER: Optical Sensor Harness & Fault Trace
    if (layers.includes('electrical')) {
      pushSegmentBoxes(verts, [-0.02, 0.12, 0.17], [-0.20, 0.24, -0.02], 9, 0.014, PALETTE.red, 0.48, false);
    }

    // 4. SOFTWARE LAYER: Optical Timing Gate + Handoff Trajectory Arc (Ghosted vs Verified)
    if (layers.includes('software')) {
      const optState = componentState('JBOX-OPT-S1', currentSession, currentTrace);
      const optCol = colorVec(optState.color);
      // Gate posts + laser beam across belt
      pushBox(verts, -0.02, 0.13, 0.17, 0.028, 0.12, 0.028, PALETTE.metalMid, 0.05);
      pushBox(verts, -0.02, 0.13, -0.01, 0.028, 0.12, 0.028, PALETTE.metalMid, 0.05);
      pushBox(verts, -0.02, 0.16, 0.08, 0.012, 0.012, 0.17, optCol, 0.62);

      // Parabolic handoff trajectory arc from belt pick -> Station B pack bay
      const arcSteps = 12;
      for (let i = 0; i < arcSteps; i++) {
        if (!verified && i % 2 === 1) continue;
        const t = (i + 0.5) / arcSteps;
        const ax = -0.02 + t * 0.28;
        const az = 0.08 + t * 0.18;
        const ay = 0.14 + Math.sin(t * Math.PI) * 0.18;
        pushBox(verts, ax, ay, az, 0.022, 0.016, 0.022, verified ? PALETTE.green : PALETTE.lime, verified ? 0.58 : 0.35);
      }
    }

    // Active component selection beacon
    const activeAnchor = ANCHOR_WORLD_POS[currentSession.activeZoneId];
    if (activeAnchor) {
      pushBox(verts, activeAnchor[0], activeAnchor[1] + 0.09, activeAnchor[2], 0.08, 0.014, 0.08, PALETTE.lime, 0.78);
    }

    return new Float32Array(verts);
  }

  function drawWithMatrices(projMat, viewMat, modelMat, viewportWidth, viewportHeight, timeSec, inImmersiveAr) {
    const vpMat = mat4Multiply(projMat, viewMat);
    const mvpMat = mat4Multiply(vpMat, modelMat);
    const data = buildSceneVertices(timeSec, inImmersiveAr);
    if (!data.length) return vpMat;

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);

    const stride = 10 * 4;
    gl.enableVertexAttribArray(attribs.aPos);
    gl.vertexAttribPointer(attribs.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(attribs.aNormal);
    gl.vertexAttribPointer(attribs.aNormal, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(attribs.aColor);
    gl.vertexAttribPointer(attribs.aColor, 3, gl.FLOAT, false, stride, 6 * 4);
    gl.enableVertexAttribArray(attribs.aEmissive);
    gl.vertexAttribPointer(attribs.aEmissive, 1, gl.FLOAT, false, stride, 9 * 4);

    gl.uniformMatrix4fv(uniforms.uMVP, false, mvpMat);
    gl.uniformMatrix4fv(uniforms.uModel, false, modelMat);

    gl.drawArrays(gl.TRIANGLES, 0, data.length / 10);
    renderedFrames += 1;
    return mvpMat;
  }

  const pinNodes = new Map();

  function updateAnchorOverlayPins(mvpMat, cssWidth, cssHeight) {
    if (!pinsEl || !currentSession) return;
    lastProjectedAnchors = {};
    for (const [zoneId, worldPt] of Object.entries(ANCHOR_WORLD_POS)) {
      const part = COMPONENTS[zoneId];
      let btn = pinNodes.get(zoneId);
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.zone = zoneId;
        btn.textContent = part.number;
        pinNodes.set(zoneId, btn);
        pinsEl.append(btn);
      }
      if (!currentSession.visibleLayers.includes(part.layer)) {
        btn.hidden = true;
        continue;
      }
      const screen = projectToScreen(mvpMat, worldPt, cssWidth, cssHeight);
      if (!screen) {
        btn.hidden = true;
        continue;
      }
      btn.hidden = false;
      lastProjectedAnchors[zoneId] = screen;
      const st = componentState(zoneId, currentSession, currentTrace);
      const active = zoneId === currentSession.activeZoneId;
      const cls = `hotspot spatial-pin ${st.color}`;
      if (btn.className !== cls) btn.className = cls;
      btn.style.left = `${screen.x.toFixed(1)}px`;
      btn.style.top = `${screen.y.toFixed(1)}px`;
      const label = `3D Anchor ${part.number} ${part.name}: ${st.label}`;
      if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
      const pressed = String(active);
      if (btn.getAttribute('aria-pressed') !== pressed) btn.setAttribute('aria-pressed', pressed);
    }
  }

  function renderInlineFrame(nowMs = performance.now()) {
    if (!webglAvailable || !gl || xrSession || !currentSession) return;
    const rect = canvasEl.getBoundingClientRect();
    const cssW = Math.max(300, Math.round(rect.width || canvasEl.clientWidth || 640));
    const cssH = Math.max(180, Math.round(rect.height || canvasEl.clientHeight || 320));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (canvasEl.width !== pxW || canvasEl.height !== pxH) {
      canvasEl.width = pxW;
      canvasEl.height = pxH;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pxW, pxH);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.043, 0.051, 0.043, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const ex = Math.sin(yaw) * Math.cos(pitch) * distance;
    const ey = Math.sin(pitch) * distance + 0.16;
    const ez = Math.cos(yaw) * Math.cos(pitch) * distance;
    const proj = mat4Perspective((42 * Math.PI) / 180, pxW / pxH, 0.08, 12.0);
    const view = mat4LookAt([ex, ey, ez], [0.04, 0.14, 0.04]);
    const model = mat4Identity();

    const mvp = drawWithMatrices(proj, view, model, pxW, pxH, nowMs / 1000, false);
    updateAnchorOverlayPins(mvp, cssW, cssH);
  }

  function scheduleInlineLoop() {
    if (rafId || xrSession || !webglAvailable) return;
    if (!isStageActive || !isVisible || document.hidden) return;
    if (reducedMotionQuery.matches) {
      renderInlineFrame();
      return;
    }
    const tick = now => {
      rafId = 0;
      if (!isStageActive || !isVisible || document.hidden || xrSession) return;
      renderInlineFrame(now);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopInlineLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function onXrFrame(timeMs, frame) {
    const session = frame.session;
    session.requestAnimationFrame(onXrFrame);
    if (!xrRefSpace || !gl) return;

    if (xrHitTestSource) {
      try {
        const hits = frame.getHitTestResults(xrHitTestSource);
        if (hits.length > 0) {
          const hitPose = hits[0].getPose(xrRefSpace);
          if (hitPose) {
            const p = hitPose.transform.position;
            xrReticlePos = [p.x - xrWorldAnchor[0], p.y - xrWorldAnchor[1], p.z - xrWorldAnchor[2]];
          }
        }
      } catch {}
    }

    const pose = frame.getViewerPose(xrRefSpace);
    if (!pose) return;
    const baseLayer = session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, baseLayer.framebuffer);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const model = mat4Multiply(
      mat4Translate(xrWorldAnchor[0], xrWorldAnchor[1], xrWorldAnchor[2]),
      mat4Scale(0.75, 0.75, 0.75),
    );

    for (const xrView of pose.views) {
      const vp = baseLayer.getViewport(xrView);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      drawWithMatrices(
        xrView.projectionMatrix,
        xrView.transform.inverse.matrix,
        model,
        vp.width,
        vp.height,
        timeMs / 1000,
        true,
      );
    }
  }

  async function refreshXrAvailability() {
    if (!navigator.xr?.isSessionSupported) {
      xrSupported = false;
      if (xrButtonEl) {
        xrButtonEl.disabled = true;
        xrButtonEl.textContent = 'WebXR AR unavailable here';
      }
      setStatus(
        webglAvailable
          ? '3D spatial view active. Immersive WebXR AR requires a compatible headset/mobile browser over HTTPS or localhost.'
          : 'WebGL & WebXR unavailable; using 2D spatial anchor fallback.',
      );
      return false;
    }
    try {
      xrSupported = Boolean(await navigator.xr.isSessionSupported('immersive-ar'));
      if (xrButtonEl) {
        xrButtonEl.disabled = !xrSupported || !webglAvailable;
        xrButtonEl.textContent = xrSupported ? 'Enter WebXR AR' : 'WebXR AR unavailable here';
      }
      setStatus(
        xrSupported
          ? 'WebXR immersive-ar ready. Launches synchronized 3D anchors with passthrough; physical fiducial calibration remains separate.'
          : 'Immersive AR not supported on this device. Interactive 3D WebGL spatial stage is active.',
      );
      return xrSupported;
    } catch {
      xrSupported = false;
      if (xrButtonEl) {
        xrButtonEl.disabled = true;
        xrButtonEl.textContent = 'WebXR AR unavailable here';
      }
      setStatus('AR capability check declined; interactive 3D WebGL spatial stage remains active.');
      return false;
    }
  }

  async function toggleImmersiveAr() {
    if (xrSession) {
      await xrSession.end();
      return;
    }
    if (!webglAvailable || !navigator.xr) return;
    stopInlineLoop();
    if (xrButtonEl) {
      xrButtonEl.disabled = true;
      xrButtonEl.textContent = 'Starting WebXR…';
    }
    try {
      const sessionInit = {
        optionalFeatures: ['local-floor', 'local', 'hit-test', 'dom-overlay'],
      };
      if (domOverlayRoot) sessionInit.domOverlay = { root: domOverlayRoot };
      const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
      xrSession = session;
      try {
        if (typeof gl.makeXRCompatible === 'function') await gl.makeXRCompatible();
      } catch {
        // Polyfilled / WebXR-emulated desktop sessions proceed on the existing WebGL context
      }
      const LayerCtor = window.XRWebGLLayer;
      session.updateRenderState({ baseLayer: new LayerCtor(session, gl) });

      try {
        xrRefSpace = await session.requestReferenceSpace('local-floor');
      } catch {
        xrRefSpace = await session.requestReferenceSpace('local');
      }

      if (typeof session.requestHitTestSource === 'function') {
        try {
          const viewerSpace = await session.requestReferenceSpace('viewer');
          xrHitTestSource = await session.requestHitTestSource({ space: viewerSpace });
        } catch {
          xrHitTestSource = null;
        }
      }

      session.addEventListener('select', () => {
        if (xrReticlePos) {
          xrWorldAnchor = [
            xrWorldAnchor[0] + xrReticlePos[0],
            xrWorldAnchor[1] + xrReticlePos[1],
            xrWorldAnchor[2] + xrReticlePos[2],
          ];
          xrReticlePos = null;
        } else if (currentSession && onSelectZone) {
          const keys = Object.keys(ANCHOR_WORLD_POS);
          const next = keys[(keys.indexOf(currentSession.activeZoneId) + 1) % keys.length];
          onSelectZone(next);
        }
      });

      session.addEventListener(
        'end',
        () => {
          xrSession = null;
          xrRefSpace = null;
          xrHitTestSource = null;
          document.body.classList.remove('xr-immersive-active');
          if (xrButtonEl) {
            xrButtonEl.disabled = false;
            xrButtonEl.textContent = 'Enter WebXR AR';
          }
          setStatus(`Exited WebXR AR · synchronized with ${currentSession?.evidenceSnapshotId || 'session'}.`);
          renderInlineFrame();
          scheduleInlineLoop();
        },
        { once: true },
      );

      document.body.classList.add('xr-immersive-active');
      if (xrButtonEl) {
        xrButtonEl.disabled = false;
        xrButtonEl.textContent = 'Exit WebXR AR';
      }
      setStatus(
        `WebXR immersive-ar active (${currentSession?.evidenceSnapshotId || 'simulated'}) · Green = named simulated check only.`,
      );
      session.requestAnimationFrame(onXrFrame);
    } catch (error) {
      xrSession = null;
      if (xrButtonEl) {
        xrButtonEl.disabled = !xrSupported;
        xrButtonEl.textContent = xrSupported ? 'Enter WebXR AR' : 'WebXR AR unavailable here';
      }
      setStatus(`WebXR session not started (${error?.name || 'declined'}). 3D WebGL stage remains active.`);
      renderInlineFrame();
      scheduleInlineLoop();
    }
  }

  // Orbit pointer controls + click-to-select nearest projected 3D anchor
  if (canvasEl) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;

    canvasEl.addEventListener('pointerdown', ev => {
      dragging = true;
      moved = false;
      startX = ev.clientX;
      startY = ev.clientY;
      canvasEl.setPointerCapture?.(ev.pointerId);
    });
    canvasEl.addEventListener('pointermove', ev => {
      if (!dragging) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.hypot(dx, dy) > 4) moved = true;
      startX = ev.clientX;
      startY = ev.clientY;
      yaw -= dx * 0.009;
      pitch = Math.max(0.12, Math.min(1.18, pitch + dy * 0.008));
      if (reducedMotionQuery.matches) renderInlineFrame();
    });
    const endDrag = ev => {
      if (!dragging) return;
      dragging = false;
      if (!moved && onSelectZone) {
        const rect = canvasEl.getBoundingClientRect();
        const lx = ev.clientX - rect.left;
        const ly = ev.clientY - rect.top;
        let closestId = null;
        let bestDist = 48;
        for (const [zoneId, pt] of Object.entries(lastProjectedAnchors)) {
          const d = Math.hypot(pt.x - lx, pt.y - ly);
          if (d < bestDist) {
            bestDist = d;
            closestId = zoneId;
          }
        }
        if (closestId) onSelectZone(closestId);
      }
    };
    canvasEl.addEventListener('pointerup', endDrag);
    canvasEl.addEventListener('pointercancel', () => { dragging = false; });

    canvasEl.addEventListener('keydown', ev => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const k = ev.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { yaw -= 0.14; renderInlineFrame(); ev.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { yaw += 0.14; renderInlineFrame(); ev.preventDefault(); }
      else if (k === 'ArrowUp' || k === 'w' || k === 'W') { pitch = Math.min(1.18, pitch + 0.10); renderInlineFrame(); ev.preventDefault(); }
      else if (k === 'ArrowDown' || k === 's' || k === 'S') { pitch = Math.max(0.12, pitch - 0.10); renderInlineFrame(); ev.preventDefault(); }
      else if (k === 'q' || k === 'Q' || k === '-') { distance = Math.min(2.35, distance + 0.12); renderInlineFrame(); ev.preventDefault(); }
      else if (k === 'e' || k === 'E' || k === '=' || k === '+') { distance = Math.max(0.85, distance - 0.12); renderInlineFrame(); ev.preventDefault(); }
      else if (k === 'r' || k === 'R') { yaw = 0.58; pitch = 0.44; distance = 1.48; renderInlineFrame(); ev.preventDefault(); }
    });
  }

  if (stageEl && typeof IntersectionObserver === 'function') {
    const io = new IntersectionObserver(
      entries => {
        isVisible = entries.some(e => e.isIntersecting);
        if (isVisible) scheduleInlineLoop();
        else stopInlineLoop();
      },
      { threshold: 0.05 },
    );
    io.observe(stageEl);
  } else {
    isVisible = true;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopInlineLoop();
    else scheduleInlineLoop();
  });

  if (xrButtonEl) xrButtonEl.addEventListener('click', () => { toggleImmersiveAr(); });

  initWebGl();
  refreshXrAvailability();

  return {
    updateState({ session, trace, active }) {
      currentSession = session;
      currentTrace = trace;
      isStageActive = Boolean(active);
      if (!webglAvailable) {
        renderFallbackCards();
        return;
      }
      if (isStageActive) {
        isVisible = true;
        renderInlineFrame();
        scheduleInlineLoop();
      } else {
        stopInlineLoop();
      }
    },
    setCameraPreset(preset) {
      if (preset === 'top') { yaw = 0.0; pitch = 1.12; distance = 1.55; }
      else if (preset === 'wrist') { yaw = -0.52; pitch = 0.34; distance = 1.12; }
      else { yaw = 0.58; pitch = 0.44; distance = 1.48; }
      renderInlineFrame();
    },
    refreshXrAvailability,
    toggleImmersiveAr,
    sampleNonBlankPixels() {
      if (!webglAvailable || !gl || !canvasEl.width || !canvasEl.height) return { webglAvailable: false, nonBackgroundPixels: 0 };
      renderInlineFrame();
      const w = Math.min(64, canvasEl.width);
      const h = Math.min(64, canvasEl.height);
      const x0 = Math.floor((canvasEl.width - w) / 2);
      const y0 = Math.floor((canvasEl.height - h) / 2);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let nonBg = 0;
      for (let i = 0; i < buf.length; i += 4) {
        if (Math.abs(buf[i] - 11) > 8 || Math.abs(buf[i + 1] - 13) > 8 || Math.abs(buf[i + 2] - 11) > 8) {
          nonBg++;
        }
      }
      return { webglAvailable: true, sampledPixels: w * h, nonBackgroundPixels: nonBg, renderedFrames, xrActive: Boolean(xrSession) };
    },
    getDiagnostics: () => ({
      webglAvailable,
      xrSupported,
      xrActive: Boolean(xrSession),
      renderedFrames,
      projectedAnchorCount: Object.keys(lastProjectedAnchors).length,
      camera: { yaw: +yaw.toFixed(4), pitch: +pitch.toFixed(4), distance: +distance.toFixed(4) },
    }),
  };
}
