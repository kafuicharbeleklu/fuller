# Note de passation — Claude, 24/09/2026

Pour les agents qui reprennent le travail sur Fuller (Codex, Antigravity…). Dépôt au commit `8fc287e`, branche `main`, intégration continue verte (Node 20 et 22). Feuille de route suivie : section 6 de [Comparaison_trois_recherches_Claude.md](Comparaison_trois_recherches_Claude.md) ; état détaillé et mesures dans [plan-efficacite-agent.md](plan-efficacite-agent.md).

## 1. Ce qui est fait

| Lot | Contenu | Fichiers principaux |
|---|---|---|
| 0 — Mesure fiable | Tests d'origine remis en place avant la vérification (`protect`) ; `mustNotChange` seulement quand la consigne interdit de toucher un fichier (fichiers nouveaux compris) ; solution de référence par tâche (`--verify-solutions`) ; erreurs d'API comptées à part (quota compris) ; modèle réellement utilisé ; tokens servis par le cache ; traces sans clés ; `--compare` limité aux tâches notées des deux côtés ; rappels du lot 2 enregistrés par tâche (`checks`) | `scripts/eval.mjs`, `evals/tasks/*/task.json` et `solution.patch`, `tests/evalRunner.test.ts` |
| 1 — Gemini robuste | Température retirée ; `finishReason` traité (réponse vide relancée, refus et réponse coupée signalés) ; environnement en fin de prompt système (préfixe stable pour le cache) ; compaction qui garde début **et** fin des sorties d'outils ; chemin du fichier complet dans les sorties coupées ; `prompt_tokens` et `cached_tokens` dans le JSON de `-p` | `src/agent/gemini.ts`, `src/agent/systemPrompt.ts`, `src/tools/registry.ts`, `src/headless.ts`, `tests/geminiRobustness.test.ts` |
| 2 — Travail vérifié | Rappels avant de conclure (contrôle manquant ou périmé, contrôle en échec, liste de tâches non finie), une fois par sujet et par tour ; détection d'absence de progrès (même appel ×4 sans changement de fichier, même erreur ×3 → recul ; récidive → arrêt, dernière réponse sans outils) ; relecteur en lecture seule sur les changements ≥ 4 fichiers ou ≥ 150 lignes ; règles 4 et 7 du prompt | `src/agent/taskState.ts`, `src/agent/review.ts`, `src/agent/loop.ts:770` (suivi), `:854` (absence de progrès), `:1098` (`beforeConclude`), `tests/taskState.test.ts`, `tests/loop.test.ts` |

Réglages ajoutés (`/config` et `~/.fuller/settings.json`) : `verifyWork` (défaut `true`), `reviewChanges` (`risky` par défaut, `always`, `off`), `modelFallback` (`ask`, `auto`, `off`).

## 2. Mesures (Gemini 3.6 Flash, 1 essai par tâche)

| Passage | Fichier | Résultat |
|---|---|---|
| Référence (lots 0-1) | `evals/results/2026-09-24-19-10-gemini-3.6-flash.json` | 7/8 brut ; le seul échec venait d'un correcteur trop strict, corrigé depuis → 8/8 |
| Avec le lot 2 | `evals/results/2026-09-24-20-04-gemini-3.6-flash.json` | 7/7 notées (async-error coupée par une erreur d'API) |

Sur les 7 tâches notées des deux côtés : 7 → 7 réussites, 256 050 → 252 352 tokens, 55 → 55 appels d'outils, 281 → 369 s. **Ce banc ne montre pas encore d'effet du lot 2** : les 8 tâches sont faciles et l'agent vérifiait déjà. Le temps en plus vient probablement des attentes de limite par minute (non vérifié).

## 3. Ce qui n'est pas vérifié — à ne pas présenter comme acquis

- **Le lot 2 n'a été observé qu'avec Gemini simulé.** En réel, aucun rappel ne s'est déclenché sur la seule tâche où ils étaient enregistrés (add-cli-flag). Le mode sans outils (`noTools`, `FunctionCallingConfigMode.NONE`, `src/agent/gemini.ts:378`) et le relecteur n'ont jamais tourné contre l'API réelle, ni avec Gemma.
- **Cache implicite : 0 % mesuré.** Les appels du banc font environ 3 400 tokens, sous le minimum de 4 096 de Gemini 3 Flash. Un essai direct à 8 300 tokens identiques sur Gemini 3.5 Flash-Lite a aussi donné 0 %. La documentation ne garantit pas les succès de cache et ne dit rien de l'offre gratuite.
- **Seuils** (4 répétitions, 3 erreurs, 4 fichiers, 150 lignes) : des hypothèses reprises de Gemini CLI, pas des valeurs mesurées sur Fuller.
- **Historique après un arrêt** : un dépassement de `maxTurns` casse la boucle sans répondre aux derniers appels d'outils (`src/agent/loop.ts`, test `turns > this.config.maxTurns`), et rien ne répare l'historique ; le message suivant risque un refus de l'API. Quand `repairHistory()` (`src/agent/gemini.ts:330`) est appelé (interruption, ou arrêt du lot 2 si le modèle appelle un outil malgré l'interdiction), il retire toute la chaîne d'outils du tour, pas seulement le dernier appel. Comportement antérieur au lot 2, non corrigé et non testé contre l'API.

## 4. Suite proposée

1. **Tâches plus difficiles** (20 à 30, tirées de vrais échecs de Fuller), où un agent a tendance à conclure sans vérifier, puis `node scripts/eval.mjs --repeat 3 --compare <référence>`. C'est le seul moyen de mesurer le lot 2.
2. **Lot 3 — contexte et mémoire** : masquage récupérable des vieilles sorties d'outils (paires appel/réponse intactes), résumé structuré, notes de mémoire avec provenance et remplacement.
3. **Lot 4 — outils** : `outline_file`, carte du dépôt, contrôle syntaxique différentiel (TypeScript du projet s'il existe, `JSON.parse`, `node --check`), meilleures erreurs d'édition (emplacements candidats, pas de correspondance floue par défaut).
4. **Lot 5 — modèles** : comparer modèles et niveaux de réflexion sur le même corpus, Gemma compris.

## 5. Règles de travail dans ce dépôt

- Avant de publier : `npm run typecheck`, `npm test` (334 tests), `npm run build`. Interface : `python3 scripts/tui-smoke.py` (11 cas, clé factice), `scripts/tui-permission-capture.py` et `scripts/tui-auth-capture.py` (les captures dans `reports/tui-*` sont régénérées et commitées).
- Banc d'essai : `npm run build` d'abord ; `node scripts/eval.mjs --baseline` (tout doit échouer sans agent) et `--verify-solutions` (toutes les solutions de référence doivent passer) sont gratuits ; un passage complet consomme environ 350 000 tokens du quota du jour.
- **Clés** : jamais dans un commit, une trace ou une sortie. Elles sont dans `.env` et `~/.fuller/.env` (mode 600) ; `note.txt` est ignoré par git. Les quotas sont **par projet Google** ; additionner des projets gratuits contourne les limites (conditions des API Google, §2d). 6 des 21 clés configurées répondent 403 « denied access ».
- **Quota** : le quota du jour de Gemini 3.6 Flash était épuisé sur toutes les clés le 24/09 au soir ; il revient à minuit, heure du Pacifique. Un 429 peut aussi être une simple limite par minute : `--check-keys` ou un seul appel suffit pour savoir.
- **Commits** : sujets courts en français ; indexer seulement ses propres fichiers. `reports/Comparaison_Recherches_Fuller_Codex.md` est un fichier de Codex resté hors git : je ne l'ai ni modifié ni commité.
- Poussée : `git push origin main` (SSH) ; si SSH échoue, `git -c credential.helper='!gh auth git-credential' push https://github.com/kafuicharbeleklu/fuller.git main`.

## 6. Mise à jour du 24/09 au soir — corrections après la revue croisée

Les notes de [Codex](Note_de_passation_Codex.md) et d'[Antigravity](Note_de_passation_Antigravity.md) ont été lues. Codex et moi avons reproduit les mêmes défauts dans `outline_file` et `/learn` ; l'utilisateur m'a confié les corrections. Codex n'a rien modifié entre-temps.

| Point | Avant | Maintenant | Fichiers |
|---|---|---|---|
| `outline_file` et les permissions | « outil inconnu » : confirmation en mode normal, **refus en mode plan**, absent d'Explore et du relecteur | Une lecture partout : permissions (`TOOL_DISPLAY` → `Read`, donc les règles `Read(...)` s'appliquent), mode plan, exécution en parallèle, Explore, relecteur, affichage replié | `src/permissions/rules.ts`, `src/agent/loop.ts`, `src/agent/subagents.ts`, `src/agent/review.ts`, `src/ui/ToolRow.tsx`, `src/ui/ToolGroup.tsx` |
| `outline_file` et le contenu | Motifs seuls : 13 symboles sur `loop.ts`, aucune méthode de classe, déclarations sur plusieurs lignes manquées | JS/TS : analyseur TypeScript du projet, sinon celui de Fuller (pas une dépendance d'exécution) ; méthodes, constructeurs, accesseurs, plages de lignes (86 symboles sur `loop.ts`). Sans TypeScript : motifs avec suivi des accolades (chaînes, gabarits, commentaires et expressions régulières sautés) ; sur les 101 fichiers TS de Fuller, 98 % des 809 symboles de l'analyseur, aucun faux positif | `src/tools/outline.ts` |
| `/learn` | Note enregistrée mais absente de la session en cours | Consignes rechargées ; pendant un tour, rechargement à la fin du tour (reconstruire la conversation sous une réponse en cours la perdrait) ; message clair si la mémoire apprise est désactivée | `src/ui/commands.ts`, `src/agent/loop.ts` (`reloadInstructions`) |
| Reconnaissance des contrôles (correctif A de Codex) | `npm test 2>&1` et `npm test 2>&1 \| tail -20` non reconnus : rappel faux (« aucune commande ») | `checkStatus()` : `exact` (y compris `2>&1`, `> /dev/null`, `cd x; npm test`), `unknown` derrière un filtre (`\| tail`, `\| head`, `\| grep`, `\| cat`…) : le contrôle compte comme lancé mais n'efface pas un échec connu ; `null` pour `\|\| true`, `; true`, `&`, `$(…)`, une écriture ou `\| tee`. Même contrôle malgré une redirection différente (`npm test` = `npm test 2>&1`). Textes des rappels corrigés | `src/agent/taskState.ts` |
| Verdict du relecteur (correctif B de Codex) | Défauts écrits `` `src/a.js:3` — … ``, `**src/a.js:3** - …` ou `src/a.js:3: …` jetés comme « non concluants » | Ces formes comptent comme défauts ; `NO_ISSUES` accepté comme dernière ligne ou dernière phrase (« No defect found. NO_ISSUES ») ; « I cannot say NO_ISSUES. » reste non concluant | `src/agent/review.ts` |

Vérifications : `npm run typecheck`, 429 tests (26 de plus), `npm run build`, `--verify-solutions` 8/8, `--baseline` 8/8, `tui-smoke.py` 11/11 à deux reprises. Un premier passage de `tui-smoke.py` a échoué une fois sur le sélecteur de modèle en plein écran (« the conversation disappeared above the picker ») puis a réussi deux fois : même instabilité de synchronisation que celle de `tests/sessionPicker.test.tsx` signalée par Codex, cause non établie.

Toujours non vérifié : aucun de ces changements n'a tourné contre l'API réelle ; l'effet d'`outline_file` sur la qualité ou les tokens n'est pas mesuré.

Risque vu en passant, non corrigé : `setPermissionMode()` (Maj+Tab) reconstruit la conversation immédiatement, même pendant une réponse en cours. D'après le fonctionnement du SDK (l'échange n'entre dans l'historique qu'à la fin du flux), cela pourrait perdre l'échange en cours. Non reproduit ; à vérifier avant de corriger.


## 7. Mise à jour — mot de passe administrateur (sudo)

Signalé par l'utilisateur : « la validation admin bug, puis ouvre une fenêtre, et n'est pas comme Claude Code ». Reproduit avec le vrai `sudo-rs` 0.2.13 d'Ubuntu 26.04 dans un PTY, avec un faux serveur Gemini local (`GOOGLE_GEMINI_BASE_URL`), sans jamais envoyer de mot de passe.

- **Cause** : en plein écran (le mode par défaut), la passation du terminal quittait l'écran alternatif (`ESC[?1049l`). Fuller disparaissait et laissait voir l'ancien contenu du terminal avec « [sudo: authenticate] Password: ». C'est la « fenêtre » décrite par l'utilisateur (confirmé par lui).
- **Claude Code 2.1.282** (capturé) : même carte de permission avec « This command requires approval » et « Yes, and don’t ask again for: <commande> » ; ensuite il ne demande **pas** de mot de passe, `sudo` échoue (« A terminal is required to authenticate ») et le modèle explique. L'utilisateur a choisi de garder la saisie dans Fuller.
- **Maintenant** :
  - Carte de permission comme Claude Code pour `sudo` sur une commande non destructrice. La règle mémorisée ne vaut que pour la commande exacte. `sudo rm -rf`, `sudo dd`… gardent l'avertissement et Oui/Non. Code : `src/permissions/rules.ts` (`privilegedCommand`).
  - Encadré « Password required » à la place de la zone de saisie. En plein écran, Fuller reste affiché et l'écran est redessiné à la reprise. `sudo` lit toujours le mot de passe lui-même. Code : `src/ui/frameWriter.ts` (`authPanel`, `suspend`).
  - `pkexec`, `sudo -A` et `--askpass` sont refusés pour l'agent, car ils ouvrent une fenêtre du bureau. Le prompt système demande `sudo` aussi pour `systemctl`, `nmcli`… (fenêtre polkit de GNOME sinon). Code : `src/tools/nativeTerminal.ts` (`desktopAuthentication`).
- **Vérifications** : 435 tests ; PTY permission 6/6, authentification 10/10 et rejeux 10/10, fumée 11/11 ; vrai `sudo-rs` jusqu'à l'invite, en classique et en plein écran.
- **Limites** :
  - En mode classique, l'encadré reste dans l'historique au-dessus du résultat, comme l'ancienne bannière : `sudo` peut ajouter des lignes (« try again ») qu'on ne peut pas compter.
  - Après Ctrl+C sur un appel de l'agent, le tour entier est interrompu et la ligne `Bash(sudo …)` n'est pas gardée dans la conversation (comportement antérieur).
  - Claude Code 2.1.282 ajoute aussi, sur toutes ses cartes de permission, une ligne « Tip: auto mode… » et un choix « Yes, and switch to auto mode ». Ce n'est pas repris ici.
  - Une saisie réussie avec le vrai mot de passe n'a pas été testée (seulement avec un faux `sudo`).

## 8. Mise à jour — navigation dans /status

Comparée à une capture de Claude Code 2.1.282 (commande locale, sans appel au modèle) :
- **Défaut corrigé** : un premier → depuis Status menait à Config en donnant la main au champ de recherche, où → ne faisait plus rien. On restait bloqué sur Config, sauf avec Tab. Maintenant ←/→/Tab restent sur la rangée d'onglets pour tous les onglets, comme Claude Code (aide « ←/→/tab to switch · ↓ to return · Esc to close »). ↓ mène à la recherche, puis à la liste ; ↑ remonte. `/config` ouvre toujours sur la recherche.
- **Défilement** de Status et Usage quand ils dépassent l'écran : ↑/↓, PgUp/PgDn, Début/Fin, avec les marques ↑/↓ au bord droit comme Claude Code. Elles sont deux colonnes plus à gauche que chez lui, car Fuller se dessine une colonne plus étroit que le terminal.
- Code : `src/ui/InfoDialogs.tsx` (`SettingsDialog`). Tests : `tests/infoDialogs.test.tsx`.
- `tests/terminalLifecycle.test.tsx` attend maintenant que la sortie d'Ink se stabilise au lieu d'un délai fixe de 80 ms, qui échouait parfois quand toute la suite tournait en parallèle.
- Non repris : le contenu de l'onglet Usage de Claude Code (sections Session, barres d'utilisation), qui dépend de son abonnement.

## 9. Mise à jour — fichiers hors du projet, messages en anglais

Signalé par une session de l'utilisateur : à « crée un fichier HTML sur mon Bureau », `list_directory ~/Desktop` recevait un refus sec, en français. Le modèle posait alors des questions, puis écrivait le fichier avec `cat > ~/Desktop/index.html` : ni diff, ni retour arrière.

- **Maintenant** : un outil de fichier (lecture, plan, liste, recherche, écriture, édition) qui sort du projet et des dossiers ajoutés **demande la permission**, dans tous les modes, « accept edits » compris. Choix : Yes (cet appel) ; « Yes, allow reading from <dossier>/ during this session » ou « allow all edits in » (le dossier est ajouté jusqu'à la fin de la session, prompt système rechargé à la fin du tour) ; No. Les fichiers sensibles restent refusés sans question ; un lien symbolique est présenté par son vrai dossier. Code : `src/permissions/rules.ts` (`outsideDirectory`), `src/tools/paths.ts` (`outsidePath`), `src/agent/loop.ts` (`addDirectory`), `src/agent/subagent.ts`. Le prompt système dit d'utiliser les outils de fichiers plutôt que le shell.
- **Règles** : `Read(//chemin/absolu/**)` et `Read(~/…)` fonctionnent (syntaxe de Claude Code). Avant, seuls les chemins relatifs au projet correspondaient.
- **Messages** : erreurs d'outils, motifs de danger et chemins refusés passés en anglais (« Access denied », « target_content was not found », « Dangerous command: recursive rm »…).
- **Non vérifié** : les libellés exacts de Claude Code pour ce cas. Son quota hebdomadaire était épuisé et une capture demandait un tour du modèle ; les textes choisis sont plausibles, sans preuve.
- Le panneau `/diff` (« No changes this session ») visible dans la session n'était pas un défaut : l'utilisateur l'avait ouvert.
- `tests/sessionPicker.test.tsx` échoue encore de temps en temps quand toute la suite tourne en parallèle, puis passe seul (déjà signalé par Codex).

## 10. Mise à jour — les trois points de la revue de Codex (25/09 au matin)

1. **`outline_file` exécutait du code du projet** (confirmé par Codex et par moi : un faux `node_modules/typescript` a laissé une trace, même en mode plan). Corrigé : Fuller ne charge plus que **son propre** TypeScript, devenu une dépendance d'exécution (23 Mo, chargé au premier appel seulement). Test de non-régression avec un paquet hostile : `tests/outline.test.ts`.
2. **Un contrôle derrière un filtre passait sans résultat vérifié** (`npm test | tail -20`). Maintenant, un rappel unique « exit code unknown, run it once as is » est envoyé, sauf si un contrôle au code de sortie connu a déjà réussi après la dernière modification. Code : `src/agent/taskState.ts` (`passedAt`, rappel `unconfirmed`).
3. **Reconstruction de la conversation pendant une réponse** : **reproduit** avec la vraie session, le vrai SDK et un faux serveur qui envoie sa réponse en deux morceaux. Changer de mode, d'effort ou de modèle pendant le flux vidait l'historique, parce que le SDK n'inscrit l'échange qu'à la fin du flux. Corrigé : `GeminiAgentSession.rebuild()` attend la fin du flux (`src/agent/gemini.ts`). Test : `tests/refreshDuringStream.test.ts`. Sans le correctif, 3 cas sur 4 échouent ; le témoin passe.

**Autres constats** :
- `tests/modelFallback.test.ts` échouait par délai dépassé autour de 07:00 UTC, c'est-à-dire minuit heure du Pacifique, la remise à zéro des quotas du jour. Le repos d'une clé se compte jusqu'à cette heure : juste avant, Fuller attend la remise à zéro au lieu de proposer un autre modèle. La date est désormais fixée dans ces tests (`FALLBACK_TEST_NOW` pour la changer).
- **Non traité, à décider** : Fuller n'a pas de fenêtre « Do you trust the files in this folder? ». Un dépôt ouvert peut lancer ses hooks (`.fuller/settings.json`) et ses serveurs MCP (`.mcp.json`) sans confirmation. Claude Code demande avant. C'est un chantier à part.
- **Non traité** : juste après minuit heure du Pacifique, un 429 « par jour » encore renvoyé par Google mettrait la clé au repos pour 24 h.
- `/tmp` contient environ 14 700 dossiers `fuller-*` et `parity-*` laissés par les tests (1,1 Go en mémoire).
- `scripts/tui-smoke.py` : ce matin, la machine était lente (`node -e 0` prenait 0,4 s ; Fuller 4 à 11 s avant son premier affichage). La suite échouait donc sur ses délais fixes, y compris avec la version déjà commitée. Le démarrage attend maintenant jusqu'à 20 s, et chaque étape attend le texte attendu (5 s au plus) au lieu d'un délai fixe. TypeScript n'est pas chargé au démarrage (vérifié avec `strace`).


## 11. Mise à jour — confiance dans le dossier (priorité commune de Codex et de moi)

- **Claude Code 2.1.282**, capturé dans un dossier jamais approuvé, sans appel au modèle : fenêtre « Accessing workspace: <dossier> / Quick safety check… / ❯ No, exit / Yes, I trust this folder ». Avant la réponse, ni hook ni serveur MCP ne tourne. Une fois le dossier approuvé, les hooks du projet tournent, mais chaque **nouveau serveur MCP** fait l'objet d'une question à part : « New MCP server found in this project: demo … Use this MCP server / Use this and all future MCP servers in this project / ❯ Continue without using this MCP server ». Dans sa configuration, `/tmp` était déjà approuvé, ce qui explique l'absence de question dans les dossiers temporaires.
- **Fuller maintenant** : même fenêtre (`src/ui/TrustDialog.tsx`), posée dans `src/index.tsx` **avant** toute lecture du dossier. Le `.env` du projet n'est plus lu à l'import de `config.ts` : `loadEnvFiles(dir, trusted)` le lit seulement pour un dossier approuvé. Avant, un `.env` hostile pouvait fixer `GOOGLE_GEMINI_BASE_URL` et recevoir la clé API. Mémoire : `~/.fuller/trusted-folders.json` (mode 600, sous-dossiers compris). `-p`, `--check-keys` et `--list-models` valent approbation, comme le `-p` de Claude Code. Les scripts PTY approuvent leur dossier dans leur dossier personnel temporaire (`trust_folder`).
- **Sortie** : après `/exit`, Fuller se termine explicitement une fois la session enregistrée (`process.exit(0)` après le résumé), au lieu d'attendre que Node n'ait plus rien en cours. Une sortie restait parfois bloquée plus de 20 s dans `tui-auth-capture.py`, sans cause identifiée. Mesuré ensuite : 0,1 à 0,3 s.
- **Non fait** : la question par serveur MCP de Claude Code. Pour l'instant, approuver le dossier lance tous ses serveurs MCP.
- **Vérifications** : typage, tests unitaires (dont `tests/trust.test.tsx`), essais en PTY (question, refus sans rien lancer, approbation puis hook et MCP, pas de question au lancement suivant). Les suites PTY complètes (fumée, authentification) étaient instables pendant la mise au point : la charge moyenne atteignait 10,8 sur 8 cœurs à cause d'autres sessions (Playwright, vite). Relancées une fois la machine calme : voir le commit.

## 12. Mise à jour — question par serveur MCP, panneau /diff fidèle et ouverture automatique

- **Serveurs MCP d'un projet** (capturé dans Claude Code 2.1.282) :
  - Un serveur : « New MCP server found in this project: <nom> », puis Use this MCP server / Use this and all future MCP servers in this project / ❯ Continue without using this MCP server.
  - Plusieurs : « N new MCP servers found in this project / Select any you wish to enable. », cases [✔] cochées au départ, Espace ou Entrée sur un serveur pour cocher ou décocher, « Enable selected » pour valider, Échap pour tout refuser.
  - Réponses gardées dans `~/.fuller/mcp-approvals.json`, hors du dépôt : un projet ne peut pas livrer ses propres approbations. Code : `src/mcp/approval.ts`, `src/ui/McpApprovalDialog.tsx`, `src/index.tsx`, filtrage dans `src/agent/loop.ts` (`safeLoadMcp`).
- **Panneau /diff** : capturé dans Claude Code 2.1.282 et comparé à sa documentation officielle (`code.claude.com/docs/en/interactive-mode#diff-panel`).
  - **Ouverture automatique**, telle que la documentation la décrit : « The panel also opens on its own once Claude starts editing files, if your terminal is at least 144 columns wide. After you've opened it yourself with /diff, later sessions open it as soon as Claude edits a file in any terminal wide enough to fit it. Close the panel and it stays closed, in this session and later ones, until you run /diff again. » Implémentée avec le réglage utilisateur `diffPanel` : `auto`, `opened` ou `closed`.
  - **Rafraîchissement** après chaque modification, commande shell ou sous-agent, et en fin de tour.
  - **Défilement** à la molette au-dessus du panneau ; un clic sur un fichier saute à son diff. `src/ui/DiffPanel.tsx` décrit le panneau comme une liste de lignes (`panelRows`), ce qui donne défilement et zones de clic.
  - **Changements antérieurs à la session** (« (show) ») : même disposition que Claude Code, dont les fichiers non suivis marqués « (untracked) » avec « New file not yet staged. Run `git add :/…` to see line counts. », et l'ordre des chemins.
  - **Sous 110 colonnes** en plein écran : « Resize your terminal to at least 110 columns to show the diff panel ». Hors dépôt Git ou en mode classique : la visionneuse.
- **Pas encore fait** (décrit par la documentation, non capturé) :
  - `Ctrl+X B` pour changer la référence de comparaison (cette session, changements non commités, depuis la branche par défaut) ;
  - le regroupement des fichiers de test et générés ;
  - la sélection de lignes à la souris envoyée au prompt ;
  - la visionneuse du mode classique à la manière de Claude Code (vue « Current » et vues par tour, liste, Entrée pour ouvrir un fichier).
- **Vérifications** : 463 tests, dont `tests/mcpApproval.test.tsx`, `tests/diffPanel.test.tsx` et `tests/diffPanelAuto.test.tsx` (la vraie App, 144, 110 et fermé). Essais en PTY pour la question MCP : refus puis rien au lancement suivant, approbation qui démarre le serveur. La suite de fumée PTY échouait sur un redimensionnement, la charge étant à 12 sur 8 cœurs à cause d'autres sessions.

## 13. Mise à jour du 25/09 — orientation « droit au but » et lots 3-4 (partie centrale)

Pour Codex, Antigravity et les autres agents. Changements dans l'arbre de travail au-dessus de `6f78c5d`, **non commités** au moment d'écrire (l'utilisateur décide du commit). Le détail et les mesures sont dans la section « État au 25/09 » de [plan-efficacite-agent.md](plan-efficacite-agent.md).

### A. Ce que l'utilisateur a demandé, et la lecture que j'en fais

L'utilisateur a rappelé l'objectif (améliorer le fonctionnement, l'efficacité, l'apprentissage et le raisonnement de l'agent) et demandé qu'on signale franchement toute route sans issue, comme Gemini l'avait fait en recommandant React à la place de Python/Rich. Ce que j'ai constaté avant de répondre :

- **Fuller n'a presque jamais servi pour de vrai** : 66 prompts distincts dans `~/.fuller/history.jsonl`, presque tous hors code (« hello », « install vscode », « mon VPN est actif ? ») ; plus grosse session : 8 messages ; aucun `MEMORY.md` appris n'existe ; aucun rappel du lot 2 déclenché en réel. Toute l'ingénierie « efficacité » a été construite d'après des lectures, pas d'après des échecs observés.
- Le banc (8 tâches faciles, 100 % de réussite, un passage épuise le quota gratuit du jour) **ne peut pas départager deux versions**. En faire la porte de chaque lot mène à des notes « pas encore mesuré » sans fin.
- Les trois notes d'orientation (Claude, Codex, Antigravity) sont d'accord sur le fond. Un tour de recherche ou de comparaison de plus ne produit que des désaccords d'ordre.

Décisions prises avec l'utilisateur, à respecter par les agents suivants :

1. **Construire d'abord, mesurer sur l'usage réel.** Le banc reste un test de fumée (`--baseline` 8/8, `--verify-solutions` 8/8, et un ou deux passages réels quand le quota le permet). Les prochaines tâches du banc viennent de vrais échecs de Fuller utilisé sur Fuller lui-même, pas de la littérature.
2. **Ne pas remplacer le moteur.** La comparaison avec Gemini CLI via ACP ou le Claude Agent SDK ([Note_Orientation_Pragmatique_Codex.md](Note_Orientation_Pragmatique_Codex.md), §2) est écartée : permissions, mode plan, hooks, MCP, sous-agents, sessions, panneau /diff, tout est branché sur `src/agent/loop.ts`. Ce serait un troisième départ à zéro.
3. **Geler les heuristiques de `src/agent/taskState.ts`** (reconnaissance des contrôles, `checkStatus`, `passedAt`). Trois agents l'ont déjà rapiécé ; en réel il n'a jamais rien déclenché. On n'y touche qu'à partir d'un vrai faux « terminé » observé. La règle 4 du prompt système fait le vrai travail.
4. **Ne pas étendre l'ordonnanceur de clés gratuites.** La recommandation est un seul projet Google facturé (Tier 1) ; c'est la décision de l'utilisateur, pas encore prise. Ne pas ajouter de clés ni de logique de contournement.
5. **Pas de nouveau mécanisme** (mémoire vectorielle, essaims d'agents, correspondance floue, méta-réflexion) tant qu'un échec réel ne le justifie pas.

### B. Ce qui est livré

| Mesure du plan | Fichiers | Comportement |
|---|---|---|
| 6 — Masquage récupérable des vieilles sorties d'outils | `src/agent/contextPruning.ts` (fonction pure `pruneToolOutputs`), `GeminiAgentSession.pruneHistory` (`src/agent/gemini.ts`), `AgentLoop.pruneContext` appelé avant chaque `sendUserMessage` et `sendToolResponses` (`src/agent/loop.ts`), même chose dans `src/agent/subagent.ts` | Les 3 derniers lots de résultats d'outils restent intacts. Au-delà, dès que les sorties anciennes de plus de 1 500 caractères pèsent ensemble 40 000 caractères, **toutes** sont remplacées d'un coup par un marqueur `[Cleared from context to save space: the output of read_file(src/x.ts) (N lines, N characters). …]` suivi de la première ligne. Un seul changement de préfixe à la fois, pour que le cache implicite tienne. Les sorties de commandes sont écrites dans `~/.fuller/projects/<projet>/outputs/<session>/context/ctx-<tour>-<part>.txt` (mode 600) ; pour `read_file` et `outline_file`, le marqueur dit de relire le fichier. Les parties `functionCall`, les identifiants et les `thoughtSignature` ne sont pas touchés ; seul `response.output` change. Jamais sous un flux en cours (`streaming > 0` → rien). Compteurs `usage.prunedOutputs` / `prunedChars` (`/stats` → « Cleared tool output », `pruned_outputs` / `pruned_chars` dans le JSON de `-p`). Réglage `contextPruning` (défaut `true`, `/config` → « Clear old tool output »). |
| 11 — Contrôle syntaxique après édition | `src/tools/syntaxCheck.ts`, cas `write_file` et `edit_file` de `src/tools/registry.ts` ; `editFile` renvoie maintenant `updated` | JSON par `JSON.parse` ; JSON à commentaires accepté **seulement** pour `tsconfig*.json`, `jsconfig*.json`, `.vscode/*.json`, `*.jsonc`, `devcontainer.json` (un `package.json` avec virgule finale est bien signalé) ; JS/TS/TSX par `ts.transpileModule` avec le TypeScript **de Fuller** (`loadTypeScript()` exporté par `src/tools/outline.ts`, jamais celui du projet) ; Python par `ast.parse` dans un `python3` séparé (5 s, absent → pas de verdict). Première erreur de catégorie Error, avec ligne et colonne, ajoutée au résultat : `Warning: the file now has a syntax error at line 42, column 3: …. Fix it before moving on.` ; le résumé de la ligne d'outil reçoit ` · syntax error`. Le fichier est écrit tel quel, pas de restauration. Les erreurs de typage ne sont pas regardées. |
| 8 — Erreurs d'édition utiles | `src/tools/fileOps.ts` (`previewEdit`, `hasPlaceholder`, `looseMatches`, `candidateLines`, `reindent`) | Ordre : texte exact ; sinon correspondance ligne à ligne avec `trim()` sur chaque ligne, appliquée **seulement si unique** et sans `replace_all`, remplacement ré-indenté (le préfixe d'indentation de la première ligne cible est remplacé par celui du fichier) ; plusieurs correspondances lâches → erreur qui nomme les lignes ; aucune → erreur qui liste jusqu'à 5 lignes ressemblant à la première ligne cible. Un `replacement_content` contenant une ligne de remplissage (`// ... rest of the code`, `# ... existing code ...`, regex `PLACEHOLDER_LINE`) est refusé avant toute écriture. Messages en anglais (l'ancien « sont identiques » corrigé). Pas de correspondance floue, décision maintenue. |
| Réflexion | `src/agent/thinking.ts` | `defaultThinkingLevel` : Flash 3.5 à 3.8 → `high` (était `medium`). Flash-Lite reste `minimal`. Un `thinkingLevel` déjà enregistré dans `~/.fuller/settings.json` (celui de l'utilisateur vaut `medium`) garde sa valeur : `/model` ou `/effort` pour changer. |
| Prompt système | `src/agent/systemPrompt.ts`, règle 6 | Dit au modèle que les vieilles sorties sont effacées (relire, ne pas deviner) et qu'une erreur de syntaxe signalée après une édition se corrige tout de suite. |
| Documentation | `README.md` (section « Mémoire, garde-fous et banc d'essai »), `reports/plan-efficacite-agent.md` (« État au 25/09 ») | |

Tests ajoutés : `tests/contextPruning.test.ts` (fonction pure, appels parallèles, réponses sans identifiant, session réelle hors ligne, seuil), `tests/syntaxCheck.test.ts`, `tests/fileOps.test.ts` (dont le retour de syntaxe via `dispatchTool`). Adaptés au nouveau défaut `high` : `tests/overlays.test.tsx`, `scripts/tui-smoke.py` (le sélecteur de modèle : ← depuis high donne medium ; `/model gemini-3.8-flash` enregistre `high`). Le faux `GeminiAgentSession` de `tests/loop.test.ts` a une méthode `pruneHistory` vide : à garder si vous ajoutez des méthodes à la session.

### C. Vérifications faites

- `npm run typecheck`, `npm test` (64 fichiers, **480 tests**), `npm run build`.
- `node scripts/eval.mjs --baseline` 8/8 et `--verify-solutions` 8/8 (gratuits).
- `python3 scripts/tui-smoke.py` 11/11 (après les deux ajustements du script).
- **Banc réel**, Gemini 3.6 Flash, `--only add-cli-flag,fix-off-by-one` : 2/2, 88 956 tokens, 18 appels d'outils, `evals/results/2026-09-25-10-53-gemini-3.6-flash.json` (fichier non commité).
- **Session réelle** (`fuller --model gemini-3.8-flash -p …`, six `read_file` successifs sur `loop.ts`, `gemini.ts`, `App.tsx`, `InputBox.tsx`, `commands.ts`, `registry.ts`) : 7 appels, 350 634 tokens de prompt dont **192 102 servis par le cache (55 %)**, **1 sortie effacée** (`loop.ts`, 85 042 caractères) avant la cinquième requête, réponse finale correcte. Un premier essai sur 3.6 Flash s'est arrêté sur 503 (surcharge) après 2 appels : en `-p`, la politique `ask` ne peut pas demander, donc le tour s'arrête ; ce n'est pas un défaut du masquage.
- `--check-keys` du matin : 15 clés répondent, 6 en 403 « denied ».

Le **« cache 0 % » du 24/09 est faux en usage réel** : il venait des tâches courtes du banc (moins de 4 096 tokens par appel). Sur une vraie session, le cache implicite fonctionne dès le deuxième appel. Ne plus chercher à « réparer » le cache.

### D. Ce qui n'est pas vérifié — à ne pas présenter comme acquis

- **L'effet sur le taux de réussite** des quatre mesures n'est pas mesuré : le banc ne le peut pas, il faut des sessions réelles longues. Les gains cités (+29 % / −84 % chez Anthropic, 20 % → 6 % chez Gemini CLI) restent ceux des autres produits.
- Les seuils (3 lots gardés, 1 500 et 40 000 caractères, première ligne gardée) sont des choix raisonnables, pas des valeurs mesurées sur Fuller.
- Sur la session réelle, seule la première sortie a été effacée : les rounds 2 et 3 (`gemini.ts`, `App.tsx`) pesaient moins de 40 000 caractères ensemble au moment du dernier appel. C'est le comportement voulu (peu de changements de préfixe), pas un oubli.
- La ré-indentation d'un remplacement lâche n'a été vue que dans les tests unitaires ; le contrôle Python seulement avec `python3` présent (le test passe sans verdict si `python3` manque).
- Le masquage dans les sous-agents (`subagent.ts`) n'écrit rien sur disque (pas de `saveDir`) : le marqueur dit de relancer l'appel. Non observé en réel.

### E. Suite conseillée

1. **Utiliser Fuller sur Fuller** pour de vrai (sessions longues, modifications multi-fichiers). Chaque échec observé devient une tâche dans `evals/tasks/` avec sa `solution.patch`. C'est le seul banc qui compte.
2. Après quelques sessions réelles, lire `/stats` (cache, sorties effacées) et les marqueurs `[Cleared from context …]` dans `~/.fuller/projects/…` : si le modèle relit trop souvent ce qui a été effacé, monter `keepRounds` ; s'il ne relit jamais, baisser `triggerChars`.
3. Reste du lot 3 non fait : résumé structuré à la compaction et notes de mémoire avec provenance. Reste du lot 4 : carte du dépôt. À ne faire qu'après un échec réel qui les justifie.
4. Ne pas relancer un cycle de rapports croisés : les trois notes d'orientation existent et concordent ; la prochaine note utile est un compte rendu d'usage réel.

**Correctifs après la revue de Codex (C001, `chat/`)**, 11:10 UTC : une sortie de commande, de sous-agent ou d'outil MCP n'est effacée du contexte que si elle est archivée sur disque ; sans archive elle reste (plus jamais « Run it again »). Les sous-agents reçoivent un `contextDir` (`outputs/<session>/context/<id d'appel>/`). Le contrôle de syntaxe est différentiel : une erreur déjà présente avant l'édition, au même message, n'est pas reprochée à l'édition (`newSyntaxWarning`, `src/tools/registry.ts`). 482 tests. Les échanges entre agents sont dans `chat/` (convention de Codex, un fichier par message, heure UTC).

## 14. Session longue réelle (25/09, 11:16–11:58 UTC) — deux défauts corrigés

Compte rendu complet : `chat/2026-09-25_120500_claude_compte_rendu_session_longue.md` (K003) ; pièces dans `reports/usage/2026-09-25-session-longue/`. Copie isolée, Gemini 3.8 Flash `high`, tâche réelle (script de statistiques de session + test), Ctrl+C à 75 s, « Continue », `--continue`. Résultat vérifié : fichiers écrits, typecheck propre, test 1/1, réponse de mémoire exacte après reprise. 70 appels d'outils, 1,93 M tokens, 20 sorties effacées (82 310 caractères), aucun 400.

- **Défaut 1, corrigé** : l'historique curé du SDK découpe un tour du modèle en `[functionCall]` puis `[text]` ; `sanitizeHistory()` ne regardait que le contenu précédent et laissait un appel sans réponse quand l'interruption tombait entre le texte et la réponse (reproduit hors ligne sur l'historique réel). Groupe de contenus `model` jugé en bloc (`modelGroupStart`, `src/agent/gemini.ts`). Test : `tests/geminiRobustness.test.ts`.
- **Défaut 2, corrigé** : `findCall()` du masquage, même cause ; marqueurs sans nom d'appel, lectures archivées pour rien. `src/agent/contextPruning.ts`, test dans `tests/contextPruning.test.ts`.
- **À décider (utilisateur)** : `maxTurns` = 50 atteint sur une tâche légitime de 70 appels ; Claude Code n'a pas de plafond.
- **Non mesuré** : le cache implicite sur cette session (pilote à corriger : onglet Usage de `/status`).
- Vérifications : typage, 484 tests, build, `dist/` reconstruit.

## 15. Deuxième tâche réelle (25/09, 12:35–13:30 UTC) — test intermittent du sélecteur de sessions

Compte rendu : `chat/2026-09-25_133500_claude_compte_rendu_session_picker.md` (K005) ; pièces dans `reports/usage/2026-09-25-tache-session-picker/`. Dans le vrai dépôt, Fuller a **reproduit** l'échec de `tests/sessionPicker.test.tsx` sous charge (9e appel), l'a attribué aux attentes fixes avant assertion, a enveloppé les assertions des trois tests interactifs dans `vi.waitFor` (composant intact), puis vérifié 10/10 et 2 suites complètes ; vérifié à nouveau par moi (3/3, 484/484). 38 appels d'outils, 791 270 tokens, **cache implicite 69 %**, 9 sorties effacées (~10 200 tokens). Trois relances du pilote (fenêtre de confiance, 503 pris pour une fin de tour, fenêtre de bascule « demander » sans humain) : aucune due à Fuller. Incident Fuller : `todo_write` refusé deux fois, le modèle ayant envoyé le texte du résultat précédent comme arguments ; refus propre, corrigé au coup suivant.

## 16. Troisième tâche réelle (25/09, 13:47–14:10 UTC) — dossiers temporaires des tests ; masquage par budget

Compte rendu : `chat/2026-09-25_145500_claude_compte_rendu_tmp.md` (K006). Fuller a mesuré (+176 dossiers `/tmp` par passage de la suite) et corrigé huit fichiers de tests (+144 ensuite), puis s'est arrêté sur une erreur réseau après 125 appels et 2,7 M tokens, descendu jusqu'à 3.5 Flash-Lite. **Il a tourné en rond** : un fichier lu 12 fois, une requête 6 fois, deux plafonds `maxTurns`. Cause : le masquage à trois lots ne laissait au modèle que ses trois derniers résultats sur une tâche en éventail. Corrigé par un **budget d'ensemble de travail** (200 000 caractères, `PRUNING.budgetChars`). Aussi : message d'erreur de `todo_write` avec exemple (deuxième cas, 3.8 Flash) ; **le sélecteur de sessions échouait encore 3 fois sur 7** malgré K005 (touches perdues avant l'attache de l'écouteur, `useRawInput`) : sonde de saisie avant le scénario, 4 suites complètes au vert. Reste : `tests/loop.test.ts` et les autres préfixes.

## 17. Quatrième tâche réelle (25/09, 14:50–15:14 UTC) — nettoyage terminé, comparaison des masquages

Compte rendu : `chat/2026-09-25_153000_claude_compte_rendu_tmp_2.md` (K007). Avec le masquage par budget, Fuller a fini le nettoyage (15 fichiers, `tests/loop.test.ts` en tête) : **0 dossier `/tmp` ajouté** sur deux suites complètes, vérifié par moi. Comparaison à forme de tâche égale : le budget supprime le tourbillon (fichier le plus relu : 2 fois contre 12) mais laisse grossir le contexte (dernière requête 125 757 tokens, 12,4 M tokens de prompt à 88 % de cache contre 2,7 M à 64 %) ; gardé. Fait nouveau traité : `search_files` signale une requête à caractères d'expression régulière cherchée littéralement (vingt appels perdus en une session). Trois plafonds `maxTurns` sur un besoin réel de 150 appels : la question est désormais « faut-il un plafond ? ».

## 18. Fin de journée du 25/09 — ce qu'il faut savoir pour reprendre

Pour Codex, Antigravity et les suivants. Dépôt à `aeb9c0f` (15 commits depuis `6f78c5d`), arbre propre, **non poussé** depuis `fd13a05`. Les échanges du jour sont dans `chat/` (19 fichiers, index dans `chat/README.md`) ; les comptes rendus des quatre sessions réelles sont K003, K005, K006, K007.

### A. Ce qui a changé dans l'agent aujourd'hui (tout vérifié : typage, 486 tests, build, fumée PTY)

| Changement | Fichier | Origine |
|---|---|---|
| Masquage des vieilles sorties d'outils, **par budget d'ensemble de travail** : 3 derniers lots + sorties récentes jusqu'à 200 000 caractères ; au-delà, effacement par lots de 40 000 ; sorties de commandes archivées sur disque, jamais effacées sans archive ; sous-agents avec `contextDir` | `src/agent/contextPruning.ts`, `pruneHistory` dans `gemini.ts`, `pruneContext` dans `loop.ts` | Lots 3 ; C001 (archive) ; K006/K007 (budget) |
| Historique : un tour du modèle découpé par le SDK en `[functionCall]` puis `[text]` est traité en bloc | `sanitizeHistory`, `modelGroupStart`, `findCall` | K003 (défaut réel, 400 possible après interruption) |
| Contrôle de syntaxe différentiel après `write_file`/`edit_file` (JSON, JSONC nommés, JS/TS, Python) | `src/tools/syntaxCheck.ts`, `newSyntaxWarning` dans `registry.ts` | Lot 4 ; C001 (différentiel) |
| `edit_file` : correspondance sans indentation ni espaces de fin si unique, lignes candidates, refus des remplacements à trous | `src/tools/fileOps.ts` | Lot 4 |
| Réflexion `high` par défaut pour les Flash | `src/agent/thinking.ts` | Choix de l'équipe |
| `todo_write` : message de refus avec exemple | `src/tools/registry.ts` | 2 cas réels (K005, K006) |
| `search_files` : indice quand une requête à caractères regex est cherchée littéralement et ne trouve rien | `src/tools/search.ts` | ~20 appels perdus (K007) |
| Prompt système : règle 6 (sorties effacées, erreur de syntaxe à corriger tout de suite) | `src/agent/systemPrompt.ts` | |

Tests : `tests/contextPruning.test.ts`, `tests/syntaxCheck.test.ts`, `tests/fileOps.test.ts`, cas ajoutés dans `geminiRobustness`, `search`, `overlays`. Le faux `GeminiAgentSession` de `tests/loop.test.ts` a `pruneHistory`.

### B. Ce que les sessions réelles ont appris, et qu'aucun rapport n'aurait donné

1. **Le banc ne voit rien de tout ça.** Quatre défauts de fonctionnement en quatre sessions (historique découpé, tourbillon du masquage, écouteur Ink attaché après le premier rendu, recherche littérale prise pour une regex). Le banc de 8 tâches était à 100 % avant et après.
2. **Le cache implicite fonctionne** dès qu'une session s'installe : 55 %, 69 %, 64 %, 88 %. Le « 0 % » du 24/09 venait des tâches courtes du banc.
3. **Le masquage a besoin d'un ensemble de travail.** Trois lots gardés → un fichier lu 12 fois, 2,7 M tokens pour 8 fichiers. Budget de 200 k caractères → fichier le plus relu 2 fois, 15 fichiers, mais contexte non élagué (125 k tokens par requête en fin de session, 12,4 M tokens à 88 % de cache). Gardé ; à revoir seulement si la qualité en souffre, pas pour le seul coût.
4. **`maxTurns` = 50** a été atteint 6 fois sur des besoins réels (70 puis 150 appels). Ce n'est plus « faut-il relever ? » mais « faut-il un plafond ? ». Décision de l'utilisateur, non prise.
5. **Piloter Fuller sans humain** demande : dossier approuvé d'avance (`trusted-folders.json`), `modelFallback: auto` (sinon la fenêtre « changer de modèle ? » bloque sans fin), lecture du pied de page pour distinguer occupé/libre (« esc to interrupt »), Échap avant `/exit` si une boîte est ouverte, et **jamais le mode « bypass »** : en K007 le modèle a supprimé un dossier `/tmp` préexistant malgré la consigne (C006). Mode `auto` ou `acceptEdits` avec `--allowedTools` limité aux commandes de vérification, et espace isolé quand le vrai dépôt n'est pas nécessaire. Le pilote qui fait tout ça : `reports/usage/2026-09-25-tache-tmp/pilote-task2.py` (copie de `task2.py`) ; consignes dans `consigne*.txt`.
6. **Le modèle** (3.6 à 3.8 Flash) lit par tranches de 20 à 60 lignes, relance une recherche sans résultat sans changer d'approche, et a deux fois renvoyé le texte d'un résultat comme arguments d'outil. Chaque cas a reçu une réponse dans l'outil, pas dans le prompt.
7. **Quota** : le jour gratuit de 3.8 Flash est parti à 14:20 UTC sur les 15 clés (≈ 20 M tokens de prompt sur la journée, cache compris). Les sessions suivantes ont tourné sur 3.6 et 3.7. La remise à zéro est à 07:00 UTC.

### C. Tâches livrées par Fuller lui-même (vérifiées par moi)

- `tests/sessionPicker.test.tsx` : test intermittent reproduit sous charge puis corrigé (K005), complété par la sonde de saisie (K006) après trois nouveaux échecs. 4 suites complètes de suite au vert.
- La suite ne laisse plus de dossiers temporaires dans `/tmp` (K006 + K007) : 23 fichiers de tests, 0 dossier par passage sur 2 suites.

### D. Règles de travail confirmées à trois (C001 à C005, A001 à A005, K001 à K007)

Moteur conservé ; `taskState.ts` gelé ; pas de nouveau mécanisme sans échec réel (les cinq changements d'aujourd'hui ont chacun un ou deux cas réels cités) ; pas de campagne préventive ; gains d'autres produits = hypothèses ; un accord entre agents n'autorise ni commit, ni quota, ni facturation ; le prochain message utile est un compte rendu d'usage, pas une note d'orientation. Avant d'écrire une réponse, relire les messages postés après celui auquel on répond (deux réponses se sont croisées le matin).

### E. Ouvert

- Décision `maxTurns` (utilisateur) ; depuis C006, le plafond demande un état des lieux au lieu de s'arrêter en silence (`loop.ts`), non observé en réel.
- 5 225 dossiers `fuller-*` déjà dans `/tmp`, à supprimer à la main (aucun test ne les utilise).
- Les autres tests Ink qui tapent après un simple `setImmediate` : candidats si un nouvel échec les désigne, pas avant.
- La comparaison des seuils du budget de masquage : deux sessions, pas plus. Ne pas retoucher sans une troisième qui montre un problème de qualité.
- Pousser : `git push origin main` (7 commits en attente).
