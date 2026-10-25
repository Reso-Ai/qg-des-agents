// Le panneau de lancement : la ville (choisie sur la carte ou cherchée), le métier, la zone, combien d'établissements,
// ce qu'on veut récupérer (e-mails, téléphones), combien de mails préparer, ton offre et tes consignes pour le mail.
// L'équipe écrit chaque mail avec ton offre et ce qu'elle a vu chez le commerce. Rien ne part sans ta validation.

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const METIERS = [
  ['Salles de sport', 'salle de sport'], ['Yoga & pilates', 'yoga'], ['Restaurants', 'restaurant'], ['Cafés', 'café'], ['Bars', 'bar'],
  ['Coiffeurs', 'coiffeur'], ['Barbiers', 'barbier'], ['Instituts de beauté', 'institut de beauté'], ['Boulangeries', 'boulangerie'],
  ['Fleuristes', 'fleuriste'], ['Opticiens', 'opticien'], ['Garages', 'garage'], ['Auto-écoles', 'auto-école'], ['Dentistes', 'dentiste'],
  ['Kinés', 'kiné'], ['Agences immobilières', 'agence immobilière'], ['Hôtels', 'hôtel'], ['Vétérinaires', 'vétérinaire'], ['Thérapeutes', 'thérapeute'],
];
const PAYS = { FR: 'France', BE: 'Belgique', CH: 'Suisse', RE: 'La Réunion' };

export function createLancement(root, { config, onLaunch, onSearch, onReplay }) {
  const cfg = config ?? {};
  const st = {
    ville: null,
    metier: cfg.recherche?.metier ?? 'salle de sport',
    rayon: cfg.recherche?.rayon_m ?? 2000,
    nombre: cfg.recherche?.nombre ?? 20,
    objectif: cfg.recherche?.objectif_mails ?? 0,
    veut: { emails: cfg.recherche?.veut?.emails !== false, telephones: cfg.recherche?.veut?.telephones !== false },
    offre: { ce_que_je_vends: '', pour_qui: '', signature: '', site: '', ...(cfg.offre ?? {}) },
    consignes: cfg.consignes || 'Court (90 mots au plus), vouvoiement, une seule observation concrète, une question facile à la fin.',
  };
  let villes = [];
  fetch('/carte/villes.json').then((r) => r.json()).then((d) => { villes = d.villes.map(([nom, lat, lon, pop, cc]) => ({ nom, lat, lon, pop, cc, n: norm(nom) })); }).catch(() => {});

  root.className = 'launch';
  root.innerHTML = `
    <div class="l-head"><span class="tag"><i></i>Nouvelle mission</span><h2 id="l-ville">Choisis une ville</h2><p id="l-ville-sub">Clique une ville sur la carte, ou cherche-la. Zoome : tous les villages apparaissent.</p>
      <div class="l-search"><input id="l-q" placeholder="Chercher une ville…" autocomplete="off"><ul id="l-sug" hidden></ul></div></div>
    <section><h3>Qui chercher</h3><div class="chips" id="l-metiers"></div><input id="l-autre" class="l-input" placeholder="Autre métier (ex. fleuriste, notaire…)"></section>
    <section class="l-row"><div><h3>Zone</h3><div class="chips" id="l-rayon">${[1000, 2000, 3000, 4000].map((r) => `<button type="button" data-v="${r}">${r / 1000} km</button>`).join('')}</div></div></section>
    <section><h3>Combien d'établissements <b id="l-n"></b></h3><input type="range" id="l-nombre" min="5" max="60" step="5"><p class="l-hint">S'il n'y en a pas assez dans la zone, l'éclaireur l'élargit (jusqu'à 6 km) et te dit combien il en a trouvé.</p></section>
    <section><h3>Ce que tu veux récupérer</h3><div class="chips toggles" id="l-veut"><button type="button" data-k="emails">E-mails</button><button type="button" data-k="telephones">Téléphones</button></div></section>
    <section><h3>Mails à préparer <b id="l-o"></b></h3><input type="range" id="l-objectif" min="0" max="30" step="1"><p class="l-hint">L'équipe s'arrête quand elle a assez de clients potentiels.</p></section>
    <details class="l-box" open><summary>Ton offre</summary>
      <label>Ce que tu vends</label><textarea id="l-vend" rows="3"></textarea>
      <label>Pour qui (facultatif)</label><input id="l-pourqui" class="l-input">
      <div class="l-two"><div><label>Signature</label><input id="l-sign" class="l-input"></div><div><label>Ton site</label><input id="l-site" class="l-input"></div></div>
    </details>
    <details class="l-box"><summary>Ton mail</summary>
      <label>Tes consignes au rédacteur (ton, longueur, ce qu'il doit dire)</label><textarea id="l-consignes" rows="3"></textarea>
      <p class="l-hint">Chaque mail mélange ton offre et ce que l'équipe a vu chez le commerce.</p>
    </details>
    <p class="l-recap" id="l-recap"></p>
    <button type="button" class="l-go" id="l-go" disabled>Lancer l'équipe</button>
    <p class="l-note">Rien ne part sans toi : chaque mail attend ta validation.</p>
    <p class="l-err" id="l-err" hidden></p>
    <button type="button" class="l-replay" id="l-replay">Revoir une mission</button>`;
  const $ = (id) => root.querySelector('#' + id);

  // métiers
  const chips = $('l-metiers');
  for (const [label, v] of METIERS) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.v = v; b.textContent = label;
    chips.append(b);
  }
  chips.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { st.metier = b.dataset.v; $('l-autre').value = ''; sync(); } });
  $('l-autre').addEventListener('input', (e) => { const v = e.target.value.trim(); if (v) st.metier = v; sync(); });
  $('l-rayon').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { st.rayon = +b.dataset.v; sync(); } });
  $('l-nombre').addEventListener('input', (e) => { st.nombre = +e.target.value; sync(); });
  $('l-objectif').addEventListener('input', (e) => { st.objectif = +e.target.value; sync(); });
  $('l-veut').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { st.veut[b.dataset.k] = !st.veut[b.dataset.k]; if (!st.veut.emails && !st.veut.telephones) st.veut.emails = true; sync(); } });
  const bind = (id, set) => $(id).addEventListener('input', (e) => { set(e.target.value); sync(); });
  $('l-vend').value = st.offre.ce_que_je_vends; bind('l-vend', (v) => { st.offre.ce_que_je_vends = v; });
  $('l-pourqui').value = st.offre.pour_qui; bind('l-pourqui', (v) => { st.offre.pour_qui = v; });
  $('l-sign').value = st.offre.signature; bind('l-sign', (v) => { st.offre.signature = v; });
  $('l-site').value = st.offre.site; bind('l-site', (v) => { st.offre.site = v; });
  $('l-consignes').value = st.consignes; bind('l-consignes', (v) => { st.consignes = v; });
  $('l-nombre').value = st.nombre;
  $('l-objectif').value = st.objectif;

  // la recherche de ville
  const q = $('l-q'), sug = $('l-sug');
  q.addEventListener('input', () => {
    const t = norm(q.value.trim());
    if (t.length < 2) { sug.hidden = true; return; }
    const res = villes.filter((v) => v.n.startsWith(t)).concat(villes.filter((v) => !v.n.startsWith(t) && v.n.includes(t))).slice(0, 7);
    sug.innerHTML = res.map((v, i) => `<li data-i="${i}"><b>${esc(v.nom)}</b><span>${PAYS[v.cc] ?? v.cc}</span></li>`).join('');
    sug.hidden = !res.length;
    sug.onclick = (e) => { const li = e.target.closest('li'); if (!li) return; const v = res[+li.dataset.i]; sug.hidden = true; q.value = ''; onSearch?.(v); };
  });

  $('l-go').addEventListener('click', async () => {
    if (!st.ville) return;
    const b = $('l-go');
    b.disabled = true; b.textContent = 'Départ…';
    $('l-err').hidden = true;
    try {
      await onLaunch({
        metier: st.metier, ville: st.ville.name, centre: { lat: st.ville.lat, lon: st.ville.lon }, pays: st.ville.pays ?? null,
        rayon_m: st.rayon, nombre: st.nombre, objectif_mails: st.objectif || null, veut: st.veut, offre: st.offre, consignes: st.consignes,
      });
    } catch (e) {
      $('l-err').textContent = e.message;
      $('l-err').hidden = false;
    } finally { b.textContent = "Lancer l'équipe"; sync(); }
  });
  $('l-replay').addEventListener('click', () => onReplay?.());

  function sync() {
    for (const b of chips.children) b.classList.toggle('on', b.dataset.v === st.metier);
    for (const b of $('l-rayon').children) b.classList.toggle('on', +b.dataset.v === st.rayon);
    for (const b of $('l-veut').children) b.classList.toggle('on', st.veut[b.dataset.k]);
    $('l-n').textContent = st.nombre;
    $('l-objectif').max = String(st.nombre);
    if (st.objectif > st.nombre) st.objectif = st.nombre;
    $('l-o').textContent = st.objectif ? st.objectif : 'autant que possible';
    const label = METIERS.find(([, v]) => v === st.metier)?.[0]?.toLowerCase() ?? st.metier;
    $('l-recap').innerHTML = st.ville
      ? `<b>${st.nombre} ${esc(label)}</b> autour de <b>${esc(st.ville.name)}</b> (${st.rayon / 1000} km) · ${[st.veut.emails && 'e-mails', st.veut.telephones && 'téléphones'].filter(Boolean).join(' et ')} · ${st.objectif ? `${st.objectif} mails au plus` : 'un mail par client potentiel'}`
      : 'Choisis d’abord une ville.';
    $('l-go').disabled = !st.ville || !st.metier;
  }
  function setVille(v) {
    st.ville = v;
    $('l-ville').textContent = v ? v.name : 'Choisis une ville';
    $('l-ville-sub').textContent = v ? `${{ city: 'Ville', town: 'Ville', village: 'Village', hamlet: 'Hameau', suburb: 'Quartier' }[v.cls] ?? 'Ville'}${v.pays ? ` · ${PAYS[v.pays] ?? v.pays}` : ''} · ${v.lat.toFixed(3)}, ${v.lon.toFixed(3)}` : 'Clique une ville sur la carte, ou cherche-la.';
    sync();
  }
  sync();
  return { setVille, get state() { return st; }, show() { root.hidden = false; }, hide() { root.hidden = true; } };
}
