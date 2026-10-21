// Le rédacteur : écrit un premier mail personnalisé avec Claude Code en mode « print » (ton abonnement, pas de clé API).
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { ROOT } from '../env.mjs';

// Claude Code : la commande « claude » (installée par l'installeur officiel dans ~/.local/bin, sinon cherchée dans le PATH).
const LOCAL = join(homedir(), '.local', 'bin', 'claude');
const CLAUDE = process.env.CLAUDE_BIN ?? (existsSync(LOCAL) ? LOCAL : 'claude');
const CWD = join(ROOT, 'data', 'redacteur');
mkdirSync(CWD, { recursive: true });

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    constat: { type: 'string', description: 'Une phrase : le détail concret vu sur le site ou la fiche, qui justifie le mail.' },
    objet: { type: 'string', description: 'Objet du mail, 7 mots au plus, sans majuscules partout ni emoji.' },
    mail: { type: 'string', description: 'Le corps du mail, signature comprise.' },
  },
  required: ['constat', 'objet', 'mail'],
});

const SYSTEM = `Tu es le rédacteur d'une petite équipe d'agents de prospection. Tu écris le premier mail à un commerce, au nom de la personne qui signe.
Règles :
- Français, vouvoiement, ton simple et direct, 90 mots au plus pour le corps.
- Une seule observation concrète tirée des données fournies (un détail du site, de la fiche ou des avis). N'invente rien : si une donnée manque, n'en parle pas.
- Dis en une phrase ce que la personne propose, avec ses mots à elle.
- Aucun chiffre promis (ni réservations en plus, ni chiffre d'affaires, ni pourcentage).
- Une seule question à la fin, facile à accepter (par exemple un échange de 10 minutes).
- Termine par une ligne qui permet de dire non : « Si ce n'est pas le moment, répondez simplement non et je ne vous relancerai pas. »
- Signature : le prénom et le nom fournis, puis le site.
- Pas de « J'espère que vous allez bien », pas de flatterie, pas de jargon (« IA générative », « solution innovante »).`;

function runClaude(prompt, { model = 'sonnet', timeoutMs = 90000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json', '--model', model, '--tools', '', '--strict-mcp-config',
      '--no-session-persistence', '--system-prompt', SYSTEM, '--json-schema', SCHEMA, prompt];
    const child = spawn(CLAUDE, args, { cwd: CWD, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Claude ne répond pas (délai dépassé)')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const res = JSON.parse(out);
        if (res.is_error) return reject(new Error(String(res.result ?? 'erreur Claude').slice(0, 200)));
        const r = res.structured_output ?? JSON.parse(res.result);
        resolve({ ...r, duree_ms: res.duration_ms });
      } catch {
        reject(new Error(`Claude a échoué (code ${code}) ${err.slice(0, 200)}`));
      }
    });
  });
}

export async function rediger(place, lecture, note, offre, consignes = '') {
  const s = lecture.signals ?? {};
  const fiche = {
    commerce: place.name,
    type: place.type,
    adresse: place.address,
    note_google: place.rating ? `${place.rating} / 5 (${place.reviews} avis)` : null,
    horaires: place.horaires ?? null,
    reservation_en_ligne: s.reservation_en_ligne ?? 'aucune trouvée sur le site',
    discussion_sur_le_site: s.discussion ?? 'aucune',
    whatsapp: s.whatsapp ? 'oui' : 'non',
    site_adapte_au_telephone: s.mobile ? 'oui' : 'non',
    derniere_annee_sur_le_site: s.annee,
    titre_du_site: s.titre,
    pourquoi_ce_commerce: note.raisons.filter((r) => r.pts > 0).map((r) => r.texte),
    extrait_du_site: (lecture.excerpt ?? '').slice(0, 900),
  };
  const prompt = `Ce que je propose : ${offre.ce_que_je_vends}
Pour qui : ${offre.pour_qui}
Signature : ${offre.signature} — ${offre.site}
${consignes ? `Les consignes de la personne pour ce mail (à suivre, sauf si elles contredisent les règles) : ${consignes}\n` : ''}Le métier visé par cette mission : ${place.type}. Si l'offre parle d'un autre métier, adapte ses mots à celui-ci (par exemple « séance d'essai » devient « réservation » pour un restaurant), sans changer ce qu'elle fait.

Le commerce (données relevées par l'éclaireur et le lecteur) :
${JSON.stringify(fiche, null, 2)}

Écris le premier mail.`;
  return runClaude(prompt);
}
