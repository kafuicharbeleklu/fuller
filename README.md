# Fuller ✻

> Agent de programmation en interface terminal (TUI) inspiré de **Claude Code**, construit avec **React / Ink** et l'API **Google Gemini**.
> Nommé en hommage à **Thomas Fuller** (1654–1734), compilateur de la *Gnomologia* — « All things are difficult before they are easy. »

---

## Démarrage rapide

```bash
npm install
cp .env.example .env        # puis renseignez GEMINI_API_KEY (https://aistudio.google.com/apikey)
npm run dev                 # mode développement (tsx)
npm run build && npm link   # installe la commande globale `fuller`
```

```bash
fuller                                   # session interactive dans le dossier courant
fuller "explique l'architecture"         # avec un premier prompt
fuller -c                                # reprend la dernière session du projet
fuller -r                                # sélecteur de sessions
fuller -p "corrige les tests" --output-format json      # mode headless (CI, scripts)
echo "résume ce dépôt" | fuller -p --output-format stream-json
fuller --permission-mode acceptEdits     # default | acceptEdits | plan | bypassPermissions
fuller --allowedTools "Bash(npm test:*)" "Edit(src/**)"
fuller --add-dir ../lib -m gemini-3.8-flash --theme light
fuller --list-models                     # modèles récents et gratuits accessibles à votre clé
fuller --list-models --all               # tous les modèles texte (y compris payants / anciens)
```

### Modèles

Le modèle par défaut vient de `-m`, puis de `GEMINI_MODEL`, puis de `"model"` dans `settings.json` (`gemini-3.6-flash` sinon). `fuller --list-models` et `/model` (sélecteur interactif, ou `/model list`) interrogent l'API `ListModels` et ne proposent par défaut que les modèles **récents (génération ≥ 3.5) et gratuits** : `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`. Touche `a` dans le sélecteur, `/model list all` ou `--all` pour voir tous les modèles texte (les modèles sans free tier, comme `gemini-3.1-pro-preview`, sont signalés). L'API ne renseigne pas la gratuité : la liste vient de la page officielle des prix (vérifiée le 22/09/2026, `FREE_TIER_MODELS` dans `src/agent/models.ts`). La fenêtre de contexte du modèle règle automatiquement la jauge et l'auto-compaction ; le changement de modèle conserve l'historique. Chaque modèle a son propre quota : en cas de `429`, changez de modèle.

## Ce que fait Fuller

- **Boucle agent complète** : streaming, appels d'outils parallèles (réponses groupées), retry/backoff sur 429/5xx, interruption réelle (`AbortSignal` transmis au SDK et aux processus), file d'attente des prompts saisis pendant un tour.
- **Rendu sans scintillement** : historique figé dans `<Static>` (scrollback natif), zone dynamique bornée à la hauteur du terminal, chunks de streaming regroupés (50 ms), sortie synchronisée DEC 2026.
- **Transcript style Claude Code** : `⏺` pour les réponses, `⏺ Bash(npm test)` + `⎿` pour les outils, repli `… +N lines (ctrl+o to expand)`, Markdown rendu (titres, listes, tableaux, code coloré), diffs réels avec numéros de ligne.
- **Permissions** : classification des commandes bash (lecture / édition / exécution / danger) par analyse des segments (`&&`, `|`, `$(…)`, redirections), prompt à 3 options (`Yes` / `Yes, and don't ask again for …` / `No, and tell Fuller what to do differently`), règles persistées `Tool(spec)` dans `.fuller/settings.local.json`, modes `default → acceptEdits → plan → bypassPermissions` (Shift+Tab).
- **Sécurité des outils** : confinement des chemins au workspace (symlinks résolus), refus des fichiers sensibles (`.env`, clés, `.git/`), aucune injection shell (`fetch` natif, `fast-glob`), troncature des sorties envoyées au modèle.
- **Sessions réelles** : historique Gemini restauré (`--continue`, `--resume`), `/compact [focus]` qui réduit vraiment le contexte, auto-compaction à 85 %, jauge « Context left until auto-compact ».
- **Mémoire projet** : `FULLER.md` (ou `AGENTS.md`, `GEMINI.md`, `CLAUDE.md`) à la racine et dans les dossiers parents, `~/.fuller/FULLER.md`, `FULLER.local.md`, imports `@chemin`.
- **Saisie** : édition readline (Ctrl+A/E/K/U/W/Y, Alt+B/F, Ctrl+_ undo), collage replié en `[Pasted text #N +L lines]`, `@fichier` avec complétion floue, `!commande` shell, `/` avec menu, historique persistant + Ctrl+R, `\⏎` multi-ligne.
- **Checkpoints** : snapshot des fichiers avant chaque écriture, `Esc Esc` / `/rewind` pour restaurer.
- **Thèmes** : `dark`, `light`, variantes `-daltonized` et `-ansi`, `monokai`, `ocean`, `forest` (`/theme`).

## Commandes personnalisées et skills

Fuller découvre au démarrage (et avec `/skills reload`) :

- `.fuller/commands/*.md` et `.fuller/skills/<nom>/SKILL.md` dans le projet ;
- `~/.fuller/commands/*.md` et `~/.fuller/skills/<nom>/SKILL.md` pour l'utilisateur ;
- en repli, `.claude/commands`, `.claude/skills`, `~/.claude/commands`, `~/.claude/skills` (compatibilité Claude Code).

Un fichier = une commande `/nom` (les sous-dossiers donnent `/dossier:nom`). Frontmatter optionnel : `description`, `argument-hint`, `allowed-tools` (règles `Tool(spec)` autorisées pour ce tour), `disable-model-invocation` (ne pas exposer au modèle), `user-invocable: false` (réservé au modèle). Le corps est envoyé comme prompt après substitution de `$ARGUMENTS`, `$1`…`$9`, exécution des blocs ``!`commande` `` et inclusion des `@fichiers`. Les skills sont listés dans le prompt système et le modèle peut les charger lui-même avec l'outil `skill`. Exemple fourni : `.fuller/commands/revue-diff.md`. En mode headless : `fuller -p "/revue-diff sécurité"`.

## Commandes slash

| Commande | Rôle |
|---|---|
| `/help` | Commandes et raccourcis |
| `/clear` | Nouvelle conversation |
| `/compact [focus]` | Résumer la conversation |
| `/status`, `/cost`, `/context` | État de session, tokens, répartition du contexte |
| `/model [nom\|list]` | Sélecteur de modèles (API ListModels), changement sans perdre l'historique |
| `/permissions [add\|deny\|remove <règle>]` | Gérer les règles |
| `/plan`, `/accept-edits`, `/mode <mode>` | Modes de permission ; en plan mode le modèle explore puis soumet son plan avec `exit_plan_mode` (« Would you like to proceed? » : auto-accept, approbation manuelle, ou retour en planification avec vos remarques ; plan sauvegardé dans `~/.fuller/plans/`) |
| `/init`, `/memory` | Générer / lister les fichiers mémoire |
| `/skills [reload]` | Commandes personnalisées et skills découverts |
| `/hooks` | Hooks configurés |
| `/tasks [kill <id>]` | Tâches en arrière-plan |
| `/mcp` | Serveurs MCP et leurs outils |
| Ctrl+T | Afficher / masquer la liste de tâches (`todo_write`) |
| `/rewind`, `/checkpoints` | Restaurer des fichiers |
| `/sessions`, `/export [fichier]`, `/rename <titre>`, `/copy [N]` | Sessions, export Markdown, renommage, copie de la dernière réponse dans le presse-papiers |
| `/diff`, `/doctor`, `/theme`, `/add-dir`, `/btw`, `/about`, `/exit` | Divers |

## Raccourcis

| Touche | Action |
|---|---|
| `Shift+Tab` | Cycler les modes de permission |
| `Esc` / `Esc Esc` | Interrompre / rewind (ou vider la saisie) |
| `Ctrl+O` | Transcript détaillé (sorties complètes) |
| `Ctrl+C` | Vider la saisie · ×2 quitter · interrompre si occupé |
| `Ctrl+R` | Recherche dans l'historique |
| `Ctrl+L` | Redessiner l'écran |
| `?` (saisie vide) | Aide clavier |
| `!` / `@` / `/` | Shell · fichier · commandes |

## Configuration

- `~/.fuller/settings.json` (utilisateur), `.fuller/settings.json` (projet), `.fuller/settings.local.json` (local, ignoré par git) :

```json
{
  "model": "gemini-3.6-flash",
  "theme": "dark",
  "permissions": {
    "allow": ["Bash(npm test:*)", "Edit(src/**)"],
    "deny": ["Bash(rm -rf:*)", "WebFetch"],
    "defaultMode": "default",
    "additionalDirectories": ["../shared"]
  },
  "autoCompact": true,
  "autoCompactThreshold": 0.85,
  "notifications": "permission",
  "bashTimeoutMs": 120000,
  "maxTurns": 50
}
```

- Status line personnalisée (même JSON que Claude Code sur l'entrée standard : `model.id`, `workspace.current_dir`, `context_window.used_percentage`, `cost.total_tokens`, `permission_mode`…) :

```json
{ "statusLine": { "type": "command", "command": "~/.fuller/statusline.sh", "padding": 1, "refreshInterval": 30 } }
```

  Exemple de script : `jq -r '"\(.model.id) · \(.workspace.project_name) · ctx \(.context_window.used_percentage)%"'`. Les scripts écrits pour Claude Code fonctionnent tels quels.
- Hooks (contrat identique à Claude Code, scripts réutilisables) :

```json
{ "hooks": {
    "PreToolUse":  [{ "matcher": "Bash|Edit", "hooks": [{ "type": "command", "command": "~/.fuller/hooks/guard.sh", "timeout": 30 }] }],
    "PostToolUse": [{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "npx prettier --check $(jq -r .tool_input.file_path)" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "cat ~/.fuller/context.txt" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "~/.fuller/hooks/ensure-tests.sh" }] }]
} }
```

  Événements : `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Notification`, `Stop`, `PreCompact`, `SessionEnd`. Le script reçoit un JSON sur l'entrée standard (`session_id`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`, `tool_response`, `prompt`…). Code de sortie 2 = blocage, la sortie d'erreur devient la raison (refus de l'outil, prompt bloqué, retour au modèle après un outil, ou reprise d'un tour après `Stop`). Sortie JSON possible : `decision`, `reason`, `hookSpecificOutput.permissionDecision` (`allow` évite la demande de permission), `updatedInput`, `additionalContext`. `/hooks` liste la configuration.
- MCP (Model Context Protocol) : serveurs déclarés dans `.mcp.json` à la racine du projet, `.fuller/mcp.json` ou `~/.fuller/mcp.json` (`{ "mcpServers": { "nom": { "command", "args", "env" } | { "url", "headers" } } }`, variables `${VAR}` développées) ; transports stdio et HTTP (streamable, repli SSE) ; leurs outils sont proposés au modèle sous `mcp__serveur__outil` et demandent une permission par défaut (règles `mcp__serveur` pour tout le serveur ou `mcp__serveur__outil`) ; `/mcp` affiche l'état et les outils ; en mode headless, Fuller attend les connexions avant le premier prompt.
- Tâches en arrière-plan : `execute_bash(run_in_background=true)` lance un serveur ou un long build sans bloquer le tour ; sortie dans `~/.fuller/tasks/<session>/<id>.log`, lecture par `task_output(task_id, wait_seconds)`, arrêt par `task_kill`, notification au modèle et dans le transcript à la fin, compteur dans le pied de page, `/tasks` pour lister ou arrêter (`/tasks kill bg1`). Les commandes au premier plan affichent leurs dernières lignes de sortie en direct.
- Recherche : `search_files` utilise `ripgrep` s'il est installé (`rg` dans le PATH ou `FULLER_RG=/chemin/rg`), sinon une implémentation JavaScript ; options `regex`, `ignore_case`, `glob`, `path`, `output_mode` (`content` | `files_with_matches` | `count`), `context_lines`, `head_limit`.
- Liste de tâches : le modèle tient sa liste avec l'outil `todo_write` ; elle s'affiche au-dessus de la saisie tant qu'il reste des éléments (Ctrl+T pour la masquer) et dans le transcript à chaque mise à jour ; elle est restaurée avec la session.
- Sessions : `~/.fuller/projects/<chemin-encodé>/<id>.json` · checkpoints : `~/.fuller/checkpoints/` · historique : `~/.fuller/history.jsonl`.
- Redimensionnement : Fuller recalcule le nombre de lignes physiques à effacer après un changement de largeur (les terminaux modernes re-replient le texte). Sur un terminal qui ne re-replie pas (xterm classique), lancez avec `FULLER_NO_REFLOW=1`.

## Structure

```
src/
├── index.tsx            CLI (commander), mode headless, préparation du terminal
├── headless.ts          Exécution non interactive (text | json | stream-json)
├── config.ts            Settings fusionnés (user / project / local) et AppConfig
├── branding.ts          Identité Fuller, proverbes vérifiés, verbes du spinner
├── agent/               loop (orchestration), gemini (SDK, historique, retry), systemPrompt, contextLoader, transcript, types
├── permissions/         bashParser (classification des commandes), rules (Tool(spec), décision)
├── tools/               registry, bash (spawn + signal), fileOps (diffs), search (fast-glob, .gitignore), web (fetch), paths (confinement), truncate
├── session/             store (sessions JSON + historique Gemini), history (prompts)
├── checkpoint/          Snapshots de fichiers et rewind
├── utils/               git, mentions (@fichier), fileIndex (complétion)
└── ui/                  App (Static + zone dynamique), InputBox, PermissionPrompt, Transcript, ToolRow, DiffView, Markdown, Footer, Banner, …
tests/                   vitest (parseur bash, règles, confinement, clavier, boucle agent, rendu)
```

## Développement

```bash
npm run typecheck
npm test
npm run build
python3 scripts/resize-test-vte.py /tmp/fuller-test "$PWD" "119,118,117,116" 30   # redimensionnement dans un vrai VTE
```

Rendu et redimensionnement (`src/ui/frameWriter.ts`, `src/ui/renderToString.tsx`) : Ink efface le cadre précédent avec `ESC[2K` et un compte de lignes *logiques*. Trois problèmes constatés dans VTE (GNOME Terminal) : son re-pliage bogue sur les lignes effacées avec `ESC[2K` ; le compte est faux dès que le terminal a re-plié le cadre ; et comme l'écran de VTE est toujours la fin de son tampon, chaque re-pliage laisse des lignes vides sous le cadre qui finissent par le pousser hors de l'écran (fantômes). Fuller réécrit donc l'effacement avec `ESC[K` et un compte de lignes *physiques*, ne redessine qu'une fois la taille stabilisée (120 ms), garde le curseur sur la dernière ligne du cadre, laisse une colonne libre à droite et, si le cadre précédent s'était replié, repeint l'écran visible ligne à ligne (queue du transcript re-mise en page + cadre) sans `ESC[2J`, qui pousserait l'écran dans l'historique. Claude Code, en mode classique, repeint à chaque événement et duplique l'historique (issues ouvertes) ; sa vraie réponse est le mode plein écran sur écran alternatif, prévu en P3 pour Fuller. Test : `scripts/resize-test-vte.py`.

Voir `reports/` pour l'analyse d'écarts avec Claude Code et la feuille de route (P0 → P3).
