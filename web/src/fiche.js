// La fiche d'un commerce, au clic : ce qui lui manque (ce que l'équipe a vu sur son site), ses contacts, le mail préparé
// (qu'on peut corriger, valider ou refuser : rien ne part sans toi) et sa fiche Google Maps.
import { badgeSprite } from './sprites.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const host = (url) => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; } };
const STATE = {
  trouve: 'Repéré, pas encore lu', lecture: 'En lecture…', retenu: 'Client potentiel', ecarte: 'Écarté', ecriture: 'Mail en cours…',
  pret: 'Mail prêt · en attente de ta validation', valide: 'Validé', refuse: 'Refusé', saute: 'Pas lu : l’objectif de mails était atteint',
};

const TYPES = {
  restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar', pub: 'Bar', fast_food: 'Restauration rapide', bakery: 'Boulangerie', hairdresser: 'Coiffeur',
  beauty: 'Institut de beauté', clothes: 'Vêtements', clothing_store: 'Vêtements', florist: 'Fleuriste', optician: 'Opticien', pharmacy: 'Pharmacie',
  fitness_centre: 'Salle de sport', sports_centre: 'Centre sportif', lodging: 'Hôtel', hotel: 'Hôtel', grocery: 'Épicerie', supermarket: 'Supermarché',
  shop: 'Boutique', books: 'Librairie', jewelry: 'Bijouterie', shoes: 'Chaussures', dentist: 'Dentiste', doctors: 'Médecin', veterinary: 'Vétérinaire',
  car_repair: 'Garage', ice_cream: 'Glacier', butcher: 'Boucherie', wine: 'Caviste', alcohol_shop: 'Caviste', cinema: 'Cinéma', theatre: 'Théâtre',
};

/** Ce qui manque au commerce (et ce qu'il a déjà), d'après ce que le lecteur a relevé sur son site. */
export function bilan(q) {
  const s = q.signals ?? {};
  const out = [];
  const site = q.data?.website;
  if (!site) out.push([false, 'Pas de site internet']);
  else if (s.site === false) out.push([false, 'Site illisible ou en panne']);
  if (s.site) {
    out.push(s.reservation_en_ligne ? [true, `Réservation en ligne (${s.reservation_en_ligne})`] : [false, 'Pas de réservation en ligne']);
    out.push(s.discussion ? [true, `Quelqu'un répond sur le site (${s.discussion})`] : [false, 'Personne pour répondre sur le site']);
    out.push(s.whatsapp ? [true, 'WhatsApp'] : [false, 'Pas de WhatsApp']);
    if (s.mobile === false) out.push([false, 'Site pas adapté au téléphone']);
    if (s.https === false) out.push([false, 'Site non sécurisé (http)']);
    if (s.annee && s.annee < 2023) out.push([false, `Site pas mis à jour depuis ${s.annee}`]);
    if (s.instagram) out.push([true, `Instagram @${s.instagram}`]);
  }
  return out.sort((a, b) => Number(a[0]) - Number(b[0]));
}

function icon(state) {
  const b = badgeSprite(state);
  const c = document.createElement('canvas');
  c.width = b.c.width * 3; c.height = b.c.height * 3;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(b.c, 0, 0, c.width, c.height);
  return c;
}

export function createFiche(root, { getRunId, onClose }) {
  let cur = null;
  root.className = 'fiche';
  root.hidden = true;
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !cur) return;
    const act = b.dataset.act;
    if (act === 'close') return close();
    if (act === 'valide' || act === 'refuse') {
      const run = getRunId();
      const objet = root.querySelector('.f-obj')?.value, mail = root.querySelector('.f-body')?.value;
      b.disabled = true;
      try {
        const r = await fetch(`/api/runs/${run}/places/${encodeURIComponent(cur.id)}/decision`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: act, objet, mail }),
        });
        if (r.ok) { cur.state = act; cur.objet = objet; cur.mail = mail; render(); }
      } finally { b.disabled = false; }
    }
  });

  async function googleLink(q) {
    const name = `${q.name} ${q.data?.address && q.data.address !== 'Lyon' ? q.data.address : ''}`.trim();
    let url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}`)}`;
    const run = getRunId();
    if (run) {
      try {
        const r = await fetch(`/api/runs/${run}/places/${encodeURIComponent(q.id)}/google`).then((x) => x.json());
        if (r.gid) url += `&query_place_id=${encodeURIComponent(r.gid)}`;
      } catch {}
    }
    return url;
  }

  function render() {
    const q = cur;
    const d = q.data ?? {};
    const lu = q.read;
    const items = lu ? bilan(q) : [];
    const manque = items.filter(([ok]) => !ok), deja = items.filter(([ok]) => ok);
    const phones = [...new Set([...(q.telephones ?? []), d.phone].filter(Boolean))];
    const email = q.email ?? q.to ?? null;
    root.innerHTML = `
      <div class="f-head">
        <span class="f-ic"></span>
        <div class="f-title"><h2>${esc(q.name)}</h2><p>${esc([d.type, d.address].filter(Boolean).join(' · '))}</p></div>
        <button type="button" class="f-x" data-act="close" aria-label="Fermer">×</button>
      </div>
      <div class="f-state" data-s="${esc(q.state)}"><span>${esc(STATE[q.state] ?? '')}</span>${q.score != null ? `<b>${q.score}<i>/100</i></b>` : ''}</div>
      ${lu ? `<section><h3>Ce qui lui manque</h3>
        ${manque.length ? `<ul class="f-list">${manque.map(([, t]) => `<li class="no"><i></i>${esc(t)}</li>`).join('')}</ul>` : '<p class="f-empty">Rien de flagrant : il a déjà tout.</p>'}
        ${deja.length ? `<h4>Ce qu'il a déjà</h4><ul class="f-list">${deja.map(([, t]) => `<li class="ok"><i></i>${esc(t)}</li>`).join('')}</ul>` : ''}
      </section>` : `<section><p class="f-empty">${q.state === 'lecture' ? 'Un lecteur est sur son site en ce moment…' : 'Pas encore lu : un lecteur va passer.'}</p></section>`}
      <section><h3>Contacts</h3><dl class="f-kv">
        ${d.website ? `<dt>Site</dt><dd><a href="${esc(d.website)}" target="_blank" rel="noopener">${esc(host(d.website))}</a></dd>` : ''}
        <dt>E-mail</dt><dd>${email ? `${esc(email)}${q.email_source ? `<small>trouvé sur ${esc(q.email_source)}</small>` : ''}` : lu ? '<em>aucun affiché</em>' : '<em>pas encore lu</em>'}</dd>
        <dt>Téléphone</dt><dd>${phones.length ? phones.map(esc).join('<br>') : '<em>aucun</em>'}</dd>
        ${d.horaires ? `<dt>Horaires</dt><dd>${esc(d.horaires)}</dd>` : ''}
      </dl>
      <div class="f-links"><a class="f-btn" data-g href="#" target="_blank" rel="noopener">Voir sur Google Maps</a>${d.maps_uri ? `<a class="f-btn ghost" href="${esc(d.maps_uri)}" target="_blank" rel="noopener">OpenStreetMap</a>` : ''}</div></section>
      ${q.mail ? `<section class="f-mail"><h3>Le mail préparé</h3>
        <label>Objet</label><input class="f-obj" value="${esc(q.objet ?? '')}">
        <label>Message</label><textarea class="f-body" rows="9">${esc(q.mail)}</textarea>
        <p class="f-to">À : ${esc(q.to ?? email ?? '')}</p>
        ${q.state === 'pret' ? '<div class="f-dec"><button type="button" class="f-btn" data-act="valide">Valider</button><button type="button" class="f-btn ghost" data-act="refuse">Refuser</button></div><p class="f-note">Rien ne part sans toi.</p>' : ''}
      </section>` : ''}
      ${q.journal?.length ? `<section><h3>Ce que le lecteur a fait</h3><ol class="f-log">${q.journal.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></section>` : ''}`;
    root.querySelector('.f-ic').append(icon(q.state));
    const g = root.querySelector('[data-g]');
    googleLink(q).then((u) => { if (g) g.href = u; });
  }

  function open(q) { cur = q; root.hidden = false; render(); root.classList.remove('in'); void root.offsetWidth; root.classList.add('in'); }

  /** Un commerce de la carte que l'équipe n'a pas (encore) vu : son nom, Google Maps, et un lecteur à envoyer. */
  function openPoi(poi, { ville, onSend }) {
    cur = { id: null, poi };
    root.hidden = false;
    const type = TYPES[poi.sub] ?? TYPES[poi.cls] ?? poi.sub ?? poi.cls ?? 'commerce';
    const gm = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${poi.name} ${ville ?? ''}`.trim())}`;
    root.innerHTML = `
      <div class="f-head"><div class="f-title"><h2>${esc(poi.name)}</h2><p>${esc(type)}${ville ? ` · ${esc(ville)}` : ''}</p></div>
        <button type="button" class="f-x" data-act="close" aria-label="Fermer">×</button></div>
      <div class="f-state"><span>Pas encore vu par l'équipe</span></div>
      <section><p class="f-empty">Envoie un lecteur : il trouve son site, le lit, relève ce qui lui manque, ses contacts, et prépare un mail s'il est intéressant.</p>
        <div class="f-links"><button type="button" class="f-btn" data-send>Envoyer un lecteur</button><a class="f-btn ghost" href="${esc(gm)}" target="_blank" rel="noopener">Voir sur Google Maps</a></div>
        <p class="f-note" data-msg hidden></p></section>`;
    root.querySelector('[data-send]').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const msg = root.querySelector('[data-msg]');
      try { await onSend(poi); msg.textContent = 'Un lecteur est en route.'; } catch (err) { msg.textContent = err.message; }
      msg.hidden = false;
    });
    root.classList.remove('in'); void root.offsetWidth; root.classList.add('in');
  }
  function close() { cur = null; root.hidden = true; onClose?.(); }
  function refresh(q) { if (cur && q && cur.id === q.id && !root.contains(document.activeElement)) render(); }
  return { open, openPoi, close, refresh, get current() { return cur; } };
}
