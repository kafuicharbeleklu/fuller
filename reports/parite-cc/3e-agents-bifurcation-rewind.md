# 3e — /btw « f to fork », vue des agents (←), segments colorés, /theme et /rewind

Référence : Claude Code 2.1.281, captures du 24/09/2026 à 100×30, sessions lancées une par une. Côté Fuller, essais réels avec Gemini 3.6 Flash (quota de 3.7 Flash épuisé ce jour-là). Captures : `captures/3e-*.json`.

## /btw puis f

| Point | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| Aide du panneau | `↑/↓ to scroll · c to copy · f to fork · Esc to close` | Sans `f to fork` | Comme Claude Code |
| f | Lance un agent en arrière-plan qui hérite de la conversation : `⎿  ⑂ forked reply-with-the (d853)` | — | Comme Claude Code (sous-agent general-purpose, historique de la conversation) |
| Fin | `● Agent "…" finished · 2s` (● vert, durée grise), puis le modèle principal répond au rapport | — | Comme Claude Code : le rapport est remis au modèle sans apparaître comme prompt ; s'il travaille, le rapport part avec le tour suivant |

## Vue des agents (← sur un prompt vide)

| Point | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| Pied de page | `← for agents` | `/agents for agents` | Comme Claude Code |
| Vue | Bannière « modèle · dossier » puis « 1 awaiting input · 0 working · 1 completed » ; « Your conversation moved to the background — enter opens it · esc returns to it · ctrl+c twice quits » ; groupes Needs input / Working / Completed ; ligne choisie sur fond `#373737` ; champ « describe a task for a new session » | — | Même présentation |
| Lignes | `✻ current session  dossier  0s` ; terminés : `∙` vert, titre, dernière ligne du résultat, âge | — | Idem ; en cours : glyphe du spinner et dernière étape |
| Touches | Entrée ouvre, Échap revient, ctrl+x supprime, espace pour répondre | — | Entrée revient (conversation) ou ouvre le rapport d'un agent, Échap ou → revient, ctrl+x arrête et supprime, ctrl+c deux fois quitte ; un texte tapé lance un nouvel agent (contexte vierge) |

Portée : chez Claude Code, la vue liste aussi les autres sessions de la machine et permet d'y répondre (espace). Les agents de Fuller sont ceux lancés par `/btw` puis `f` et depuis cette vue ; il n'y a pas de sessions parallèles à reprendre.

## Messages système colorés

- Les messages peuvent contenir des segments `{{couleur:texte}}` (couleurs du thème), retirés dans les exports et la vue ctrl+o.
- `/model` : le modèle et le niveau d'effort en couleur permission, comme chez Claude Code (« Set model to **Gemini 3.5 Flash** … with **high** effort »).
- Les commandes reprises dans la conversation (`/model`, `/btw …`) sont en blanc `#ffffff`, comme chez Claude Code, et non plus en gris ; le texte des prompts passe aussi de la couleur de palette « white » à `#ffffff` dans le thème sombre.

## /theme

| Point | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| Sous-titre | Gras, couleur normale | Gris | Comme Claude Code |
| Thème actuel | Vert avec ✔, même sous le curseur | Couleur permission | Comme Claude Code |
| Autres thèmes | Couleur normale du terminal | Blanc | Comme Claude Code (toutes les listes à numéros) |
| Aperçu | Entre deux lignes `╌` `#505050`, code en colonne 4 | Filets `─` grisés, lignes tronquées par `…` | Comme Claude Code |

Écarts voulus : Fuller propose ses thèmes en plus (Monokai, Ocean…) et n'a pas « New custom theme… » ; la ligne du bas dit « Syntax highlighting enabled » (Fuller n'a pas de noms de thèmes syntaxiques).

## /rewind

| Point | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| Liste | « Restore the code and/or conversation to the point before… », prompts du plus ancien au plus récent, chacun suivi de « No code changes », « (current) » sélectionné en bas, `↑/↓ N more above/below` | « Bash changes are not tracked. », plus récent en haut, heure à droite | Comme Claude Code (« N files changed » quand le tour a modifié des fichiers) |
| Confirmation | Prompt cité (`│`) et âge, « The conversation will be forked. », « The code will be unchanged. », 1. Restore conversation · 2. Summarize from here · 3. Summarize up to here · 4. Never mind, sans ligne d'aide | Liste de 5 actions | Comme Claude Code ; avec des fichiers modifiés, « Restore code and conversation » et « Restore code » s'ajoutent |
| Bifurcation | La conversation d'avant reste disponible | Tronquée sur place | Une copie de la session est enregistrée avant le retour en arrière (visible dans `/resume`) |

## Vérifications

- `npm run typecheck`, `npm test` (43 fichiers, 252 tests), `npm run build` : OK.
- Suites PTY : permission 6/6, auth 10/10, smoke 11/11.
