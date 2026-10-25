// Le lecteur : ouvre le site de chaque commerce (accueil + pages contact, mentions, réservation),
// relève l'adresse de contact affichée et les signaux utiles (réservation en ligne, discussion, WhatsApp…).

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const MAX_BYTES = 1_500_000;

const BOOKING = [
  ['TheFork', /thefork\.|lafourchette\./i], ['Zenchef', /zenchef/i], ['SevenRooms', /sevenrooms/i],
  ['OpenTable', /opentable\./i], ['Resy', /resy\.com/i], ['Guestonline', /guestonline/i], ['Quandoo', /quandoo/i],
  ['Formitable', /formitable/i], ['Tablebooker', /tablebooker/i], ['Resengo', /resengo/i], ['Bookingshake', /bookingshake/i],
  ['Resamania', /resamania/i], ['Deciplus', /deciplus/i], ['bsport', /bsport\.io/i], ['Mindbody', /mindbody/i],
  ['Glofox', /glofox/i], ['Heitz', /heitzsystem/i], ['Hapik', /hapik/i], ['Planity', /planity\./i], ['Treatwell', /treatwell\./i], ['Calendly', /calendly\.com/i], ['Doctolib', /doctolib\./i],
];
const CHAT = [
  ['Crisp', /crisp\.chat/i], ['Intercom', /intercom(cdn)?\.(io|com)/i], ['Tidio', /tidio(chat)?\./i], ['tawk.to', /tawk\.to/i],
  ['Zendesk', /zdassets|zendesk/i], ['HubSpot', /hs-scripts|hubspot/i], ['Messenger', /customerchat|m\.me\//i],
];
const BUILDERS = [
  ['Wix', /wixstatic|wix\.com|_wixCIDX/i], ['WordPress', /wp-content|wp-includes/i], ['Squarespace', /squarespace/i],
  ['Shopify', /cdn\.shopify|myshopify/i], ['Webflow', /webflow/i], ['Jimdo', /jimdo/i], ['Site Google', /sites\.google/i],
];

const FREEMAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|icloud|me|orange|wanadoo|free|sfr|neuf|laposte|bbox|aol|protonmail|proton)\./i;
const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const EMAIL_JUNK = /\.(png|jpe?g|gif|webp|svg|avif)$|@(sentry|wixpress|example|domain|email|sentry-next)\.|^(noreply|no-reply|nepasrepondre|u0|user|name|nom|votre|your)@|@2x/i;

async function getHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-FR,fr;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
  });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !/html/i.test(type)) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    chunks.push(value);
    if (size > MAX_BYTES) { reader.cancel().catch(() => {}); break; }
  }
  return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: res.url };
}

function visibleText(html) {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&rsquo;|&#8217;/g, '’').replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è').replace(/&agrave;/g, 'à').replace(/&ccedil;/g, 'ç').replace(/&ocirc;/g, 'ô').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function links(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try { out.push({ url: new URL(m[1].trim(), base).href, text: m[2].replace(/<[^>]+>/g, ' ').trim().toLowerCase() }); } catch {}
  }
  return out;
}

// Un lien mailto: ou tel: avec un « % » mal formé (Doctolib…) ne doit pas faire échouer toute la page.
function decodeLien(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// Décode les entités HTML (&#064; &#x40; …) et les adresses protégées par Cloudflare (data-cfemail).
function decodeEntities(html) {
  return html
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&commat;/gi, '@').replace(/&period;/gi, '.');
}

function cloudflareEmails(html) {
  const out = [];
  for (const m of html.matchAll(/(?:data-cfemail=["']|email-protection#)([0-9a-f]{8,})/gi)) {
    const hex = m[1];
    const key = parseInt(hex.slice(0, 2), 16);
    let e = '';
    for (let i = 2; i < hex.length; i += 2) e += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    if (e.includes('@')) out.push(e.toLowerCase());
  }
  return out;
}

function findEmails(rawHtml, siteHost) {
  const found = new Set(cloudflareEmails(rawHtml));
  const html = decodeEntities(rawHtml);
  const deob = html.replace(/\s*(\[at\]|\(at\)|\s+arobase\s+)\s*/gi, '@').replace(/\s*(\[dot\]|\(dot\))\s*/gi, '.');
  for (const m of deob.matchAll(/mailto:([^"'?\s>]+)/gi)) found.add(decodeLien(m[1]).toLowerCase());
  for (const m of visibleText(deob).matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());
  const host = siteHost.replace(/^www\./, '');
  const root = host.split('.').slice(-2).join('.');
  return [...found]
    .filter((e) => e.includes('@') && !EMAIL_JUNK.test(e))
    // On garde l'adresse du commerce : son propre domaine, ou une messagerie grand public (le gérant).
    // Les adresses d'agences web, de plateformes ou de partenaires affichées sur le site sont écartées.
    .filter((e) => e.endsWith('@' + host) || e.split('@')[1].endsWith(root) || FREEMAIL.test(e.split('@')[1]))
    // Les adresses du site lui-même d'abord, puis contact@ / reservation@ / bonjour@.
    .sort((a, b) => rankEmail(b, host) - rankEmail(a, host));
}

// Les numéros affichés (liens tel: et texte), en France, en Belgique et en Suisse.
const PHONE_RE = /(?:\+33|0033|\+32|0032|\+41|0041|\b0)\s?[1-9](?:[\s.\-]?\d{2}){3,4}\b/g;
function findPhones(rawHtml) {
  const html = decodeEntities(rawHtml);
  const raw = new Set();
  for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) raw.add(decodeLien(m[1]));
  for (const m of visibleText(html).matchAll(PHONE_RE)) raw.add(m[0]);
  const out = new Map();
  for (const r of raw) {
    let d = r.replace(/[^\d+]/g, '');
    if (d.startsWith('0033')) d = '+33' + d.slice(4);
    if (d.startsWith('0032')) d = '+32' + d.slice(4);
    if (d.startsWith('0041')) d = '+41' + d.slice(4);
    if (d.startsWith('+33')) d = '0' + d.slice(3);
    if (/^0[1-9]\d{8}$/.test(d)) out.set(d, d.replace(/(\d{2})(?=\d)/g, '$1 ').trim());
    else if (/^\+(32|41)\d{8,9}$/.test(d)) out.set(d, d);
  }
  return [...out.values()].slice(0, 3);
}

function rankEmail(e, host) {
  let s = 0;
  if (e.endsWith('@' + host)) s += 10;
  if (/^(contact|bonjour|hello|info|infos|reservation|reservations|resa|accueil)@/.test(e)) s += 5;
  return s;
}

function detect(html, list) {
  for (const [name, re] of list) if (re.test(html)) return name;
  return null;
}

/** Lit un site. `onStep(texte)` raconte ce que le lecteur fait, page par page. */
export async function lire(place, { onStep } = {}) {
  if (!place.website) return { ok: false, raison: 'pas de site', signals: { site: false }, emails: [], excerpt: '' };
  const start = new URL(place.website);
  // Un « site » qui est une page Facebook ou Instagram n'est pas un site.
  if (/facebook\.com|instagram\.com|linktr\.ee|tripadvisor\./i.test(start.host)) {
    return { ok: false, raison: 'pas de vrai site (réseau social)', signals: { site: false, social_only: start.host }, emails: [], excerpt: '' };
  }
  // Une fiche sur une plateforme de rendez-vous : les adresses qu'on y lit sont celles de la plateforme, pas du cabinet.
  if (/doctolib\.|felixsante\.|medoucine\.|resalib\.|keldoc\.|maiia\.|pagesjaunes\.|planity\./i.test(start.host)) {
    return { ok: false, raison: `pas de site à lui (fiche ${start.host.replace(/^www\./, '')})`, signals: { site: false, plateforme: start.host }, emails: [], excerpt: '' };
  }
  onStep?.(`J'ouvre ${start.host}`);
  let home;
  try { home = await getHtml(start.href); } catch (e) {
    return { ok: false, raison: `site injoignable (${e.message})`, signals: { site: false, injoignable: true }, emails: [], excerpt: '' };
  }
  const pages = [{ url: home.finalUrl, html: home.html }];
  const host = new URL(home.finalUrl).host;
  const candidates = links(home.html, home.finalUrl)
    .filter((l) => new URL(l.url).host === host && !/\.(pdf|jpe?g|png)$/i.test(l.url))
    .filter((l) => /contact|mentions|legal|reserv|booking|infos?-pratiques|a-propos|about/i.test(l.url + ' ' + l.text))
    // Les pages contact et mentions légales d'abord : c'est là que l'adresse est affichée.
    .sort((a, b) => /contact|mentions|legal/i.test(b.url + b.text) - /contact|mentions|legal/i.test(a.url + a.text));
  // Aucun lien trouvé (menu en JavaScript) : on essaie les adresses habituelles.
  if (!candidates.length) for (const path of ['/contact', '/mentions-legales']) candidates.push({ url: new URL(path, home.finalUrl).href, text: '' });
  const seen = new Set([home.finalUrl]);
  for (const l of candidates) {
    if (pages.length >= 4) break;
    if (seen.has(l.url)) continue;
    seen.add(l.url);
    onStep?.(`Je lis ${new URL(l.url).pathname}`);
    try { pages.push({ url: l.url, ...(await getHtml(l.url)) }); } catch {}
  }

  const all = pages.map((p) => p.html).join('\n');
  const text = visibleText(home.html);
  const years = [...all.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2})/gi)].map((m) => +m[1]);
  const bookingProvider = detect(all, BOOKING);
  const bookingText = /r[ée]serv(ez|er)\s+(en ligne|une table|maintenant)|book (a|your) table|r[ée]servation en ligne/i.test(visibleText(all));
  const signals = {
    site: true,
    https: home.finalUrl.startsWith('https:'),
    mobile: /<meta[^>]+name=["']viewport["']/i.test(home.html),
    reservation_en_ligne: bookingProvider ?? (bookingText ? 'oui (module du site)' : null),
    discussion: detect(all, CHAT),
    whatsapp: /wa\.me\/|api\.whatsapp\.com|whatsapp:\/\//i.test(all),
    instagram: (all.match(/instagram\.com\/([a-z0-9_.]{2,30})/i) ?? [])[1] ?? null,
    menu_pdf: /href=["'][^"']+\.pdf["']/i.test(all) && /carte|menu/i.test(all),
    outil: detect(all, BUILDERS),
    annee: years.length ? Math.max(...years) : null,
    titre: (home.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
    pages_lues: pages.map((p) => new URL(p.url).pathname),
    themes: [...new Set([...visibleText(all).matchAll(THEMES)].map((m) => m[0].toLowerCase()))].slice(0, 4),
  };
  const emails = findEmails(all, host);
  // L'adresse renseignée sur la carte (OpenStreetMap) compte aussi, si c'est bien celle du commerce.
  const osm = place.email_osm?.toLowerCase().trim();
  if (osm && !emails.includes(osm) && findEmails(`mailto:${osm}`, host).length) emails.push(osm);
  // La page où l'adresse retenue est affichée (pour la montrer dans la fiche).
  let email_source = null;
  if (emails[0]) {
    const page = pages.find((p) => findEmails(p.html, host).includes(emails[0]));
    email_source = page ? new URL(page.url).pathname : emails[0] === osm ? 'OpenStreetMap' : null;
  }
  const telephones = findPhones(all);
  onStep?.(emails.length ? `Adresse trouvée : ${emails[0]}` : 'Aucune adresse de contact affichée');
  if (telephones.length) onStep?.(`Téléphone trouvé : ${telephones[0]}`);
  return { ok: true, signals, emails, email_source, telephones, excerpt: text.slice(0, 1500) };
}

// Les praticiens (thérapeutes, sophrologues, kinés…) : l'offre est un outil pour leur pratique, pas un module de réservation.
const PRATICIEN = /th[ée]rap|psycho|neuroprat|sophro|naturo|hypno|r[ée]flexo|ost[ée]o|kin[ée]|bien[- ]?[êe]tre/i;
// Les sujets proches d'une pratique par le son, relevés sur le site.
const THEMES = /(?<!\p{L})(?:sonore|vibrations?|musicoth[ée]rapie|bols? tib[ée]tains?|diapasons?|relaxation|stress|sommeil|anxi[ée]t[ée]|hypnose|sophrologie|m[ée]ditation|[ée]nerg[ée]tique|neurofeedback|coh[ée]rence cardiaque)(?!\p{L})/giu;

function noterPraticien(lecture) {
  const s = lecture.signals ?? {};
  const raisons = [];
  let score = 45;
  const add = (pts, texte) => { score += pts; raisons.push({ pts, texte }); };
  if (!s.site) add(-30, 'pas de site lisible');
  if (s.site) add(15, 'a son propre site : un cabinet installé');
  if (s.themes?.length) add(20, `parle déjà de ${s.themes.join(', ')}`);
  if (s.reservation_en_ligne) add(5, `prend ses rendez-vous en ligne (${s.reservation_en_ligne}) : à l'aise avec les outils numériques`);
  if (s.annee && s.annee >= 2024) add(5, `site tenu à jour (${s.annee})`);
  if (!lecture.emails?.length) add(-20, 'aucune adresse de contact');
  return { score: Math.max(0, Math.min(100, score)), raisons };
}

/** Le score : est-ce un bon client pour l'offre ? Chaque point est expliqué (pas de boîte noire). */
export function noter(place, lecture) {
  if (PRATICIEN.test(place.type ?? '')) return noterPraticien(lecture);
  const s = lecture.signals ?? {};
  const raisons = [];
  let score = 30;
  const add = (pts, texte) => { score += pts; raisons.push({ pts, texte }); };
  if (!s.site) add(-30, 'pas de site lisible');
  if (s.site && !s.reservation_en_ligne) add(25, 'pas de réservation en ligne');
  if (s.reservation_en_ligne) add(-15, `réserve déjà en ligne (${s.reservation_en_ligne})`);
  if (s.site && !s.discussion) add(10, 'personne pour répondre sur le site');
  if (s.site && !s.whatsapp) add(5, 'pas de WhatsApp');
  if (place.horaires && /(2[1-4]|00):\d{2}|24\/7/.test(place.horaires)) add(10, 'ouvert tard : des demandes à toute heure');
  if ((place.rating ?? 0) >= 4.3) add(10, `bien noté (${String(place.rating).replace('.', ',')} ★)`);
  if ((place.reviews ?? 0) >= 150) add(10, `beaucoup de clients (${place.reviews} avis)`);
  if ((place.reviews ?? 0) >= 600) add(5, 'très fréquenté');
  if (s.site && !s.mobile) add(5, 'site pas fait pour le téléphone');
  if (s.annee && s.annee < 2023) add(5, `site pas mis à jour depuis ${s.annee}`);
  if (!lecture.emails?.length) add(-20, 'aucune adresse de contact');
  return { score: Math.max(0, Math.min(100, score)), raisons };
}
