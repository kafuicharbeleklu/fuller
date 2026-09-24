# 3a — Commandes qui ouvrent une fenêtre ou affichent un état

Référence : Claude Code 2.1.281, [liste officielle des commandes](https://code.claude.com/docs/en/commands) et captures du 24/09/2026 à 100×34. Les captures de Claude Code (qui montrent le compte, l'usage et les serveurs MCP de l'utilisateur) sont restées hors du dépôt. Captures de Fuller : `captures/3a-fuller-*.json` (avant) et `captures/3a-fuller-after-*.json` (après).

## Incident pendant les captures

Onze sessions Claude Code lancées presque en même temps ont été comptées comme des démarrages ratés du plein écran, et Claude Code a écrit `fullscreenAutoDisabled` dans `~/.claude.json`. Réparé avec `/tui fullscreen` (réglage `tui: "fullscreen"`), vérifié ensuite. Les sessions Claude Code sont désormais lancées une par une.

## Sorties de commande

Claude Code affiche la sortie d'une commande sous la commande, précédée de `⎿`. Fuller l'affichait comme une réponse, avec `●`. C'est aligné pour toutes les commandes qui écrivent du texte.

## Écarts et corrections

| Commande | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| `/help` | Fenêtre « Help » à onglets General, Commands, Custom commands (bleu `#6a9bcc`) ; grille des raccourcis | Longue liste en texte | Même fenêtre ; General renvoie au README |
| `/status` | Fenêtre « Settings » (Status, Config, Usage, Stats) ; clés en gras sur 19 colonnes | Liste à puces | Fenêtre Settings, onglets Status et Usage |
| `/usage` (alias `/cost`) | Onglet Usage de Settings | `/cost` (alias `/usage`), liste à puces | `/usage` principale, `/cost` alias ; onglet Usage |
| `/context` | Grille de 10×20 cases (⛀ ⛁ ⛶ ⛝), catégories en couleur à droite, `26.1k/1m tokens` | Liste à puces | Même grille et même format de nombres |
| `/permissions` | Fenêtre à onglets (Recently denied, Allow, Ask, Deny, Auto mode, Workspace), recherche, « 1. Add a new rule… » | Liste en texte, sous-commandes | Fenêtre à onglets Allow, Deny, Workspace ; ajout en ligne, suppression après confirmation ; sous-commandes gardées |
| `/memory` | Fenêtre « Memory » : User instructions, Project instructions ; Entrée ouvre le fichier | Message en texte | Même fenêtre ; Entrée ouvre le fichier dans l'éditeur (VS Code s'il est installé), en le créant |
| `/agents` | Message : l'assistant de création a été retiré, demander à Claude ou éditer `.claude/agents/` | Liste des agents | Même message, plus la liste des agents disponibles |
| `/mcp` | Fenêtre : nombre de serveurs, `✔`/`⚠`/`◯`, nombre d'outils | Texte avec exemple JSON | Fenêtre « Manage MCP servers » |
| `/hooks` | Fenêtre en lecture seule : nombre de hooks, événements numérotés et décrits | Texte avec exemple JSON | Même fenêtre ; Entrée affiche les hooks de l'événement |
| `/tasks` | Fenêtre « Background » (« No tasks currently running ») | Message en texte | Même fenêtre ; `/tasks kill <id>` gardé |
| `/doctor` | Contrôle mené par le modèle (une requête) | Vérifications locales | Inchangé : pas de requête nécessaire |

Les fenêtres affichent l'effort dans leur filet du haut, comme chez Claude Code.

Fichiers : nouveaux `src/ui/TabbedDialog.tsx`, `src/ui/InfoDialogs.tsx`, `src/ui/PermissionsDialog.tsx`, `src/ui/ContextView.tsx` ; `src/ui/commands.ts`, `src/ui/App.tsx`, `src/ui/OverlayFrame.tsx`, `src/ui/ShortcutsHelp.tsx`, `src/ui/Transcript.tsx`, `src/ui/viewerText.ts`, `src/agent/loop.ts` (`sessionName`), `src/agent/types.ts` (message `context`). Tests : nouveau `tests/infoDialogs.test.tsx`.

## Écarts restants

- `/permissions` : pas de champ de recherche ; pas d'onglets Recently denied, Ask et Auto mode (Fuller n'a ni règles « ask » ni mode auto).
- Settings : pas d'onglets Config et Stats.
- `/mcp` : pas d'état « needs authentication » (Fuller ne gère pas l'OAuth MCP).
- Descriptions des commandes toujours en français (point déjà listé).

## Référence du nom

À la demande de l'équipe, l'hommage vise Thomas Fuller (vers 1710–1790), « the Virginia Calculator ». Le code, le README et `/about` citaient le médecin de la *Gnomologia* (1654–1734), et un logo Buckminster Fuller ; c'est corrigé, et les proverbes de la *Gnomologia* ont été retirés de `/about`.
