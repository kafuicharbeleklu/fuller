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
