# Le QG des agents : notes pour Claude Code

Tu travailles sur un logiciel open source : une équipe d'agents IA qui cherche des clients dans une vraie ville, dessinée en
pixel art. Lis ce fichier avant de modifier le code. Pour installer et lancer le QG, suis la section « Pour Claude Code » du README.

## Les commandes

- `npm start` : vérifie Node et Claude Code, construit l'interface si besoin, lance le serveur sur http://127.0.0.1:5577 et ouvre le navigateur.
- `npm run dev` : le serveur et Vite en rechargement à chaud (même adresse).
- `npm run build` : construit l'interface dans `web/dist`.
- `npm run carte` : refait `web/public/carte/pays.json` et `villes.json` (GeoNames à télécharger dans `data/geonames`, voir le script).
- Variables : `PORT` (5577 par défaut), `CLAUDE_BIN` (la commande Claude Code), `GOOGLE_MAPS_API_KEY` (facultative, dans `.env`).

## Comment c'est fait

- **`server/`** : `index.mjs` (HTTP, flux en direct SSE, tuiles en cache, n'écoute que sur 127.0.0.1), `chef.mjs` (lance l'éclaireur,
  distribue le travail aux lecteurs puis aux rédacteurs, enregistre chaque geste pour pouvoir rejouer), `db.mjs` (SQLite dans `data/`).
- **`server/agents/`** : `carte.mjs` (l'éclaireur OpenStreetMap, Overpass avec cache 7 jours ; la ville du QG, immeubles un par un et arbres),
  `lecteur.mjs` (lit un site, relève e-mails, téléphones et signaux ; `noter` : la note sur 100, chaque point expliqué),
  `redacteur.mjs` (écrit le mail avec `claude -p` et un schéma JSON), `eclaireur.mjs` et `google.mjs` (Google Places, facultatif).
- **`web/src/`** : `main.js` (les modes carte → plongée → ville, le direct et le rejeu), `carte.js` (la carte de France en pixel art,
  tuiles vectorielles), `lancement.js` (le panneau de mission), `ville.js` (la ville en carreaux de 256 px à 0,5/1/2/4 m par pixel),
  `chemins.js` (graphe des rues, A*), `monde.js` (les robots, leurs files de gestes, les répliques), `rendu.js` (le dessin),
  `realisateur.js` (la caméra), `cinema.js` (la version cinéma), `hud.js` et `fiche.js` (l'interface), `robots.js`, `sprites.js`,
  `font.js`, `pixels.js` (le pixel art, tout en code).
- **Les événements** (`chef:start`, `eclaireur:found`, `lecteur-N:start|step|done|skip`, `redacteur-N:start|done`, `chef:end`) arrivent
  dans `Monde.push` ; chaque agent les joue dans l'ordre, à un rythme lisible (`Monde.stage`).

## Les règles

- **Rien ne s'envoie.** Aucun code d'envoi de mail : les mails attendent la validation de la personne. Ne jamais en ajouter un.
- **Pas de clé dans le dépôt.** Les clés vont dans `.env` (ignoré par git). `config.json` (l'offre de la personne) est ignoré aussi ;
  le modèle est `config.example.json`. Ne demande jamais qu'on te colle une clé dans la conversation.
- **Respecter les serveurs publics** : une requête Overpass par mission, en cache ; un User-Agent qui identifie l'outil.
- **N'inventer rien dans les mails** : le rédacteur n'utilise que ce que le lecteur a vu. Aucune promesse de chiffres.
- **Français, tutoiement, phrases courtes** dans tout ce que la personne lit.
- **Attribution OpenStreetMap** visible à l'écran (licence ODbL) : ne pas la retirer.
- **Pas d'image externe** : tout le pixel art est dessiné en code (`robots.js`, `sprites.js`, `ville.js`).
