// Le QG des agents : on choisit une ville sur la carte de France (toutes les villes apparaissent quand on zoome), le métier,
// combien d'établissements, ce qu'on veut récupérer, son offre et ses consignes de mail ; la caméra plonge sur la ville
// en pixel art et l'équipe s'y met, en direct. On clique un commerce pour voir ce qui lui manque, ses contacts et le mail.
//   /qg.html                 la carte de mission (lancer une nouvelle mission)
//   /qg.html?run=<id>        rejouer une mission enregistrée
//   ?tod=jour|soir|nuit      la lumière (touche N) · ?vitesse=1.5 · ?libre (caméra à la main)
import { loadCity, TODS, palette } from './ville.js';
import { drawCity, drawWorld, spriteScale, toWorld } from './rendu.js';
import { Monde } from './monde.js';
import { Realisateur } from './realisateur.js';
import { createHud } from './hud.js';
import { createFiche } from './fiche.js';
import { createCarte } from './carte.js';
import { createLancement } from './lancement.js';
import { createCinema, survey } from './cinema.js';

const $ = (id) => document.getElementById(id);
const canvas = $('world');
const g = canvas.getContext('2d');
const params = new URLSearchParams(location.search);

const cam = { x: 0, y: 0, z: 2 };
let city = null, world = null, director = null, hud = null, fiche = null;
let tod = params.get('tod') ?? 'soir';
let speed = Number(params.get('vitesse')) || 1;
let W = 0, H = 0, DPR = 1;
let mode = 'carte'; // carte | plongee | ville
let fade = 0; // le fondu de la carte vers la ville
let runId = null, liveRun = null, events = [], buffer = [];
let config = null;
let lanc = null;
const CINE = params.has('cinema');
let cine = null, pre = null; // la version cinéma, et son vol d'ouverture au-dessus de la France

const carte = createCarte({ onPick: (c) => lanc?.setVille(c), getRayon: () => lanc?.state.rayon ?? 2000 });

function resize() {
  DPR = window.devicePixelRatio || 1;
  W = Math.round(canvas.clientWidth * DPR);
  H = Math.round(canvas.clientHeight * DPR);
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
}

function setMode(m) {
  mode = m;
  document.body.dataset.mode = m;
  $('hud').hidden = m !== 'ville';
  $('launch').hidden = m !== 'carte';
  $('carte-title').hidden = m !== 'carte';
  $('btn-carte').hidden = m !== 'ville';
  if (m !== 'ville') fiche?.close();
}

/* ------------------------------------------------------------------ une image */
function frame(dt) {
  if (pre) {
    // l'ouverture du film : la France, puis on plonge sur la ville
    pre.t += dt;
    const u = Math.min(1, pre.t / pre.dur);
    const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    Object.assign(carte.cam, { x: pre.from.x + (pre.to.x - pre.from.x) * Math.min(1, e * 1.25), y: pre.from.y + (pre.to.y - pre.from.y) * Math.min(1, e * 1.25), zoom: pre.from.zoom + (pre.to.zoom - pre.from.zoom) * e });
    carte.draw(g, W, H, DPR, performance.now());
    cine?.title(u > 0.04 && u < 0.78);
    if (u >= 1) { pre = null; cine?.title(false); enterCity(); }
    return;
  }
  if (world && dt > 0) {
    if (cine) { world.update(dt * cine.speedAt(world.time)); }
    else {
      world.update(dt * speed);
      if (mode === 'ville') director?.update(dt * speed, W, H);
    }
  }
  if (cine && mode === 'ville') cine.update(W, H, DPR);
  if (mode === 'carte' || mode === 'plongee') carte.draw(g, W, H, DPR);
  if (mode === 'ville' && city) {
    g.fillStyle = palette(tod).bg;
    g.fillRect(0, 0, W, H);
    drawCity(g, city, cam, W, H, tod, window.__CAPTURE ? Infinity : 6);
    if (world) {
      const S = spriteScale(cam.z);
      const ib = hud?.inboxPoint();
      drawWorld(g, world, cam, W, H, tod, { S, inbox: ib ? [ib[0] * DPR, ib[1] * DPR] : null, beacons: cine && world.time > (cine.shots.at(-1)?.from ?? 1e9) });
      hud?.update(cam, W, H, S, DPR);
    }
    // la carte s'efface sur la ville
    if (fade > 0) {
      g.globalAlpha = fade;
      carte.draw(g, W, H, DPR);
      g.globalAlpha = 1;
      fade = Math.max(0, fade - Math.max(dt, 1 / 30) * 1.8);
    }
  }
}

let last = 0;
function loop(ts) {
  const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
  last = ts;
  resize();
  frame(dt);
  requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------ la ville d'une mission */
async function buildCity(centre, rayon) {
  $('loading').hidden = false;
  $('loading').textContent = 'Construction de la ville…';
  const t0 = performance.now();
  city = await loadCity({ centre, radius: Math.min(4300, Math.max(1600, rayon + 300)), onProgress: (k) => { $('loading').textContent = `Construction de la ville… ${Math.round(k * 100)} %`; } });
  world = new Monde(city);
  director = new Realisateur(world, cam);
  hud = createHud($('hud'), world);
  fiche = createFiche($('fiche'), { getRunId: () => runId });
  world.on((type, d) => { if (type === 'place') fiche.refresh(d); if (type === 'mail' || type === 'scored') fiche.refresh(d.q); });
  console.log(`ville : ${city.blist.length} immeubles, ${city.roads.length} rues, ${city.trees.length} arbres, graphe ${world.graph.nodes} nœuds, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  $('loading').hidden = true;
  return world;
}

/** La carte se change en ville : même centre, même échelle, puis le réalisateur plonge sur le QG. */
function enterCity() {
  const [lat, lon] = carte.centre();
  const [x, y] = city.toXY(lat, lon);
  Object.assign(cam, { x, y, z: carte.pxPerMeter(W, DPR) });
  director.smoothUntil = world.time + 4;
  fade = 1;
  setMode('ville');
}

/** La version cinéma : la mission rejouée comme un film (titres, chapitres, ralentis, compteurs). */
async function cinema(id) {
  document.body.classList.add('cinema');
  const st = await fetch(`/api/state${id ? `?run=${id}` : ''}`).then((r) => r.json());
  const run = st.run;
  if (!run) { document.body.classList.remove('cinema'); setMode('carte'); return; } // pas encore de mission à filmer
  runId = run.id;
  events = await fetch(`/api/runs/${run.id}/events`).then((r) => r.json());
  const start = events.find((e) => e.agent === 'chef' && e.type === 'start');
  const sd = typeof start?.data === 'string' ? JSON.parse(start.data) : start?.data;
  const centre = run.lat != null ? { lat: run.lat, lon: run.lon } : sd?.centre ?? { lat: 45.764, lon: 4.8357 };
  setMode('plongee');
  await buildCity(centre, run.rayon ?? sd?.rayon ?? 2200);
  const pushAll = () => { for (const e of events) world.push({ ...e, data: typeof e.data === 'string' ? JSON.parse(e.data) : e.data }); };
  const marks = survey(world, pushAll);
  const ends = events.filter((e) => e.agent === 'chef' && (e.type === 'start' || e.type === 'end')).map((e) => e.t);
  cine = createCinema($('cine'), { world, cam, marks, metier: sd?.metier ?? '', ville: sd?.ville ?? run.ville ?? '', duree: ends.length === 2 ? (ends[1] - ends[0]) / 1000 : null, setTod: (t2) => { tod = t2; } });
  window.__qg.marks = marks;
  carte.select({ name: sd?.ville ?? '', lat: centre.lat, lon: centre.lon });
  const [qx, qy] = [world.qg.x, world.qg.door[1]];
  const [qlat, qlon] = city.toLatLon(qx, qy);
  const to = { ...carte.cam };
  const [tx, ty] = [(qlon + 180) / 360, (1 - Math.log(Math.tan(qlat * Math.PI / 180) + 1 / Math.cos(qlat * Math.PI / 180)) / Math.PI) / 2];
  pre = { t: 0, dur: Number(params.get('ouverture') ?? 4.2), from: { x: 0.5068, y: 0.3560, zoom: 6.1 }, to: { x: tx, y: ty, zoom: 13.4 } };
  Object.assign(carte.cam, pre.from);
  void to;
}

/** Rejoue une mission : tous ses gestes partent dans les files des agents, qui les jouent à leur rythme. */
function play() {
  if (!events.length || !world) return;
  world.reset();
  for (const e of events) world.push({ ...e, data: typeof e.data === 'string' ? JSON.parse(e.data) : e.data });
}

async function replay(id) {
  const st = await fetch(`/api/state${id ? `?run=${id}` : ''}`).then((r) => r.json());
  const run = st.run;
  if (!run) return;
  runId = run.id;
  liveRun = null;
  events = await fetch(`/api/runs/${run.id}/events`).then((r) => r.json());
  const start = events.find((e) => e.agent === 'chef' && e.type === 'start');
  const sd = typeof start?.data === 'string' ? JSON.parse(start.data) : start?.data;
  const centre = run.lat != null ? { lat: run.lat, lon: run.lon } : sd?.centre ?? { lat: 45.764, lon: 4.8357 };
  const rayon = run.rayon ?? sd?.rayon ?? 2200;
  setMode('plongee');
  carte.select({ name: run.ville ?? sd?.ville, lat: centre.lat, lon: centre.lon });
  const built = buildCity(centre, rayon);
  if (!window.__CAPTURE) await carte.flyTo(centre.lat, centre.lon, 14.4, 2400);
  else { carte.cam.x = carte.selected.x; carte.cam.y = carte.selected.y; carte.cam.zoom = 14.4; }
  await built;
  enterCity();
  if (window.__CAPTURE) play(); else setTimeout(play, 300);
}

/** Lance une vraie mission : l'équipe part, et ses gestes arrivent en direct. */
async function launch(p) {
  const res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? 'La mission n’a pas pu partir.');
  runId = body.runId;
  buffer = [];
  events = [];
  pushed.clear();
  follow(runId);
  setMode('plongee');
  const built = buildCity(p.centre, p.rayon_m);
  await carte.flyTo(p.centre.lat, p.centre.lon, 14.4, 2600);
  await built;
  world.reset();
  enterCity();
  for (const e of buffer.splice(0)) world.push(e);
}

// Tous les gestes reçus en direct, rangés par mission : une mission rapide peut commencer avant que la page sache laquelle suivre.
const heard = new Map();
const pushed = new Set();
function deliver(e) {
  if (e.seq != null) { if (pushed.has(e.seq)) return; pushed.add(e.seq); }
  events.push(e);
  if (world && mode === 'ville') world.push(e); else buffer.push(e);
}
function connect() {
  const es = new EventSource('/api/stream');
  es.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (!heard.has(e.run_id)) heard.set(e.run_id, []);
    heard.get(e.run_id).push(e);
    if (liveRun && e.run_id === liveRun) deliver(e);
  };
}
/** Suivre une mission en direct : ses gestes déjà passés d'abord (reçus ou relus sur le serveur), puis la suite. */
async function follow(id) {
  liveRun = id;
  const past = await fetch(`/api/runs/${id}/events`).then((r) => r.json()).catch(() => []);
  const all = [...past, ...(heard.get(id) ?? [])].map((e) => ({ ...e, data: typeof e.data === 'string' ? JSON.parse(e.data) : e.data }));
  all.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  for (const e of all) deliver(e);
}

/* ------------------------------------------------------------------ cliquer un commerce */
function pick(clientX, clientY) {
  if (!world) return null;
  const sx = clientX * DPR, sy = clientY * DPR;
  const S = spriteScale(cam.z);
  let best = null, bestD = Infinity;
  for (const q of world.places.values()) {
    if (q.state === 'cache') continue;
    const px = (q.x - cam.x) * cam.z + W / 2, py = (q.y - cam.y) * cam.z + H / 2;
    for (const [ox, oy, r] of [[0, -22 * S, 11 * S], [0, -6 * S, 8 * S]]) {
      const d = Math.hypot(sx - px - ox, sy - py - oy);
      if (d < r && d < bestD) { best = q; bestD = d; }
    }
  }
  if (best) return best;
  const [wx, wy] = toWorld(cam, W, H, sx, sy);
  for (let k = 0; k <= 14; k += 1) {
    const b = city.buildingAt(wx, wy + k);
    if (!b) continue;
    for (const q of world.places.values()) if (q.bid === b.id && q.state !== 'cache') return q;
  }
  return null;
}
/** Un commerce de la carte (calque des points d'intérêt) sous le clic : le plus proche à quelques mètres. */
function pickPoi(clientX, clientY) {
  if (!city?.pois?.length || cam.z < 1.2) return null;
  const [wx, wy] = toWorld(cam, W, H, clientX * DPR, clientY * DPR);
  let best = null, bd = 9 + 14 / cam.z;
  for (const p of city.pois) {
    // le pied de l'immeuble est plus bas que son toit à l'écran : on accepte un clic un peu au-dessus
    const d = Math.hypot(p.x - wx, (p.y - wy) * (p.y > wy ? 0.55 : 1));
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
async function sendReader(poi) {
  if (!runId) throw new Error('Lance ou rejoue une mission d’abord.');
  const busy = (id) => { const a = world.actors.get(id); return a.busy || a.lane.length; };
  const agent = ['lecteur-1', 'lecteur-2', 'lecteur-3'].find((id) => !busy(id)) ?? 'lecteur-1';
  if (liveRun !== runId) { for (const e of events) if (e.seq != null) pushed.add(e.seq); liveRun = runId; } // la suite arrive par le flux en direct
  const r = await fetch(`/api/runs/${runId}/visite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: poi.name, lat: poi.lat, lon: poi.lon, type: poi.sub || poi.cls, agent }) });
  if (!r.ok) throw new Error((await r.json()).error ?? 'Le lecteur n’a pas pu partir.');
  world.teamSent = true;
}

/* ------------------------------------------------------------------ la souris */
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, cx: cam.x, cy: cam.y, moved: false }; canvas.classList.add('drag'); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (mode === 'carte') canvas.classList.toggle('can-pick', Boolean(carte.setHover(e.clientX * DPR, e.clientY * DPR)));
    else if (mode === 'ville') {
      const q = pick(e.clientX, e.clientY);
      const poi = q ? null : pickPoi(e.clientX, e.clientY);
      canvas.classList.toggle('can-pick', Boolean(q || poi));
      const tip = $('tip');
      if (poi) { tip.textContent = poi.name; tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`; tip.hidden = false; }
      else tip.hidden = true;
    }
    return;
  }
  if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
  if (!drag.moved) return;
  if (mode === 'carte') { carte.pan((e.clientX - drag.lx) * DPR, (e.clientY - drag.ly) * DPR, W, DPR); drag.lx = e.clientX; drag.ly = e.clientY; return; }
  if (mode !== 'ville') return;
  cam.x = drag.cx - ((e.clientX - drag.x) * DPR) / cam.z;
  cam.y = drag.cy - ((e.clientY - drag.y) * DPR) / cam.z;
  if (director) director.manualUntil = world.time + (params.has('libre') ? 1e9 : 6);
});
canvas.addEventListener('pointerup', (e) => {
  const click = drag && !drag.moved;
  drag = null;
  canvas.classList.remove('drag');
  if (!click) return;
  if (mode === 'carte') {
    const l = carte.pickAt(e.clientX * DPR, e.clientY * DPR);
    if (l) { const c = carte.choose(l); carte.flyTo(c.lat, c.lon, Math.max(carte.cam.zoom, 11.6), 1200); }
    return;
  }
  if (mode !== 'ville') return;
  const q = pick(e.clientX, e.clientY);
  if (q) return fiche.open(q);
  const poi = pickPoi(e.clientX, e.clientY);
  if (poi) {
    const known = [...world.places.values()].find((x) => x.name === poi.name && Math.hypot(x.x - poi.x, x.y - poi.y) < 60);
    if (known && known.state !== 'cache') return fiche.open(known);
    return fiche.openPoi(poi, { ville: world.mission?.ville, onSend: sendReader });
  }
  fiche?.close();
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (mode === 'carte') { carte.zoomAt(e.clientX * DPR, e.clientY * DPR, -e.deltaY * 0.0022, W, H, DPR); return; }
  if (mode !== 'ville') return;
  const [wx, wy] = toWorld(cam, W, H, e.clientX * DPR, e.clientY * DPR);
  cam.z = Math.max(0.12, Math.min(16, cam.z * Math.exp(-e.deltaY * 0.0015)));
  const [nx, ny] = toWorld(cam, W, H, e.clientX * DPR, e.clientY * DPR);
  cam.x += wx - nx;
  cam.y += wy - ny;
  if (director) director.manualUntil = world.time + (params.has('libre') ? 1e9 : 6);
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  if (e.key === 'Escape') fiche?.close();
  if (e.key === 'n' || e.key === 'N') tod = TODS[(TODS.indexOf(tod) + 1) % TODS.length];
  if ((e.key === 'r' || e.key === 'R') && mode === 'ville') play();
  if ((e.key === 'c' || e.key === 'C') && director) director.manualUntil = 0;
});
window.addEventListener('resize', resize);
$('btn-carte').addEventListener('click', () => setMode('carte'));

/** La plus grosse des dernières missions (les petits essais ne valent pas un rejeu). */
async function biggestRun() {
  const rs = await fetch('/api/runs').then((r) => r.json()).catch(() => []);
  return rs.slice(0, 12).sort((a, b) => (b.n ?? 0) - (a.n ?? 0))[0]?.id ?? null;
}

/* ------------------------------------------------------------------ le départ */
async function boot() {
  resize();
  const st = await fetch('/api/state').then((r) => r.json()).catch(() => ({}));
  config = st.config ?? {};
  lanc = createLancement($('launch'), {
    config,
    onLaunch: launch,
    onSearch: (v) => { const c = carte.select({ name: v.nom, lat: v.lat, lon: v.lon, pays: v.cc, cls: 'city' }); lanc.setVille(c); carte.flyTo(v.lat, v.lon, 11.6, 1600); },
    onReplay: async () => replay(await biggestRun()),
  });
  connect();
  const asked = params.get('run');
  setMode(asked || CINE ? 'plongee' : 'carte');
  if (!window.__CAPTURE) requestAnimationFrame(loop);
  window.__qg.ready = true;
  if (CINE) await cinema(params.get('cinema') || asked || (await biggestRun()));
  else if (asked) await replay(asked);
  window.__qg.loaded = true;
}

window.__qg = {
  ready: false,
  loaded: false,
  cam,
  carte,
  get city() { return city; },
  get world() { return world; },
  get director() { return director; },
  get mode() { return mode; },
  get cine() { return cine; },
  get pre() { return pre; },
  setCam(x, y, z) { Object.assign(cam, { x, y, z }); if (director) director.manualUntil = 1e12; },
  setTod(t) { tod = t; },
  play,
  replay,
  launch,
  /** Avance de dt secondes (pour une capture image par image). */
  step(dt) { resize(); frame(dt); },
  render() { resize(); frame(0); },
};
boot();
