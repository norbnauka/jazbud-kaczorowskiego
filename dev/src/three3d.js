// 3D model of building 1 – generated from the unit footprints read from the developer's catalogue cards.
const APP = window.APP;
const canvas = document.getElementById('c3d');
const loadingEl = document.getElementById('loading3d');
let THREE;
try {
  if (window.THREE_URL) THREE = await import(window.THREE_URL);
  else THREE = await import(URL.createObjectURL(new Blob([document.getElementById('three-src').textContent], { type: 'text/javascript' })));
} catch (e) {
  loadingEl.textContent = 'Nie udało się wczytać modelu 3D. Skorzystaj z rzutów pięter.';
  throw e;
}

const S = 0.215, CX = 246, CY = 224;           // plan px -> metres, plan centre
const GF = 4.6, FH = 3.1, UH = 2.7, SL = FH - UH; // ground floor, storey, unit box, slab
const base = f => GF + (f - 1) * FH;
const wx = X => (X - CX) * S, wz = Y => (Y - CY) * S;
const v2 = ([X, Y]) => new THREE.Vector2(wx(X), -wz(Y));
const units = APP.U;
const cen = u => u.g.reduce((a, p) => [a[0] + p[0] / u.g.length, a[1] + p[1] / u.g.length], [0, 0]);

let renderer, scene, camera, built = false, active = false, dirty = true, raf = 0;
const unitInfo = new Map();      // n -> { mesh, start, count, key }
const floorObjs = {};
const pickMeshes = [];

/* ---------------- colours ---------------- */
const C = (h) => new THREE.Color(h);
let COL;

/* ---------------- helpers ---------------- */
function convex(pts) {
  const p = pts.map(q => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const inset = (poly, k) => { const c = poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]); return poly.map(p => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]); };
function extrude(poly, h, y0) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(poly.map(v2)), { depth: h, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  return g.index ? g.toNonIndexed() : g;
}
function merge(geoms, withColor) {
  let n = 0; geoms.forEach(g => n += g.attributes.position.count);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  geoms.forEach(g => { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (withColor) out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  return out;
}
const M = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.8, metalness: 0 }, o));
const mesh = (g, m, cast = true) => { const o = new THREE.Mesh(g, m); o.castShadow = cast; o.receiveShadow = true; return o; };
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

/* ---------------- scene build (lazy) ---------------- */
function build() {
  if (built) return; built = true;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) { loadingEl.textContent = 'Twoja przeglądarka nie obsługuje WebGL. Skorzystaj z rzutów pięter.'; throw e; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xeeebe5, 380, 950);
  camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);
  COL = { D: C(0x34b37e), R: C(0xe6a03a), S: C(0xcf4b41), facade: C(0x5d636c), dim: C(0xe4e0d9), white: C(0xffffff) };

  scene.add(new THREE.HemisphereLight(0xeaf3ff, 0xb9b1a3, 1.25));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(-150, 210, 120); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -130, right: 130, top: 130, bottom: -130, near: 50, far: 600 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6; scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdfe9ff, 0.55); fill.position.set(160, 90, -140); scene.add(fill);

  const slabMat = M(0xf3f1ec, { roughness: 0.9 }), coreMat = M(0xcfcac2, { roughness: 0.9 }), gfMat = M(0x48505a, { roughness: 0.3, metalness: 0.35 });
  const roofMat = M(0x8eab72, { roughness: 1 }), boxMat = M(0x3a3e44, { roughness: 0.7 }), ghostMat = M(0xffffff, { transparent: true, opacity: 0.5, roughness: 1 });
  const unitMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });

  /* ground & context */
  const flat = (poly, mat, y) => { const g = new THREE.ShapeGeometry(new THREE.Shape(poly.map(v2))); g.rotateX(-Math.PI / 2); g.translate(0, y, 0); const o = new THREE.Mesh(g, mat); o.receiveShadow = true; scene.add(o); };
  { const g = new THREE.CircleGeometry(900, 64); g.rotateX(-Math.PI / 2); const o = new THREE.Mesh(g, M(0xe9e5de, { roughness: 1 })); o.receiveShadow = true; scene.add(o); }
  const road = M(0xbdbab4, { roughness: 1 }), walk = M(0xdcd8d1, { roughness: 1 }), grass = M(0xbcd1a1, { roughness: 1 }), park = M(0xb6cc98, { roughness: 1 });
  const ny = X => 74 - 0.242 * (X - 15);                               // ul. Kaczorowskiego (south kerb)
  flat([[-600, ny(-600) - 62], [1100, ny(1100) - 62], [1100, ny(1100) + 8], [-600, ny(-600) + 8]], walk, 0.01);
  flat([[-600, ny(-600) - 55], [1100, ny(1100) - 55], [1100, ny(1100)], [-600, ny(-600)]], road, 0.03);
  flat([[-74, ny(-74) - 5], [-14, ny(-14) - 5], [-14, 900], [-74, 900]], walk, 0.015);
  flat([[-66, ny(-66)], [-22, ny(-22)], [-22, 900], [-66, 900]], road, 0.035);
  flat([[492, ny(492)], [556, ny(556)], [556, 900], [492, 900]], walk, 0.015);
  flat([[500, ny(500)], [548, ny(548)], [548, 900], [500, 900]], road, 0.035);
  flat([[-66, 616], [548, 616], [548, 662], [-66, 662]], road, 0.04);
  flat([[90, 202], [180, 182], [311, 148], [403, 176], [403, 456], [90, 456]], grass, 0.025);
  flat([[-600, 690], [1100, 690], [1100, 1300], [-600, 1300]], park, 0.02);
  flat([[-600, ny(-600) + 30], [-90, ny(-90) + 30], [-90, 640], [-600, 640]], park, 0.02);
  { // building 2 (context only)
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.6 });
    [[[110, 494], [477, 494], [477, 608], [110, 608], GF + 10 * FH], [[30, 500], [110, 500], [110, 602], [30, 602], GF + 7 * FH]].forEach(b => {
      const m = mesh(extrude(b.slice(0, 4), b[4], 0), ghostMat); scene.add(m, new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), edgeMat));
    });
  }
  { // trees (instanced)
    const r = rng(7), spots = [];
    for (let X = -560; X < 1060; X += 26) spots.push([X + r() * 6, ny(X) - 66 - r() * 10]);
    for (let Y = ny(-80) + 20; Y < 640; Y += 24) spots.push([-84 - r() * 8, Y]);
    for (let Y = ny(566) + 20; Y < 640; Y += 24) spots.push([566 + r() * 8, Y]);
    for (let i = 0; i < 150; i++) spots.push([-560 + r() * 1600, 705 + r() * 420]);
    for (let i = 0; i < 70; i++) spots.push([-560 + r() * 440, 140 + r() * 480]);
    for (let i = 0; i < 70; i++) spots.push([580 + r() * 480, 40 + r() * 600]);
    [[150, 260], [205, 300], [340, 250], [365, 330], [140, 400], [355, 420], [260, 410]].forEach(p => spots.push(p));
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), M(0xffffff, { roughness: 1 }), spots.length);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 1, 6), M(0x7b6a58), spots.length);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
    spots.forEach(([X, Y], i) => {
      const s = 2.6 + r() * 2.2, h = 3 + r() * 2;
      mtx.compose(ps.set(wx(X), h + s * 0.8, wz(Y)), q, sc.set(s, s * 1.15, s)); crowns.setMatrixAt(i, mtx);
      crowns.setColorAt(i, col.setHSL(0.24 + r() * 0.06, 0.32 + r() * 0.12, 0.38 + r() * 0.1));
      mtx.compose(ps.set(wx(X), h / 2, wz(Y)), q, sc.set(1, h, 1)); trunks.setMatrixAt(i, mtx);
    });
    crowns.castShadow = true; trunks.castShadow = true; scene.add(crowns, trunks);
  }

  /* building 1 */
  const grp = u => { const cx = cen(u)[0]; if (u.k === 2) return cx < 82 ? '2a' : '2b'; if (u.k === 4) return cx < 405 ? '4a' : '4b'; return String(u.k); };
  const CONN = [
    ['1', '2a', [[16, 262], [80, 262], [90, 280], [16, 280]]],
    ['2a', '2b', [[79, 133], [84, 123], [95, 158], [99, 177], [99, 202], [80, 210], [79, 168]]],
    ['2b', '3', [[176, 103], [185, 94], [185, 168], [176, 180]]],
    ['3', '4a', [[308, 64], [318, 55], [318, 134], [308, 146]]],
    ['4a', '4b', [[407, 36], [415, 25], [415, 124], [407, 124]]],
    ['4b', '5', [[413, 166], [477, 166], [477, 180], [413, 180]]]
  ];
  const floors = {};
  units.forEach(u => { const F = (floors[u.f] = floors[u.f] || { groups: {} }); (F.groups[grp(u)] = F.groups[grp(u)] || []).push(u); });
  const topOf = {}; units.forEach(u => { const g = grp(u); topOf[g] = Math.max(topOf[g] || 0, u.f); });
  const coreOf = list => list.length >= 3 ? convex(list.map(cen)) : null;   // corridor: hull of flat centroids
  const hasAbove = u => units.some(v => v.f === u.f + 1 && v.k === u.k && Math.hypot(cen(v)[0] - cen(u)[0], cen(v)[1] - cen(u)[1]) < 9);
  const B = new THREE.Group(); scene.add(B);
  { const gs = [];
    Object.values(floors[1].groups).forEach(list => { list.forEach(u => gs.push(extrude(u.g, GF - 0.02, 0))); const c = coreOf(list); if (c) gs.push(extrude(c, GF - 0.02, 0)); });
    CONN.forEach(([a, b, poly]) => { if (floors[1].groups[a] && floors[1].groups[b]) gs.push(extrude(poly, GF - 0.02, 0)); });
    B.add(mesh(merge(gs), gfMat)); }
  Object.keys(floors).map(Number).sort((a, b) => a - b).forEach(f => {
    const F = floors[f], y = base(f), slabs = [], cores = [], roofs = [], boxes = [], ug = [], list = Object.values(F.groups).flat();
    Object.entries(F.groups).forEach(([g, gl]) => {
      gl.forEach(u => { slabs.push(extrude(u.g, SL, y + UH)); if (!hasAbove(u)) roofs.push(extrude(inset(u.g, 0.86), 0.12, y + FH)); });
      const c = coreOf(gl);
      if (c) { cores.push(extrude(c, UH - 0.06, y)); slabs.push(extrude(c, SL, y + UH)); }
      if (topOf[g] === f && c) {
        const m = c.reduce((a, p) => [a[0] + p[0] / c.length, a[1] + p[1] / c.length], [0, 0]);
        [[-7, -3], [7, 5], [0, 14]].slice(0, gl.length > 6 ? 3 : 1).forEach(([dx, dy]) => boxes.push(extrude([[m[0] + dx - 4, m[1] + dy - 4], [m[0] + dx + 4, m[1] + dy - 4], [m[0] + dx + 4, m[1] + dy + 4], [m[0] + dx - 4, m[1] + dy + 4]], 1.6, y + FH)));
      }
    });
    CONN.forEach(([a, b, poly]) => { if (F.groups[a] && F.groups[b]) { slabs.push(extrude(poly, SL, y + UH)); cores.push(extrude(poly, UH - 0.06, y)); } });
    // all flats of the floor in ONE mesh, coloured per vertex
    const ranges = []; let start = 0;
    list.forEach(u => { const g = extrude(u.g, UH, y); ranges.push([u.n, start, g.attributes.position.count]); start += g.attributes.position.count; ug.push(g); });
    const um = mesh(merge(ug, true), unitMat);
    const tri = new Uint16Array(start / 3);
    ranges.forEach(([n, s, c]) => { unitInfo.set(n, { mesh: um, start: s, count: c, key: '' }); tri.fill(n, s / 3, (s + c) / 3); });
    um.userData.tri = tri; um.userData.f = f; pickMeshes.push(um);
    const o = floorObjs[f] = { units: um, slab: mesh(merge(slabs), slabMat), core: cores.length ? mesh(merge(cores), coreMat, false) : new THREE.Object3D() };
    B.add(um, o.slab, o.core);
    if (roofs.length) { o.roof = new THREE.Group(); o.roof.add(mesh(merge(roofs), roofMat, false)); if (boxes.length) o.roof.add(mesh(merge(boxes), boxMat)); B.add(o.roof); }
  });

  outline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff })); outline.visible = false; scene.add(outline);
  selOutline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x15171b })); selOutline.visible = false; scene.add(selOutline);
  buildLabels();
  bindPointer();
  new ResizeObserver(resize).observe(canvas);
  apply(true); updateCamera(); resize();
  loadingEl.remove();
}

/* ---------------- labels ---------------- */
const labelsEl = document.getElementById('labels3d');
const klLabels = []; let unitLabels = [];
function buildLabels() {
  const byK = {}; units.forEach(u => (byK[u.k] = byK[u.k] || []).push(u));
  Object.entries(byK).forEach(([k, list]) => {
    const top = Math.max(...list.map(u => u.f)); const tl = list.filter(u => u.f === top - (top === 11 ? 1 : 0));
    const pts = tl.flatMap(u => u.g); const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
    const el = document.createElement('div'); el.className = 'l3'; el.textContent = 'KLATKA ' + k; labelsEl.appendChild(el);
    klLabels.push({ el, p: new THREE.Vector3(wx(c[0]), base(top) + FH + 5, wz(c[1])) });
  });
  const el = document.createElement('div'); el.className = 'l3'; el.style.opacity = '.75'; el.textContent = 'BUDYNEK 2'; labelsEl.appendChild(el);
  klLabels.push({ el, p: new THREE.Vector3(wx(290), GF + 10 * FH + 5, wz(551)) });
}
function buildUnitLabels(f) {
  unitLabels.forEach(l => l.el.remove()); unitLabels = [];
  if (f == null || !built) return;
  units.filter(u => u.f === f).forEach(u => {
    const c = cen(u); const el = document.createElement('div'); el.className = 'l3 unit ' + u.s; el.textContent = u.n; labelsEl.appendChild(el);
    unitLabels.push({ el, p: new THREE.Vector3(wx(c[0]), base(f) + UH + 0.6, wz(c[1])), n: u.n });
  });
}
let tmpV;
function placeLabels() {
  tmpV = tmpV || new THREE.Vector3();
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const place = l => { tmpV.copy(l.p).project(camera); const vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1; l.el.style.display = vis ? '' : 'none'; if (vis) l.el.style.transform = `translate(${((tmpV.x + 1) / 2 * w).toFixed(1)}px,${((1 - tmpV.y) / 2 * h).toFixed(1)}px) translate(-50%,-50%)`; };
  klLabels.forEach(l => { if (cutFloor != null) l.el.style.display = 'none'; else place(l); });
  unitLabels.forEach(l => { if (!APP.match(APP.byN.get(l.n))) l.el.style.display = 'none'; else place(l); });
}

/* ---------------- state -> colours ---------------- */
let cutFloor = null, hoverN = null, selN = null, outline, selOutline;
const edgeCache = new Map();
const edgesFor = n => { if (!edgeCache.has(n)) { const u = APP.byN.get(n); const g = extrude(u.g, UH, base(u.f)); edgeCache.set(n, new THREE.EdgesGeometry(g, 20)); g.dispose(); } return edgeCache.get(n); };
const tmpC = () => new THREE.Color();
function colorFor(u) {
  const ok = APP.match(u), colored = APP.state.overlay && (cutFloor == null || u.f === cutFloor);
  let key, c;
  if (u.n === selN) { key = 'sel' + u.s; c = tmpC().copy(colored || !ok ? COL[u.s] : COL.facade).lerp(COL.white, 0.12).multiplyScalar(1.25); }
  else if (u.n === hoverN) { key = 'hov' + (colored || !ok ? u.s : 'f'); c = tmpC().copy(colored || !ok ? COL[u.s] : COL.facade).lerp(COL.white, 0.38); }
  else if (!ok) { key = 'dim'; c = COL.dim; }
  else if (colored) { key = u.s; c = COL[u.s]; }
  else { key = 'f'; c = COL.facade; }
  return [key, c];
}
const touched = new Set();
function paint(n) {
  const inf = unitInfo.get(n); if (!inf) return;
  const [key, c] = colorFor(APP.byN.get(n)); if (key === inf.key) return;
  inf.key = key; const arr = inf.mesh.geometry.attributes.color.array;
  for (let i = inf.start, e = inf.start + inf.count; i < e; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  touched.add(inf.mesh);
}
function flush() { touched.forEach(m => m.geometry.attributes.color.needsUpdate = true); touched.clear(); dirty = true; }
function apply(all) {
  if (!built) return;
  if (all) units.forEach(u => paint(u.n));
  Object.entries(floorObjs).forEach(([f, o]) => {
    f = +f; const hide = cutFloor != null && f > cutFloor;
    o.units.visible = !hide; o.core.visible = !hide; o.slab.visible = !hide && cutFloor !== f;
    if (o.roof) o.roof.visible = !hide && cutFloor !== f;
  });
  const vis = n => n != null && unitInfo.get(n) && unitInfo.get(n).mesh.visible;
  outline.visible = vis(hoverN); if (outline.visible) outline.geometry = edgesFor(hoverN);
  selOutline.visible = vis(selN) && selN !== hoverN; if (selOutline.visible) selOutline.geometry = edgesFor(selN);
  flush();
}

/* ---------------- camera ---------------- */
const DEF = { th: -2.72, ph: 1.08, d: 215, t: [0, 15, 6] };
const cam = { th: DEF.th, ph: DEF.ph, d: DEF.d, t: DEF.t.slice() };
const goal = { th: DEF.th, ph: DEF.ph, d: DEF.d, t: DEF.t.slice() };
function updateCamera() {
  const sp = Math.sin(cam.ph);
  camera.position.set(cam.t[0] + cam.d * sp * Math.sin(cam.th), cam.t[1] + cam.d * Math.cos(cam.ph), cam.t[2] + cam.d * sp * Math.cos(cam.th));
  camera.lookAt(cam.t[0], cam.t[1], cam.t[2]);
}
function resize() {
  if (!built) return;
  const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w / h < 0.9 ? 46 : 32; camera.updateProjectionMatrix(); dirty = true; kick();
}
function tick() {
  raf = 0; if (!active || !built) return;
  let moving = false; const k = 0.16;
  const ease = (a, b) => { const d = b - a; if (Math.abs(d) > 1e-4) { moving = true; return a + d * k; } return b; };
  cam.th = ease(cam.th, goal.th); cam.ph = ease(cam.ph, goal.ph); cam.d = ease(cam.d, goal.d);
  for (let i = 0; i < 3; i++) cam.t[i] = ease(cam.t[i], goal.t[i]);
  if (moving || dirty) { updateCamera(); renderer.render(scene, camera); placeLabels(); APP.compass(); dirty = false; }
  if (moving) raf = requestAnimationFrame(tick);          // idle = no frames at all
}
const kick = () => { if (active && built && !raf) raf = requestAnimationFrame(tick); };
const zoomBy = f => { goal.d = Math.min(420, Math.max(55, goal.d * f)); kick(); };

/* ---------------- pointer ---------------- */
let ray, ndc;
function pick(x, y) {
  const r = canvas.getBoundingClientRect(); ndc.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(pickMeshes.filter(m => m.visible), false)[0];
  return hit ? hit.object.userData.tri[hit.faceIndex] : null;
}
function setHover(n) {
  if (n === hoverN) return; const prev = hoverN; hoverN = n;
  if (prev != null) paint(prev); if (n != null) paint(n);
  outline.visible = n != null && unitInfo.get(n).mesh.visible; if (outline.visible) outline.geometry = edgesFor(n);
  selOutline.visible = selN != null && selN !== hoverN && unitInfo.get(selN).mesh.visible;
  flush(); kick();
}
const wheelHint = document.getElementById('wheelHint');
let lastTouchCanvas = 0, hintT;
function bindPointer() {
  ray = new THREE.Raycaster(); ndc = new THREE.Vector2();
  const ptrs = new Map(); let dragDist = 0, pinch0 = 0, lastPick = 0, pending = null;
  canvas.addEventListener('pointerdown', e => { lastTouchCanvas = performance.now(); if (e.pointerType !== 'touch') canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragDist = 0; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); } });
  canvas.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId);
    if (p) {
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; dragDist += Math.abs(dx) + Math.abs(dy);
      if (ptrs.size === 1) {
        goal.th -= dx * 0.0062;
        if (e.pointerType !== 'touch') goal.ph = Math.min(1.42, Math.max(0.28, goal.ph - dy * 0.0045));
        if (dragDist > 4) { canvas.classList.add('drag'); if (hoverN != null) { setHover(null); APP.hover(null); } }
      } else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) zoomBy(pinch0 / d); pinch0 = d; }
      kick(); return;
    }
    if (e.pointerType === 'touch') return;
    pending = e;
    const now = performance.now(); if (now - lastPick < 40) return; lastPick = now;
    requestAnimationFrame(() => { if (!pending) return; const ev = pending; pending = null; const n = pick(ev.clientX, ev.clientY); canvas.classList.toggle('hover', n != null); setHover(n); APP.hover(n, ev.clientX, ev.clientY); });
  });
  const end = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId); canvas.classList.remove('drag');
    if (e.type === 'pointerup' && dragDist < 8 && ptrs.size === 0) { const n = pick(e.clientX, e.clientY); if (n != null) APP.open(n); }
    if (ptrs.size < 2) pinch0 = 0;
  };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { pending = null; if (hoverN != null) setHover(null); APP.hover(null); });
  // wheel: zoom only with Ctrl/⌘ (also trackpad pinch) or right after interacting with the model – otherwise let the page scroll
  canvas.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey || performance.now() - lastTouchCanvas < 2500) {
      e.preventDefault(); lastTouchCanvas = performance.now();
      zoomBy(1 + Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100) * (e.ctrlKey ? 0.006 : 0.0012));
    } else if (wheelHint) { wheelHint.classList.add('on'); clearTimeout(hintT); hintT = setTimeout(() => wheelHint.classList.remove('on'), 1400); }
  }, { passive: false });
}

/* ---------------- public API ---------------- */
function setFloor(f) {
  cutFloor = f; buildUnitLabels(f); apply(true);
  if (f != null) { goal.t = [0, base(f) + UH, 6]; goal.ph = Math.min(goal.ph, 0.82); goal.d = Math.min(goal.d, 190); }
  else { goal.t = DEF.t.slice(); goal.ph = DEF.ph; }
  kick();
}
window.APP3D = {
  activate(on) { active = on; if (on) { build(); resize(); dirty = true; kick(); } },
  refresh() { if (!built) return; apply(true); if (cutFloor != null) buildUnitLabels(cutFloor); kick(); },
  highlight(n) { if (!built) return; setHover(n); },
  select(n) { const prev = selN; selN = n; if (!built) return; if (prev != null) paint(prev); if (n != null) paint(n); apply(false); kick(); },
  setFloor(f) { cutFloor = f; if (!built) return; setFloor(f); },
  rotate(dir) { goal.th += dir * Math.PI / 4; kick(); },
  zoom(dir) { zoomBy(dir > 0 ? 0.8 : 1.25); },
  reset() { goal.th = DEF.th; goal.ph = DEF.ph; goal.d = DEF.d; goal.t = DEF.t.slice(); cutFloor = null; buildUnitLabels(null); apply(true); kick(); },
  focusUnit(n) {
    const u = APP.byN.get(n); if (!u) return; const c = cen(u); const x = wx(c[0]), z = wz(c[1]);
    goal.t = [x * 0.5, base(u.f) + UH / 2, z * 0.5]; goal.th = Math.atan2(x, z); goal.ph = 0.95; goal.d = 150; kick();
  },
  northDeg() { return 29 + cam.th * 180 / Math.PI; },
  resize() { resize(); },
  build,
  info() { return built ? { calls: renderer.info.render.calls, tris: renderer.info.render.triangles } : null; }
};
APP.onChange(() => window.APP3D.refresh());
// pre-build in idle time so the 3D tab opens instantly
const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1200));
if (window.__want3d || APP.state.view === '3d') window.APP3D.activate(true);
else idle(() => { if (!built) { build(); } }, { timeout: 3000 });
if (window.__after3d) { window.__after3d(); window.__after3d = null; }
