# 3c — Réglages, raccourcis et commandes inconnues

Référence : Claude Code 2.1.281, captures du 24/09/2026 à 120×30, sessions lancées une par une. Captures : `captures/3c-*.json`.

## Écarts et corrections

| Point | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| `/effort` | Fenêtre « Effort » : piste Faster → Smarter, ▲ sur le niveau choisi, niveaux espacés de 5 colonnes, filet couleur permission, titre en gras | Absente | Même fenêtre avec les niveaux Gemini (minimal, low, medium, high) ; ←/→, Entrée enregistre par défaut, `s` pour la session seulement, Échap annule |
| `/effort <niveau>` | Change le niveau directement | Absent | Idem |
| Ligne au-dessus de la saisie | `◐ medium · /effort` | Renvoyait à `/model` | Comme Claude Code |
| `/keybindings` | Ouvre `keybindings.json` dans l'éditeur | Absente | Crée le fichier (modèle commenté) dans le dossier de configuration et l'ouvre dans `$VISUAL`/`$EDITOR` |
| Aide `?` | « /keybindings to customize » | Absent | Ajouté |
| Alias | `/reset`, `/new` (clear), `/allowed-tools` (permissions), `/cost` (usage)… | Absents | Ajoutés, plus `/checkup` (doctor) |
| Descriptions du menu `/` | En anglais, formulation Claude Code | Français et formulations maison | Reprises en anglais |
| Commande inconnue | `● Unknown command: /foo` en jaune (#ffc107) | ``⎿  Unknown command: `/foo`. Type `/help` for the list.`` | Comme Claude Code (nouveau type de message `warning`) |
| `/version` | N'existe pas (« Unknown command ») | Absente | Non ajoutée |

## Vérifications

- `npm run typecheck`, `npm test` (39 fichiers, 241 tests), `npm run build` : OK.
- Suites PTY : permission 6/6, auth 10/10, smoke 11/11.
