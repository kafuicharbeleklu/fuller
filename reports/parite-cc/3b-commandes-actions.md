# 3b — Commandes qui agissent

Référence : Claude Code 2.1.281, captures du 24/09/2026 à 100×30 dans un dépôt git temporaire, sessions lancées une par une (aucune désactivation du plein écran). `/btw` : une requête de chaque côté (Gemini 3.7 Flash pour Fuller). `/init` n'a pas été comparé : chez les deux, c'est une analyse du projet par le modèle. Captures : `captures/3b-*.json`.

## Écarts et corrections

| Commande | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| `/clear` | Vide la conversation | Idem | Inchangé |
| `/compact` (conversation vide) | `⎿  Error: No messages to compact` en rouge | `⎿  Nothing to compact yet.` | Comme Claude Code |
| `/copy` (aucune réponse) | `⎿  No assistant message to copy` | `⎿  Nothing to copy yet.` | Comme Claude Code |
| `/export` | Fenêtre « Export conversation » : 1. Copy to clipboard, 2. Save to file | Enregistrement direct dans un fichier | Même fenêtre ; `/export <fichier>` enregistre toujours directement |
| `/add-dir` | Fenêtre « Add directory to workspace », champ encadré, Tab pour compléter | `Usage: /add-dir <path>` | Même fenêtre, complétion des dossiers par Tab ; `/add-dir <chemin>` inchangé |
| `/plan` | `⎿  Enabled plan mode` | Mode changé sans message | `Enabled plan mode` / `Disabled plan mode` |
| `/rewind` (rien à restaurer) | « Rewind », « Nothing to rewind to yet. », « Esc to cancel » | « Rewind — choose a prompt », « No conversation checkpoints yet. Press Esc to close. » et la ligne de navigation | Comme Claude Code |
| `/btw` | Panneau au-dessus de la saisie : `/btw` en jaune et la question, `✻ Answering…`, la réponse ; « ↑/↓ to scroll · c to copy · f to fork · Esc to close » ; rien n'est ajouté à la conversation | Question et réponse inscrites dans la conversation ; sans le contexte de la session ; Échap interrompait | Même panneau ; la réponse tient compte de la conversation ; Échap ferme (et annule une réponse en cours) |
| `/exit` | Quitte | Quitte en rappelant `fuller --continue` | Inchangé |
| `/diff` | Panneau à côté de la conversation (110 colonnes au moins) | Visionneuse plein écran | Inchangé (voir « Restant ») |

La couleur d'avertissement du thème sombre passe à `#ffc107`, celle de Claude Code (`/btw`, alertes).

Fichiers : `src/ui/BtwPanel.tsx` (nouveau), `src/ui/InfoDialogs.tsx` (`InputDialog`, `completeDirectory`), `src/ui/RewindMenu.tsx`, `src/ui/commands.ts`, `src/ui/App.tsx`, `src/ui/theme.tsx`, `src/agent/loop.ts` (`askAside`), `src/agent/gemini.ts` (`oneShot` avec l'historique). Tests : `tests/infoDialogs.test.tsx`.

## Restant

- `/diff` : le panneau latéral de Claude Code n'existe pas dans Fuller.
- `/btw` : pas de « f to fork ».
- `/rewind` avec des points de reprise : à comparer (il faut une conversation, donc des requêtes).
