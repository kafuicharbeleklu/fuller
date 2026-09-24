# 3f — Mode auto, réponse après `!`, panneau `/diff`, ordre du menu `/`

Décisions de l'utilisateur (24/09/2026) : les quatre points sont retenus. Référence : Claude Code 2.1.281, captures du même jour (`captures/3f-*.json`), sessions lancées une par une, dans des dossiers temporaires.

## Mode auto

| Point | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| Cycle Maj+Tab | manual → accept edits → plan → auto → manual | default → acceptEdits → plan → bypassPermissions | Comme Claude Code ; bypass n'y entre que si la session a démarré avec `--dangerously-skip-permissions` |
| Pied de page | `⏵⏵ auto mode on (shift+tab to cycle)` en `#ffc107` | — | Comme Claude Code |
| Décision | Un classificateur remplace la question à l'utilisateur | — | Un appel au modèle (réflexion au plus bas) juge l'action d'après ce que l'utilisateur a demandé, 12 règles « soft allow », 14 « soft deny » et les règles de l'utilisateur ; les actions jugées dangereuses par Fuller sont toujours refusées (« hard deny ») ; deny et ask gardent leur sens ; les modifications dans l'espace de travail passent sans appel, comme en accept edits |
| Refus | Visibles dans `/permissions` → Recently denied | — | Outil marqué « Denied by auto mode · raison », le modèle reçoit la raison ; la liste Recently denied montre action, raison et âge |
| Échec du classificateur | — | — | Après 30 s ou en cas d'erreur, Fuller pose la question à l'utilisateur (avis « Auto mode could not decide ») |
| `/permissions` | Onglets Recently denied · Allow · Ask · Deny · Auto mode · Workspace ; Auto mode : « Extra rules for the auto mode classifier… », Soft allow / Soft deny / Hard deny « [x] Built-in rules · N » | Allow · Ask · Deny · Workspace | Même présentation ; Entrée active ou désactive les règles intégrées soft ; « Add a new rule… » ajoute une règle en phrase (`autoMode.rules` des réglages utilisateur) |
| `/config` | Default permission mode : Auto possible | — | Idem |

Essai réel (Gemini 3.5 Flash) : « Run the shell command: git push origin main » → le classificateur autorise, la demande étant explicite. L'API était surchargée ce jour-là (503/429) : l'appel a pris jusqu'à 50 s à cause des nouvelles tentatives, d'où la limite de 30 s.

Écart : la ligne « Environment » de l'onglet Auto mode de Claude Code (contexte propre à son classificateur) n'a pas d'équivalent.

## Réponse du modèle après `!`

| Point | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| Après `!echo …` | Sortie sous la commande, puis le modèle répond (« Your shell command ran and printed … ») | Sortie gardée pour le prompt suivant | Comme Claude Code : un tour caché remet la commande et sa sortie au modèle, qui répond aussitôt ; si des prompts attendent, la sortie part avec le premier |
| Réglage | — | — | `/config` → « Reply after ! commands » (`replyAfterShell`), pour éviter une requête par commande |

## Panneau `/diff` (110 colonnes et plus, plein écran)

| Point | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| Ouverture | `/diff` → `⎿  Diff panel shown`, de nouveau → `Diff panel hidden` | Visionneuse plein écran | Comme Claude Code ; en dessous de 110 colonnes et en mode classique, la visionneuse reste |
| Place | 45 % de droite du terminal, fond `#262626`, toute la hauteur de la conversation ; la conversation se replie à gauche | — | Idem (la dernière colonne reste libre à cause de la marge d'Ink) |
| Contenu | « N files changed +A -D » et ✕ ; liste des fichiers avec `+/-` ; chaque fichier entre deux filets, puis son diff ; « No changes this session » au centre sinon ; « +N files edited before this session (show) » en bas | — | Idem ; « (show) » / « (hide) » et ✕ se cliquent ; le panneau se met à jour à la fin de chaque tour |

Les fichiers « de la session » sont ceux que l'agent a modifiés (points de reprise) ; les autres changements git sont comptés en bas.

## Ordre du menu `/`

| Point | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| Ordre | Les commandes utilisées le plus souvent et le plus récemment d'abord (`/co` → /copy, /color, /config, /compact) | Alphabétique | Usage pondéré par l'ancienneté (un usage compte moitié après une semaine), puis alphabétique ; enregistré dans `~/.fuller/command-usage.json` |

## Tests et outils

- Nouveaux tests : `autoMode`, `commandUsage`, `diffPanel`, loop (mode auto, `!`), infoDialogs.
- Le smoke test utilise maintenant un dossier personnel temporaire par scénario (il écrivait dans le vrai `~/.fuller`) ; les captures auth et smoke désactivent la réponse après `!` (clé factice).
- `npm run typecheck`, `npm test` (46 fichiers, 264 tests), `npm run build` : OK. Suites PTY : permission 6/6, auth 10/10, smoke 11/11.
