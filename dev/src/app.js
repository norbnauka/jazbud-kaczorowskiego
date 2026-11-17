(function(){
'use strict';
const IMG = window.IMG_BASE || 'https://www.jaz-bud.pl';
const U = window.UNITS;
const byN = new Map(U.map(u => [u.n, u]));
const ST = {D:'Dostępne', R:'Rezerwacja', S:'Sprzedane'};
const TERM = {W:'wrzesień 2027', M:'maj 2027', C:'czerwiec 2027', G:'grudzień 2026'};
const STAMP = '17.11.2026';
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const nf = new Intl.NumberFormat('pl-PL');
const fmtP = p => nf.format(p) + ' zł';
const fmtA = a => a.toFixed(2).replace('.', ',') + ' m²';
const roomsTxt = r => r === 1 ? '1 pokój' : r + (r < 5 ? ' pokoje' : ' pokoi');
const floorTxt = f => f === 0 ? 'parter' : 'piętro ' + f;

/* ---------- geometry helpers (plan frame -> floor-plan image px) ---------- */
const KT = {k1:[17,82,1.544], k2:[12,78,1.5545], k7:[10,76,1.562], k8:[10,77,1.5575]};
const floorType = f => f === 1 ? 'k1' : f <= 6 ? 'k2' : f === 7 ? 'k7' : f <= 10 ? 'k8' : null;
const toPlan = (g, t) => { const [ox, oy, s] = KT[t]; return g.map(([x, y]) => [ox + x*s, oy + y*s]); };
const centroid = pts => { let a=0,cx=0,cy=0; for (let i=0;i<pts.length;i++){const [x0,y0]=pts[i],[x1,y1]=pts[(i+1)%pts.length];const c=x0*y1-x1*y0;a+=c;cx+=(x0+x1)*c;cy+=(y0+y1)*c;} a/=2; return a ? [cx/(6*a), cy/(6*a)] : pts[0]; };
const planUrl = n => (n === 160 || n === 161 || n === 341) ? null : `${IMG}/images/kaczorowskiego-1/11.2024/rzuty/M${n}.jpg`;
const kartaUrl = n => n === 40 ? `${IMG}/images/kaczorowskiego-1/1.2025/M40.pdf` : n === 318 ? `${IMG}/images/kaczorowskiego-1/pdf/M318.pdf` : (n === 160 || n === 161 || n === 341) ? null : `${IMG}/images/kaczorowskiego-1/11.2024/karty-pdf/M${n}.pdf`;
const thumbUrl = u => u && u.th ? `${IMG}/templates/yootheme/cache/${u.th.slice(0, 2)}/M${u.n}-${u.th}.webp` : null;
const floorImg = t => `${IMG}/images/plany/407/${t}.jpg`;
const term = u => u.t ? TERM[u.t] : (u.k <= 2 ? TERM.W : TERM.M);

/* ---------- favourites ---------- */
let favs = new Set();
try { favs = new Set(JSON.parse(localStorage.getItem('jb_fav') || '[]')); } catch(e) {}
const saveFav = () => { try { localStorage.setItem('jb_fav', JSON.stringify([...favs])); } catch(e) {} updateFavUI(); };
function toggleFav(n){ favs.has(n) ? favs.delete(n) : favs.add(n); saveFav(); toast(favs.has(n) ? `Dodano M-${n} do ulubionych` : `Usunięto M-${n} z ulubionych`); }
function updateFavUI(){ $('#favCount').textContent = favs.size; $('#favBtn').classList.toggle('has', favs.size > 0); $$('.icon-btn.fav').forEach(b => b.classList.toggle('on', favs.has(+b.dataset.n))); }

/* ---------- state & filters ---------- */
const state = {
  view: 'estate', overlay: true, floor: null, planFloor: 2,
  f: { rooms: new Set(), status: new Set(['D','R','S']), fmin: 1, fmax: 11, amin: '', amax: '', pmax: '', kl: '', fav: false },
  sort: { key: 'n', dir: 1 }, shown: 30
};
function match(u){
  const f = state.f;
  if (!f.status.has(u.s)) return false;
  if (f.rooms.size && !f.rooms.has(Math.min(u.r, 4))) return false;
  if (u.f < f.fmin || u.f > f.fmax) return false;
  if (f.amin !== '' && u.a < +f.amin) return false;
  if (f.amax !== '' && u.a > +f.amax) return false;
  if (f.pmax !== '' && (u.s === 'S' || u.p > +f.pmax)) return false;
  if (f.kl !== '' && u.k !== +f.kl) return false;
  if (f.fav && !favs.has(u.n)) return false;
  return true;
}
const listeners = [];
function changed(){ state.shown = 30; syncFilterUI(); renderTable(); renderPanel(); renderLegend(); renderPlan(); listeners.forEach(fn => fn()); }

function filterMarkup(){
  const floorsOpt = sel => Array.from({length:11}, (_, i) => `<option value="${i+1}" ${sel===i+1?'selected':''}>${i+1}</option>`).join('');
  return `
  <div class="frow"><span class="flabel">Pokoje</span>${[1,2,3,4].map(r => `<button class="chip" data-room="${r}">${r === 4 ? '4' : r}</button>`).join('')}</div>
  <div class="frow"><span class="flabel">Status</span>${['D','R','S'].map(s => `<button class="chip st ${s}" data-st="${s}"><i></i>${ST[s]}</button>`).join('')}</div>
  <div class="frow"><span class="flabel">Piętro</span><span class="rng"><select class="sel" data-k="fmin">${floorsOpt(1)}</select><span>–</span><select class="sel" data-k="fmax">${floorsOpt(11)}</select></span></div>
  <div class="frow"><span class="flabel">Metraż</span><span class="rng"><input type="number" min="0" step="1" placeholder="od" data-k="amin"><span>–</span><input type="number" min="0" step="1" placeholder="do" data-k="amax"><span>m²</span></span></div>
  <div class="frow"><span class="flabel">Cena</span><select class="sel" data-k="pmax"><option value="">bez limitu</option>${[450000,500000,550000,600000,700000,800000,1000000].map(v => `<option value="${v}">do ${nf.format(v)} zł</option>`).join('')}</select>
    <select class="sel" data-k="kl"><option value="">Wszystkie klatki</option>${[1,2,3,4,5].map(k => `<option value="${k}">Klatka ${k}</option>`).join('')}</select>
    <button class="chip" data-favf><span style="color:var(--brand)">♥</span> Ulubione</button></div>`;
}
function bindFilters(root){
  root.innerHTML = filterMarkup();
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.room){ const r = +b.dataset.room; state.f.rooms.has(r) ? state.f.rooms.delete(r) : state.f.rooms.add(r); changed(); }
    else if (b.dataset.st){ const s = b.dataset.st, st = state.f.status; if (st.size === 3) state.f.status = new Set([s]); else if (st.has(s) && st.size === 1) state.f.status = new Set(['D','R','S']); else { st.has(s) ? st.delete(s) : st.add(s); if (!st.size || st.size === 3) state.f.status = new Set(['D','R','S']); } changed(); }
    else if ('favf' in b.dataset){ state.f.fav = !state.f.fav; changed(); }
  });
  root.addEventListener('change', e => {
    const k = e.target.dataset.k; if (!k) return;
    let v = e.target.value;
    if (k === 'fmin' || k === 'fmax') v = +v;
    state.f[k] = v;
    if (state.f.fmin > state.f.fmax) { if (k === 'fmin') state.f.fmax = state.f.fmin; else state.f.fmin = state.f.fmax; }
    changed();
  });
}
function syncFilterUI(){
  $$('[data-filters]').forEach(root => {
    $$('[data-room]', root).forEach(b => b.classList.toggle('on', state.f.rooms.has(+b.dataset.room)));
    $$('[data-st]', root).forEach(b => b.classList.toggle('on', state.f.status.has(b.dataset.st) && state.f.status.size < 3));
    $$('[data-favf]', root).forEach(b => b.classList.toggle('on', state.f.fav));
    $$('[data-k]', root).forEach(el => { if (document.activeElement !== el) el.value = state.f[el.dataset.k]; });
  });
}
function resetFilters(){ state.f = { rooms:new Set(), status:new Set(['D','R','S']), fmin:1, fmax:11, amin:'', amax:'', pmax:'', kl:'', fav:false }; changed(); }

/* ---------- KPIs / facts ---------- */
function renderKpis(){
  const av = U.filter(u => u.s === 'D');
  const minM = Math.min(...av.map(u => u.m));
  const minP = Math.min(...av.map(u => u.p));
  const amin = Math.min(...U.map(u => u.a)), amax = Math.max(...U.map(u => u.a));
  $('#kpis').innerHTML = `
    <div class="kpi"><small>Mieszkań</small><b class="num">${U.length}</b></div>
    <div class="kpi ok"><small>Dostępnych</small><b class="num">${av.length}</b></div>
    <div class="kpi"><small>Cena od</small><b class="num">${nf.format(minM)} zł/m²</b></div>
    <div class="kpi"><small>Oddanie</small><b>maj / wrz. 2027</b></div>`;
  $('#facts').innerHTML = `
    <div class="fact"><small>Metraże</small><b class="num">${fmtA(amin).replace(' m²','')} – ${fmtA(amax)}</b><span>od kawalerek po apartament 4-pokojowy</span></div>
    <div class="fact"><small>Najtańsze dostępne</small><b class="num">${fmtP(minP)}</b><span>ceny od ${nf.format(minM)} zł/m²</span></div>
    <div class="fact"><small>Kondygnacje</small><b>parter + 10 pięter</b><span>5 klatek, lokale usługowe w parterze</span></div>
    <div class="fact"><small>Termin oddania</small><b>2027</b><span>klatki 3–5: maj · klatki 1–2: wrzesień</span></div>`;
  $('#stamp').textContent = STAMP;
}

/* ---------- legend ---------- */
function renderLegend(){
  const vis = U.filter(match);
  $('#legend').innerHTML = ['D','R','S'].map(s => `<button class="${s} ${state.f.status.has(s)?'':'off'}" data-lg="${s}"><i></i>${ST[s]} <span class="c num">${vis.filter(u=>u.s===s).length}</span></button>`).join('');
}
$('#legend').addEventListener('click', e => { const b = e.target.closest('[data-lg]'); if (!b) return; const s = b.dataset.lg; state.f.status.has(s) ? state.f.status.delete(s) : state.f.status.add(s); if (!state.f.status.size) state.f.status = new Set(['D','R','S']); changed(); });

/* ---------- table ---------- */
function sorted(list){
  const {key, dir} = state.sort;
  const rank = {D:0, R:1, S:2};
  return list.slice().sort((a, b) => {
    let va = a[key], vb = b[key];
    if (key === 's') { va = rank[a.s]; vb = rank[b.s]; }
    if (key === 'p' || key === 'm') { va = a.s === 'S' ? Infinity : a[key]; vb = b.s === 'S' ? Infinity : b[key]; }
    return (va > vb ? 1 : va < vb ? -1 : a.n - b.n) * dir;
  });
}
function renderTable(){
  const list = sorted(U.filter(match));
  $('#resCount').textContent = `${list.length} ${list.length === 1 ? 'mieszkanie' : (list.length % 10 >= 2 && list.length % 10 <= 4 && (list.length % 100 < 10 || list.length % 100 >= 20)) ? 'mieszkania' : 'mieszkań'}`;
  const rows = list.slice(0, state.shown).map(u => `
    <tr class="${u.s}" data-n="${u.n}">
      <td>M-${u.n}</td>
      <td data-l="Klatka">${u.k}</td>
      <td data-l="Piętro">${u.f}</td>
      <td data-l="Metraż" class="num">${fmtA(u.a)}</td>
      <td data-l="Pokoje">${u.r}</td>
      <td data-l="Cena za m²" class="num">${u.s === 'S' ? '—' : nf.format(u.m) + ' zł'}</td>
      <td data-l="Cena" class="num" style="font-weight:700">${u.s === 'S' ? '—' : fmtP(u.p)}</td>
      <td><span class="badge ${u.s}"><i></i>${ST[u.s]}</span></td>
      <td class="tact"><div class="tactions">
        <button class="icon-btn fav ${favs.has(u.n)?'on':''}" data-n="${u.n}" data-fav title="Ulubione"><svg><use href="#i-heart"/></svg></button>
        ${kartaUrl(u.n) ? `<a class="icon-btn" href="${kartaUrl(u.n)}" target="_blank" rel="noopener" title="Karta katalogowa (PDF)" data-stop><svg><use href="#i-pdf"/></svg></a>` : ''}
      </div></td>
    </tr>`).join('');
  $('#tbody').innerHTML = rows;
  $('#tEmpty').hidden = list.length > 0;
  $('#moreBtn').parentElement.style.display = list.length > state.shown ? '' : 'none';
  $$('table.units th[data-s]').forEach(th => { th.classList.toggle('sorted', th.dataset.s === state.sort.key); th.querySelector('.ar').textContent = th.dataset.s === state.sort.key && state.sort.dir < 0 ? '▼' : '▲'; });
}
$('#tbody').addEventListener('click', e => {
  if (e.target.closest('[data-stop]')) return;
  const fb = e.target.closest('[data-fav]'); if (fb) { toggleFav(+fb.dataset.n); if (state.f.fav) changed(); return; }
  const tr = e.target.closest('tr[data-n]'); if (tr) openUnit(+tr.dataset.n);
});
$('#tbody').addEventListener('mouseover', e => { const tr = e.target.closest('tr[data-n]'); if (tr) hl(+tr.dataset.n); });
$('#tbody').addEventListener('mouseleave', () => hl(null));
$$('table.units th[data-s]').forEach(th => th.addEventListener('click', () => { const k = th.dataset.s; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 }; renderTable(); }));
$('#moreBtn').addEventListener('click', () => { state.shown += 40; renderTable(); });
$('#resetF').addEventListener('click', resetFilters);

/* ---------- side panel ---------- */
function renderPanel(){
  const list = sorted(U.filter(match));
  $('#pCount').textContent = `${list.length} wyników`;
  $('#pList').innerHTML = list.slice(0, 160).map(u => `
    <div class="pitem ${u.s}" data-n="${u.n}">
      <div class="thumb">${thumbUrl(u) ? `<img loading="lazy" decoding="async" src="${thumbUrl(u)}" alt="" style="width:100%;height:100%;object-fit:contain;mix-blend-mode:multiply">` : ''}</div>
      <div><b>M-${u.n} <span class="dot ${u.s}"></span></b><small>${fmtA(u.a)} · ${roomsTxt(u.r)} · p. ${u.f} · kl. ${u.k}</small></div>
      <div class="pr">${u.s === 'S' ? '<small>sprzedane</small>' : `<span class="num">${nf.format(Math.round(u.p/1000))} tys.</span><small class="num">${nf.format(u.m)} zł/m²</small>`}</div>
    </div>`).join('') + (list.length > 160 ? `<div class="empty">+ ${list.length - 160} kolejnych – zawęź filtry lub zobacz tabelę poniżej</div>` : '') + (!list.length ? '<div class="empty">Brak wyników</div>' : '');
}
$('#pList').addEventListener('click', e => { const it = e.target.closest('.pitem'); if (it) openUnit(+it.dataset.n); });
$('#pList').addEventListener('mouseover', e => { const it = e.target.closest('.pitem'); if (it) hl(+it.dataset.n); });
$('#pList').addEventListener('mouseleave', () => hl(null));
$('#panelToggle').addEventListener('click', () => $('#viewer').classList.toggle('panel-open'));
$('#pfToggle').addEventListener('click', () => { $('#panel').classList.toggle('show-f'); $('#pfToggle').classList.toggle('on'); });

/* ---------- highlight across views ---------- */
let hlN = null;
function hl(n){
  if (n === hlN) return; hlN = n;
  $$('.upoly.hl').forEach(p => p.classList.remove('hl'));
  if (n != null) { const p = $(`#planSvg .upoly[data-n="${n}"]`); if (p) p.classList.add('hl'); }
  $$('.pitem.hl').forEach(p => p.classList.remove('hl'));
  if (n != null) { const it = $(`.pitem[data-n="${n}"]`); if (it) it.classList.add('hl'); }
  if (window.APP3D) window.APP3D.highlight(n);
  const u = n != null && byN.get(n);
  if (u && state.view === 'plan' && u.f !== state.planFloor && floorType(u.f)) { /* keep floor; no auto-switch */ }
}

/* ---------- tooltip ---------- */
const tip = $('#tip');
let tipN = null;
function showTip(u, x, y){
  if (!u) return hideTip();
  if (tipN !== u.n){
    tipN = u.n;
    const pu = thumbUrl(u) || planUrl(u.n);
    $('#tpImg').style.backgroundImage = pu ? `url("${pu}")` : 'none';
    $('#tpNo').textContent = 'M-' + u.n;
    $('#tpDot').className = 'dot ' + u.s;
    $('#tpSt').textContent = ST[u.s]; $('#tpSt').className = 'tp-st ' + u.s;
    $('#tpTxt').innerHTML = `pow. <b>${fmtA(u.a)}</b><br>piętro <b>${u.f}</b> · klatka <b>${u.k}</b><br>pokoje <b>${u.r}</b>`;
    $('#tpPrice').textContent = u.s === 'S' ? '' : fmtP(u.p);
  }
  tip.classList.add('on');
  const r = tip.getBoundingClientRect();
  let left = x + 22, top = y - r.height / 2;
  if (left + r.width > innerWidth - 12) left = x - r.width - 22;
  top = Math.max(12, Math.min(innerHeight - r.height - 12, top));
  tip.style.left = left + 'px'; tip.style.top = top + 'px';
}
function hideTip(){ tip.classList.remove('on'); tipN = null; }

/* ---------- views ---------- */
$('#viewer').addEventListener('scroll', e => { e.currentTarget.scrollLeft = 0; e.currentTarget.scrollTop = 0; });
function setView(v){
  state.view = v;
  const V = $('#viewer');
  V.classList.remove('m-estate','m-3d','m-plan'); V.classList.add('m-' + v);
  $$('.stage').forEach(s => s.classList.toggle('on', s.dataset.view === v));
  $$('#vtabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('#floors').hidden = v === 'estate';
  hideTip();
  if (v === '3d') { if (window.APP3D) window.APP3D.activate(true); else window.__want3d = true; $('#hint').classList.remove('hide'); setTimeout(() => $('#hint').classList.add('hide'), 4200); }
  else { if (window.APP3D) window.APP3D.activate(false); $('#hint').classList.add('hide'); }
  if (v === 'plan') renderPlan();
  if (v === 'estate') layoutEstate();
  renderFloors();
  updateCompass();
}
$('#vtabs').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) setView(b.dataset.v); });

/* ---------- floors rail ---------- */
function renderFloors(){
  const cur = state.view === 'plan' ? state.planFloor : state.floor;
  const counts = {}; U.forEach(u => { if (u.s === 'D' && match(u)) counts[u.f] = (counts[u.f] || 0) + 1; });
  let h = `<div class="fl-title">PIĘTRO</div>`;
  if (state.view === '3d') h += `<button class="all ${cur == null ? 'on' : ''}" data-fl="">Całość</button>`;
  for (let f = 11; f >= 1; f--) h += `<button class="${cur === f ? 'on' : ''}" data-fl="${f}" title="Piętro ${f}: ${counts[f] || 0} dostępnych">${f}<i class="${counts[f] ? '' : 'none'}"></i></button>`;
  $('#floors').innerHTML = h;
}
$('#floors').addEventListener('click', e => {
  const b = e.target.closest('[data-fl]'); if (!b) return;
  const f = b.dataset.fl === '' ? null : +b.dataset.fl;
  if (state.view === 'plan') { if (f) { state.planFloor = f; renderPlan(); } }
  else { state.floor = f; if (window.APP3D) window.APP3D.setFloor(f); }
  renderFloors();
});

/* ---------- plan view ---------- */
function renderPlan(){
  const f = state.planFloor, t = floorType(f);
  const units = U.filter(u => u.f === f);
  const av = units.filter(u => u.s === 'D').length;
  $('#planTitle').innerHTML = `<b>Piętro ${f}</b>${units.length} mieszkań · <span style="color:var(--ok);font-weight:700">${av} dostępnych</span>`;
  if (!t) {
    $('#planInner').style.visibility = 'hidden';
    $('#planEmpty').classList.add('on');
    $('#planEmpty').innerHTML = `<div><b style="font-size:20px;color:var(--ink)">11. piętro – apartamenty</b><br>${units.map(u => `M-${u.n} · ${fmtA(u.a)} · ${ST[u.s].toLowerCase()}`).join('<br>')}<br><br>Dla tej kondygnacji dewelopera nie udostępnia rzutu.</div>`;
    return;
  }
  $('#planInner').style.visibility = '';
  $('#planEmpty').classList.remove('on');
  const img = $('#planImg'); const src = floorImg(t); if (img.getAttribute('src') !== src) img.src = src;
  $('#planSvg').innerHTML = units.map(u => {
    const pts = toPlan(u.g, t); const [cx, cy] = centroid(pts);
    const ok = match(u);
    return `<polygon class="upoly ${u.s} ${ok ? '' : 'dim'}" data-n="${u.n}" points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/><text class="utext" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}">${u.n}</text>`;
  }).join('');
}
const planSvg = $('#planSvg');
planSvg.addEventListener('pointermove', e => { const p = e.target.closest('.upoly'); if (p) { const n = +p.dataset.n; hl(n); if (e.pointerType !== 'touch') showTip(byN.get(n), e.clientX, e.clientY); } else { hl(null); hideTip(); } });
planSvg.addEventListener('pointerleave', () => { hl(null); hideTip(); });
planSvg.addEventListener('click', e => { const p = e.target.closest('.upoly'); if (p) openUnit(+p.dataset.n); });

/* ---------- estate (aerial) view ---------- */
const AER = { w: 1920, h: 1129 };
const estateItems = [
  { type:'b', x: 1300, y: 330, html: () => { const d = U.filter(u => u.s === 'D').length; return `<b>Budynek 1</b><span class="cnt"><i></i>${d} dostępnych z ${U.length}</span><span class="go">Wybierz mieszkanie →</span>`; }, go: '3d' },
  { type:'b', x: 640, y: 520, html: () => `<b>Budynek 2</b><span class="cnt"><i></i>poza ofertą tej strony</span>`, muted: true },
  { type:'pin', x: 1610, y: 610, label: 'Widok z ulicy', img: 2 },
  { type:'pin', x: 300, y: 930, label: 'Widok z parku', img: 3 },
  { type:'pin', x: 985, y: 372, label: 'Dziedziniec', img: 5 },
  { type:'pin', x: 1800, y: 420, label: 'Ul. Kaczorowskiego nocą', img: 'hero' }
];
function buildEstate(){
  $('#estateLabels').innerHTML = estateItems.map((it, i) => it.type === 'b'
    ? `<div class="blabel ${it.muted ? 'muted' : ''}" data-i="${i}">${it.html()}</div>`
    : `<button class="pin" data-i="${i}"><em>${it.label}</em><span><svg><use href="#i-camera"/></svg></span></button>`).join('');
}
function layoutEstate(){
  const el = $('#stEstate'); const W = el.clientWidth, H = el.clientHeight; if (!W) return;
  // on narrow / portrait screens crop the aerial around building 1 instead of the centre
  let vx = 0, vw = AER.w;
  if (W / H < 1.4) { vw = Math.min(AER.w, AER.h * W / H); vx = Math.max(0, Math.min(AER.w - vw, 1200 - vw / 2)); }
  $('#aer').setAttribute('viewBox', `${vx} 0 ${vw} ${AER.h}`);
  const s = Math.max(W / vw, H / AER.h), ox = (W - vw * s) / 2 - vx * s, oy = (H - AER.h * s) / 2;
  $$('#estateLabels [data-i]').forEach(n => {
    const it = estateItems[+n.dataset.i]; const x = it.x * s + ox; let y = it.y * s + oy - (it.type === 'b' ? 44 : 0); if (it.type === 'b') y = Math.max(y, n.offsetHeight + 84);
    n.style.left = x + 'px'; n.style.top = y + 'px';
    n.style.display = (x < 60 || x > W - 60) ? 'none' : '';
  });
}
$('#estateLabels').addEventListener('click', e => {
  const n = e.target.closest('[data-i]'); if (!n) return; const it = estateItems[+n.dataset.i];
  if (it.go) setView(it.go);
  if (it.type === 'pin') openLightbox(it.img === 'hero' ? 9 : it.img);
});
$('#b1poly').addEventListener('click', () => setView('3d'));
$('#b1poly').addEventListener('mouseenter', () => $('.blabel[data-i="0"]').style.transform = 'translate(-50%,-100%) translateY(-4px)');
$('#b1poly').addEventListener('mouseleave', () => $('.blabel[data-i="0"]').style.transform = '');
addEventListener('resize', layoutEstate);

/* ---------- toolbar ---------- */
$('#ovBtn').addEventListener('click', () => {
  state.overlay = !state.overlay;
  $('#ovBtn').classList.toggle('on', state.overlay);
  $('#ovBtn use').setAttribute('href', state.overlay ? '#i-eye' : '#i-eyeoff');
  $('#stEstate').classList.toggle('overlay-off', !state.overlay);
  $('#stPlan').classList.toggle('overlay-off', !state.overlay);
  if (window.APP3D) window.APP3D.refresh();
});
$('#fsBtn').addEventListener('click', () => { const v = $('#viewer'); if (document.fullscreenElement) document.exitFullscreen(); else if (v.requestFullscreen) v.requestFullscreen(); else if (v.webkitRequestFullscreen) v.webkitRequestFullscreen(); });
document.addEventListener('fullscreenchange', () => setTimeout(() => { layoutEstate(); if (window.APP3D) window.APP3D.resize(); }, 60));
$('#rotL').addEventListener('click', () => window.APP3D && window.APP3D.rotate(-1));
$('#rotR').addEventListener('click', () => window.APP3D && window.APP3D.rotate(1));
$('#zoomIn').addEventListener('click', () => window.APP3D && window.APP3D.zoom(1));
$('#zoomOut').addEventListener('click', () => window.APP3D && window.APP3D.zoom(-1));
$('#resetView').addEventListener('click', () => { state.floor = null; renderFloors(); window.APP3D && window.APP3D.reset(); });
function updateCompass(){
  let deg = 29; // plan north is ~29° clockwise from drawing "up"
  if (state.view === '3d' && window.APP3D) deg = window.APP3D.northDeg();
  if (state.view === 'estate') deg = 50;
  $('#needle').style.transform = `rotate(${deg}deg)`;
}

/* ---------- unit card (modal) ---------- */
let curN = null, navList = [];
function openUnit(n){
  const u = byN.get(n); if (!u) return;
  curN = n; hideTip();
  navList = sorted(U.filter(match)).map(x => x.n); if (!navList.includes(n)) navList = U.map(x => x.n);
  const pu = planUrl(n), ku = kartaUrl(n), t = floorType(u.f);
  $('#dPlan').src = pu || floorImg(t || 'k8');
  // floor tab
  if (t) {
    $('#dFloorImg').src = floorImg(t);
    $('#dFloorSvg').innerHTML = U.filter(x => x.f === u.f).map(x => `<polygon class="${x.n === n ? 'me' : ''}" points="${toPlan(x.g, t).map(p => p.join(',')).join(' ')}"/>`).join('');
  }
  $('[data-d="floor"]').style.display = t ? '' : 'none';
  setDTab('plan');
  const sim = U.filter(x => x.n !== n && x.s === 'D' && x.r === u.r).sort((a, b) => Math.abs(a.a - u.a) - Math.abs(b.a - u.a) || Math.abs(a.f - u.f) - Math.abs(b.f - u.f)).slice(0, 3);
  const h = u.h || [];
  const idx = navList.indexOf(n);
  $('#dInfo').innerHTML = `
    <div class="d-top">
      <div class="nav2"><button class="d-close" data-prev title="Poprzednie"><svg><use href="#i-rotl"/></svg></button><button class="d-close" data-next title="Następne"><svg><use href="#i-rotr"/></svg></button><span class="d-note" style="align-self:center;margin-left:4px">${idx + 1} / ${navList.length}</span></div>
      <div class="nav2"><button class="d-close icon-btn fav ${favs.has(n) ? 'on' : ''}" data-n="${n}" data-favd title="Ulubione"><svg><use href="#i-heart"/></svg></button><button class="d-close" data-share title="Kopiuj link"><svg><use href="#i-share"/></svg></button><button class="d-close" data-close title="Zamknij"><svg><use href="#i-x"/></svg></button></div>
    </div>
    <div class="d-title"><h3 id="dTitle">Mieszkanie <b>M-${n}</b></h3><span class="pill ${u.s}">${ST[u.s]}</span></div>
    <div class="tiles">
      <div class="tile"><small>Powierzchnia</small><b class="num">${fmtA(u.a)}</b></div>
      <div class="tile"><small>Pokoje</small><b>${u.r}</b></div>
      <div class="tile"><small>Piętro</small><b>${u.f}</b></div>
      <div class="tile"><small>Klatka</small><b>${u.k}</b></div>
    </div>
    ${u.s === 'S' ? `<div class="box"><h5>Lokal sprzedany</h5><p>To mieszkanie znalazło już właściciela. Zobacz podobne dostępne lokale poniżej albo zapytaj doradcę o nowe propozycje.</p></div>` : `
    <div class="tiles two">
      <div class="tile price"><small>Cena lokalu</small><b class="num">${fmtP(u.p)}</b></div>
      <div class="tile"><small>Cena za m²</small><b class="num">${nf.format(u.m)} zł</b></div>
    </div>
    <div class="box"><h5>Termin oddania<span style="font-weight:800">${term(u)}</span></h5></div>
    ${h.length ? `<div class="box"><h5>Historia cen <button class="tog" data-histtab>Tabela</button></h5>${chartSvg(h, u.p)}<table class="hist" id="histTbl"><tr><th>Data</th><th>Cena</th><th>Cena za m²</th></tr>${h.slice().reverse().map(([d, p]) => `<tr><td>${fmtDate(d)}</td><td class="num">${fmtP(p)}</td><td class="num">${nf.format(Math.round(p / u.a))} zł</td></tr>`).join('')}</table></div>` : ''}
    <div class="box"><h5>Inne świadczenia pieniężne <button class="tog" data-more>Szczegóły</button></h5><p data-moretxt hidden>Od przekazania lokalu do zawarcia umowy przeniesienia własności nabywca płaci miesięczną opłatę za korzystanie z lokalu (powierzchnia użytkowa × stawka z protokołu odbioru) oraz pokrywa koszty mediów, jeśli nie rozlicza ich bezpośrednio z dostawcami. Wysokości tej opłaty nie da się określić na dzień złożenia oferty.</p></div>`}
    <div class="d-actions">
      ${ku ? `<a class="btn btn-ghost" href="${ku}" target="_blank" rel="noopener"><svg><use href="#i-pdf"/></svg>Karta katalogowa</a>` : `<span></span>`}
      <a class="btn btn-brand" href="#kontakt" data-ask><svg><use href="#i-mail"/></svg>Zapytaj o M-${n}</a>
    </div>
    <div class="d-note">Komórki lokatorskie (3 000 zł/m²) i miejsca postojowe (50–70 tys. zł) płatne dodatkowo. Stan na ${STAMP}.${u.approx ? ' Położenie lokalu w modelu 3D jest orientacyjne.' : ''}</div>
    ${sim.length ? `<div><div class="eyebrow" style="margin:6px 0 10px">Podobne dostępne</div><div class="similar">${sim.map(x => `<button data-goto="${x.n}">${thumbUrl(x) ? `<img loading="lazy" src="${thumbUrl(x)}" alt="">` : ''}<b>M-${x.n} · ${fmtA(x.a)}</b><small>piętro ${x.f} · ${fmtP(x.p)}</small></button>`).join('')}</div></div>` : ''}`;
  bindChart();
  const m = $('#modal'); m.classList.add('on'); m.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => m.classList.add('show'));
  document.body.style.overflow = 'hidden';
  history.replaceState(null, '', '#M' + n);
  if (window.APP3D) window.APP3D.select(n);
}
function closeUnit(){
  const m = $('#modal'); m.classList.remove('show'); m.setAttribute('aria-hidden', 'true');
  setTimeout(() => m.classList.remove('on'), 250);
  document.body.style.overflow = '';
  if (location.hash.startsWith('#M')) history.replaceState(null, '', location.pathname + location.search);
  if (window.APP3D) window.APP3D.select(null);
}
function setDTab(d){ $$('#dTabs button').forEach(b => b.classList.toggle('on', b.dataset.d === d)); $$('.d-view').forEach(v => v.classList.toggle('on', v.dataset.dv === d)); }
$('#dTabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-d]'); if (!b) return;
  if (b.dataset.d === 'b3d') { const n = curN, u = byN.get(n); closeUnit(); setView('3d'); state.floor = u.f; renderFloors(); const go = () => { window.APP3D.setFloor(u.f); window.APP3D.select(n); window.APP3D.focusUnit(n); }; if (window.APP3D) go(); else window.__after3d = go; $('#wizualizacja').scrollIntoView({behavior:'smooth'}); return; }
  setDTab(b.dataset.d);
});
$('#modal').addEventListener('click', e => {
  if (e.target.closest('[data-close]')) return closeUnit();
  if (e.target.closest('[data-prev]')) { const i = navList.indexOf(curN); return openUnit(navList[(i - 1 + navList.length) % navList.length]); }
  if (e.target.closest('[data-next]')) { const i = navList.indexOf(curN); return openUnit(navList[(i + 1) % navList.length]); }
  const g = e.target.closest('[data-goto]'); if (g) return openUnit(+g.dataset.goto);
  const fb = e.target.closest('[data-favd]'); if (fb) { toggleFav(curN); fb.classList.toggle('on', favs.has(curN)); return; }
  if (e.target.closest('[data-share]')) { const url = location.href.split('#')[0] + '#M' + curN; (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link do mieszkania skopiowany'), () => toast(url)); return; }
  if (e.target.closest('[data-more]')) { const p = $('[data-moretxt]'); p.hidden = !p.hidden; return; }
  if (e.target.closest('[data-histtab]')) { $('#histTbl').classList.toggle('on'); return; }
  if (e.target.closest('[data-ask]')) { e.preventDefault(); const n = curN; closeUnit(); $('#cUnit').value = String(n); $('#kontakt').scrollIntoView({behavior:'smooth'}); }
});
addEventListener('keydown', e => {
  if ($('#lb').classList.contains('on')) { if (e.key === 'Escape') closeLightbox(); if (e.key === 'ArrowRight') stepLb(1); if (e.key === 'ArrowLeft') stepLb(-1); return; }
  if (!$('#modal').classList.contains('on')) return;
  if (e.key === 'Escape') closeUnit();
  if (e.key === 'ArrowRight') { const i = navList.indexOf(curN); openUnit(navList[(i + 1) % navList.length]); }
  if (e.key === 'ArrowLeft') { const i = navList.indexOf(curN); openUnit(navList[(i - 1 + navList.length) % navList.length]); }
});

/* ---------- price history chart ---------- */
const fmtDate = d => { const [y, m, dd] = d.split('-'); return `${dd}.${m}.${y}`; };
let chartPts = [];
function chartSvg(h, cur){
  const W = 460, H = 160, pl = 58, pr = 14, pt = 12, pb = 26;
  const t = h.map(([d]) => +new Date(d)); const v = h.map(x => x[1]);
  const t0 = Math.min(...t), t1 = Math.max(+new Date('2026-11-17'), ...t);
  let lo = Math.min(...v), hi = Math.max(...v); const pad = Math.max((hi - lo) * 0.25, hi * 0.02); lo -= pad; hi += pad;
  const X = x => pl + (x - t0) / (t1 - t0 || 1) * (W - pl - pr), Y = y => pt + (1 - (y - lo) / (hi - lo)) * (H - pt - pb);
  let d = `M${X(t[0])},${Y(v[0])}`; for (let i = 1; i < t.length; i++) d += ` H${X(t[i])} V${Y(v[i])}`; d += ` H${X(t1)}`;
  chartPts = h.map(([dd, p], i) => ({ x: X(t[i]), y: Y(p), d: dd, p }));
  const ticks = [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15];
  return `<div class="chart" id="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Historia ceny mieszkania">
    <g class="grid">${ticks.map(tk => `<line x1="${pl}" x2="${W - pr}" y1="${Y(tk)}" y2="${Y(tk)}"/><text class="ax" x="${pl - 8}" y="${Y(tk) + 4}" text-anchor="end">${nf.format(Math.round(tk / 1000))} tys.</text>`).join('')}</g>
    <path class="ln" d="${d}"/>
    ${chartPts.map((p, i) => `<circle class="pt ${i === chartPts.length - 1 ? 'last' : ''}" cx="${p.x}" cy="${p.y}" r="4"/>`).join('')}
    <text class="ax" x="${pl}" y="${H - 6}">${fmtDate(h[0][0]).slice(3)}</text><text class="ax" x="${W - pr}" y="${H - 6}" text-anchor="end">dziś</text>
    <rect class="hit" x="${pl}" y="0" width="${W - pl - pr}" height="${H}"/>
  </svg><div class="ctip" id="ctip"></div></div>`;
}
function bindChart(){
  const c = $('#chart'); if (!c) return; const svg = c.querySelector('svg'), ct = $('#ctip');
  svg.addEventListener('pointermove', e => {
    const r = svg.getBoundingClientRect(); const sx = (e.clientX - r.left) / r.width * 460;
    let best = chartPts[0]; chartPts.forEach(p => { if (Math.abs(p.x - sx) < Math.abs(best.x - sx)) best = p; });
    ct.innerHTML = `${fmtDate(best.d)} · ${fmtP(best.p)}`; ct.style.left = (best.x / 460 * r.width) + 'px'; ct.style.top = (best.y / 160 * r.height) + 'px'; ct.classList.add('on');
  });
  svg.addEventListener('pointerleave', () => ct.classList.remove('on'));
}

/* ---------- gallery & lightbox ---------- */
const GAL = [
  ['d6/kaczorowskiego-galeria-0-d63f60be'], ['3e/kaczorowskiego-galeria-1-3e28f01f'], ['dd/kaczorowskiego-galeria-2-dd6147bd'],
  ['35/kaczorowskiego-galeria-3-3576d71c'], ['b7/kaczorowskiego-galeria-4-b7841e2e'], ['5f/kaczorowskiego-galeria-5-5f938e8f'],
  ['bc/kaczorowskiego-galeria-6-bcda392d'], ['54/kaczorowskiego-galeria-7-54cda98c'], ['fb/kaczorowskiego-galeria-8-fb47fcb2']
];
const ORDER = [8, 5, 3, 0, 1, 2, 4, 6, 7];
const lbItems = GAL.map((_, i) => `${IMG}/images/kaczorowskiego-1/galeria/2026-ga/kaczorowskiego-galeria-${i}.jpg`)
  .concat([`${IMG}/templates/yootheme/cache/19/Kaczorowskiego_1-5-1941776e.jpeg`, `${IMG}/templates/yootheme/cache/09/Kaczorowskiego_-_garaz_poziom_-1-09670184.png`, `${IMG}/templates/yootheme/cache/d9/Kaczorowskiego%20-%20garaz%20poziom%20-2-d9dcc427.png`]);
function buildGallery(){
  $('#gallery').innerHTML = ORDER.map((gi, i) => `<button class="g${i}" data-lbi="${gi}" aria-label="Wizualizacja ${i + 1}"><img loading="lazy" src="${IMG}/templates/yootheme/cache/${GAL[gi][0]}.jpeg" alt="Wizualizacja osiedla ${i + 1}"></button>`).join('');
}
let lbI = 0, lbSet = [];
function openLightbox(i, set){ lbSet = set || [...ORDER, 9]; lbI = i; showLb(); $('#lb').classList.add('on'); }
function showLb(){ $('#lbImg').src = lbItems[lbI]; const k = lbSet.indexOf(lbI); $('#lbCnt').textContent = k >= 0 ? `${k + 1} / ${lbSet.length}` : ''; }
function stepLb(d){ let k = lbSet.indexOf(lbI); if (k < 0) k = 0; lbI = lbSet[(k + d + lbSet.length) % lbSet.length]; showLb(); }
function closeLightbox(){ $('#lb').classList.remove('on'); }
$('#gallery').addEventListener('click', e => { const b = e.target.closest('[data-lbi]'); if (b) openLightbox(+b.dataset.lbi); });
$('#garaz').addEventListener('click', e => { const b = e.target.closest('[data-lb]'); if (b) openLightbox(b.dataset.lb === 'g1' ? 10 : 11, [10, 11]); });
$('#lb').addEventListener('click', e => { if (e.target.closest('[data-lbx]') || e.target.id === 'lb') closeLightbox(); if (e.target.closest('[data-lbp]')) stepLb(-1); if (e.target.closest('[data-lbn]')) stepLb(1); });

/* ---------- contact ---------- */
function buildContact(){
  $('#cUnit').innerHTML += U.filter(u => u.s !== 'S').map(u => `<option value="${u.n}">M-${u.n} · ${fmtA(u.a)} · ${roomsTxt(u.r)} · piętro ${u.f} · ${fmtP(u.p)}</option>`).join('');
}
$('#cform').addEventListener('submit', e => {
  e.preventDefault(); const f = e.target;
  if (!f.name.value.trim() || !/\S+@\S+\.\S+/.test(f.email.value) || !f.querySelector('.consent input').checked) { toast('Uzupełnij imię, e-mail i zaznacz zgodę'); return; }
  const un = f.unit.value; const u = un && byN.get(+un);
  const subj = u ? `Zapytanie: Kaczorowskiego 1, mieszkanie M-${u.n}` : 'Zapytanie: Kaczorowskiego 1, budynek 1';
  const body = `${f.msg.value}\n\n${u ? `Mieszkanie: M-${u.n}, ${fmtA(u.a)}, ${roomsTxt(u.r)}, piętro ${u.f}, klatka ${u.k}\n` : ''}Imię i nazwisko: ${f.name.value}\nTelefon: ${f.tel.value}\nE-mail: ${f.email.value}`;
  location.href = `mailto:biuro@jaz-bud.pl?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
});

/* ---------- misc ---------- */
let toastT;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400); }
$('#favBtn').addEventListener('click', () => { if (!favs.size) { toast('Dodaj mieszkania do ulubionych sercem ♥'); return; } state.f.fav = true; changed(); $('#mieszkania').scrollIntoView({behavior:'smooth'}); });
$('#burger').addEventListener('click', () => $('#nav').classList.toggle('open'));
$('#nav').addEventListener('click', e => { if (e.target.closest('a')) $('#nav').classList.remove('open'); });

function updateCta(){ const vis = id => { const r = $(id).getBoundingClientRect(); return r.top < innerHeight * 0.6 && r.bottom > innerHeight * 0.4; }; const hide = $('#viewer').classList.contains('panel-open') || $('#modal').classList.contains('on') || vis('#kontakt') || (innerWidth < 820 && vis('#viewer')); $('#ctaFloat').classList.toggle('hide', hide); }
addEventListener('scroll', updateCta, {passive:true});
new MutationObserver(updateCta).observe($('#viewer'), {attributes:true, attributeFilter:['class']});
new MutationObserver(updateCta).observe($('#modal'), {attributes:true, attributeFilter:['class']});

/* ---------- public API for the 3D module ---------- */
window.APP = { U, byN, match, state, hover: (n, x, y) => { hl(n); if (n == null) hideTip(); else showTip(byN.get(n), x, y); }, open: openUnit, onChange: fn => listeners.push(fn), compass: updateCompass, floorDone: renderFloors };

/* ---------- init ---------- */
$$('[data-filters]').forEach(bindFilters);
renderKpis(); buildEstate(); buildGallery(); buildContact();
changed(); updateFavUI(); renderFloors();
requestAnimationFrame(layoutEstate);
if (/^#M\d+$/.test(location.hash)) setTimeout(() => openUnit(+location.hash.slice(2)), 200);
})();
