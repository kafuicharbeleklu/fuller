# Claude Code (CLI, v2.1.282, 24 septembre 2026) : inventaire des commandes slash, des dialogues et des conventions de rendu

Méthode et sources. Il y a deux sources primaires.
1. La doc officielle, téléchargée en Markdown brut le 25/09/2026 : `https://code.claude.com/docs/en/<page>.md`. Elle couvre les pages commands, interactive-mode, statusline, output-styles, checkpointing, model-config, costs, terminal-config, fullscreen, permissions, permission-modes, memory, hooks-guide, sessions, sub-agents, plugins/install, fast-mode, headless, changelog et whats-new.
2. Le binaire Claude Code **2.1.282** installé sur cette machine (`~/.local/share/claude/versions/2.1.282`, Bun compilé). J'en ai extrait les chaînes (`strings`) pour relever le texte exact de l'UI. Ces extraits sont cités « binaire 2.1.282 » avec un lien `file://`. C'est du JS minifié : les libellés sont exacts, mais la mise en page que j'en déduis peut être approximative.

Le changelog va jusqu'à 2.1.282 (24/09/2026). C'est bien la version « 2.1.28x » demandée.

---

## Q1. Liste complète des commandes slash intégrées (une ligne chacune), avec les retraits, renommages et ajouts 2026

### Takeaway
La page de référence liste **114 entrées**. Ce sont des commandes intégrées, des *skills* fournis (`/batch`, `/code-review`, `/doctor`, `/loop`…) et un *workflow* (`/deep-research`). Plusieurs commandes de la liste de départ n'existent plus en 2.1.282 : `/todos`, `/vim` (retiré en 2.1.92), `/pr-comments` (2.1.91), `/tag` (2.1.92), `/ultraplan` et l'assistant `/agents` (2.1.198). D'autres sont devenues des alias : `/cost` et `/stats` → `/usage` (2.1.118), `/review` → `/code-review` (2.1.223), `/extra-usage` → `/usage-credits` (2.1.144), `/bashes` → `/tasks`. `/output-style` a été déprécié en 2.1.73 puis **réintroduit en 2.1.269**.

### Cited Findings

**Règles générales du menu `/`**
- « A command is only recognized at the start of your message. » Depuis v2.1.199, on peut chaîner jusqu'à six skills (`/skill-a /skill-b do XYZ`). — [Commands](https://code.claude.com/docs/en/commands)
- Une commande envoyée pendant que Claude répond est mise en file et part après le tour. Font exception, et s'exécutent tout de suite, `/status`, `/tasks` et `/usage`. En rendu fullscreen, les commandes à dialogue comme `/theme` et `/help` s'ouvrent aussi immédiatement (avant v2.1.234, elles étaient mises en file). — [Commands](https://code.claude.com/docs/en/commands)
- Filtrage : la première suggestion n'est surlignée que si les lettres correspondent au début du nom, ou d'un mot du nom, d'une commande ou d'un alias. Les séparateurs `:`, `_` et `-` sont ignorés : `/adddir` surligne `/add-dir`, `/new` surligne `/clear`. Après une faute de frappe, rien n'est surligné, `Tab` ou les flèches permettent de choisir, et `Enter` envoie le texte tel quel, ce qui produit « Unknown command ». Si rien ne correspond : `No commands match "/name"`. Les commandes cachées (ex. `/heapdump`) n'apparaissent qu'une fois le nom complet tapé (v2.1.236+). — [Commands](https://code.claude.com/docs/en/commands)
- Complétion en milieu de prompt (`run the tests, then /com`) : en fullscreen, une liste s'ouvre sans ligne surlignée. Hors fullscreen, la suite apparaît en *ghost text* avec un compteur `+2`, et `Tab` insère ou ouvre la liste. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Les prompts MCP apparaissent comme des commandes. — [Commands](https://code.claude.com/docs/en/commands)

**Inventaire (doc `commands`, 25/09/2026) : `commande` (alias) : rôle.** « Skill » signale un skill fourni.
- `/add-dir <path>` : ajoute un répertoire de travail, avec suggestions de chemins et `Tab`. Utilisable en cours de tour depuis v2.1.234, avec confirmation. — [Commands](https://code.claude.com/docs/en/commands)
- `/advisor [model|off]` : active l'outil *advisor* (second modèle consulté). Sans argument, ouvre un sélecteur. — [Commands](https://code.claude.com/docs/en/commands)
- `/agents` : depuis v2.1.198, affiche seulement un rappel (« ask Claude to create or manage subagents, or edit `.claude/agents/` »). L'interface interactive a disparu en 2.1.198 (« Removed the `/agents` wizard ») et l'entrée « (removed) » a été retirée du menu en 2.1.281. — [Commands](https://code.claude.com/docs/en/commands) ; [Changelog](https://code.claude.com/docs/en/changelog)
- `/artifacts` : liste les artifacts. `Enter` joint l'artifact à la session (v2.1.216), on peut aussi l'ouvrir ou copier le lien (v2.1.208+). — [Commands](https://code.claude.com/docs/en/commands)
- `/auto-mode-setup` : rédige les entrées `autoMode.environment` (v2.1.228). — [Commands](https://code.claude.com/docs/en/commands)
- `/autocompact [auto|<tokens>]` : règle la fenêtre d'auto-compaction. Sans argument, ouvre un dialogue qui montre la fenêtre courante (v2.1.221). — [Commands](https://code.claude.com/docs/en/commands)
- `/autofix-pr [prompt]` : session cloud qui surveille la PR et pousse des correctifs. — [Commands](https://code.claude.com/docs/en/commands)
- `/background [prompt]` (`/bg`) : détache la session en agent d'arrière-plan. — [Commands](https://code.claude.com/docs/en/commands)
- `/batch <instruction>` : skill, 5 à 30 unités en worktrees parallèles. — [Commands](https://code.claude.com/docs/en/commands)
- `/branch [name]` : branche la conversation et bascule dedans. Renommé depuis `/fork` en 2.1.77. — [Commands](https://code.claude.com/docs/en/commands) ; [Changelog](https://code.claude.com/docs/en/changelog)
- `/btw [question]` : question annexe dans un overlay, hors historique. Sans argument, rouvre la dernière (v2.1.212+). — [Commands](https://code.claude.com/docs/en/commands)
- `/bug [report]` (`/share`) : rapport de bug avec écran de consentement. N'est plus un alias de `/feedback` depuis v2.1.212. — [Commands](https://code.claude.com/docs/en/commands)
- `/cd <path>` : déplace la session dans un autre répertoire (v2.1.169). — [Commands](https://code.claude.com/docs/en/commands) ; [Changelog](https://code.claude.com/docs/en/changelog)
- `/chrome` : réglages de Claude in Chrome. — [Commands](https://code.claude.com/docs/en/commands)
- `/claude-api [migrate|upgrade|managed-agents-onboard|prompt-audit|cost-optimize|build-eval|hillclimb]` : skill. — [Commands](https://code.claude.com/docs/en/commands)
- `/clear [name]` (`/reset`, `/new`) : nouvelle conversation. Le nom éventuel étiquette l'ancienne dans `/resume`. — [Commands](https://code.claude.com/docs/en/commands)
- `/code-review [low|medium|high|xhigh|max|ultra] [--fix] [--comment] [pr#|branch|path]` (`/review`) : skill de revue de bugs. `ultra` lance une revue cloud. — [Commands](https://code.claude.com/docs/en/commands)
- `/color [color|default]` : couleur de la barre de prompt (`red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`). — [Commands](https://code.claude.com/docs/en/commands)
- `/compact [instructions]` : résume la conversation. — [Commands](https://code.claude.com/docs/en/commands)
- `/config [key=value ...]` (`/settings`) : ouvre l'interface Settings. `/config --help` liste les clés. — [Commands](https://code.claude.com/docs/en/commands)
- `/context [all]` : grille colorée de l'usage du contexte. En fullscreen, la ventilation par élément est repliée, `all` la déplie. — [Commands](https://code.claude.com/docs/en/commands)
- `/copy [N]` : copie la dernière réponse. S'il y a des blocs de code, ouvre un sélecteur ; `w` écrit dans un fichier. — [Commands](https://code.claude.com/docs/en/commands)
- `/cost` : alias de `/usage`. — [Commands](https://code.claude.com/docs/en/commands)
- `/dataviz [request]` : skill (v2.1.198). — [Commands](https://code.claude.com/docs/en/commands)
- `/debug [description]` : skill qui active les logs de debug. — [Commands](https://code.claude.com/docs/en/commands)
- `/deep-research <question>` : workflow. — [Commands](https://code.claude.com/docs/en/commands)
- `/design [brief]` : skill (v2.1.265). `/design-login` et `/design-sync [hint]` l'accompagnent. — [Commands](https://code.claude.com/docs/en/commands)
- `/desktop` (`/app`) : poursuit la session dans Claude Code Desktop. — [Commands](https://code.claude.com/docs/en/commands)
- `/diff` : panneau de diff (fullscreen) ou visionneuse (mode classique). — [Commands](https://code.claude.com/docs/en/commands)
- `/doctor` (`/checkup`) : **skill** depuis v2.1.205, bilan qui diagnostique et corrige. Avant, c'était un écran de diagnostic en lecture seule où `f` envoyait le rapport. `claude doctor` reste en lecture seule. — [Commands](https://code.claude.com/docs/en/commands)
- `/effort [level|auto|status]` : `low`…`xhigh`, `max`, `ultracode`, `auto`. — [Commands](https://code.claude.com/docs/en/commands)
- `/exit` (`/quit`) : quitte la CLI. Dans une session d'arrière-plan attachée, détache seulement. — [Commands](https://code.claude.com/docs/en/commands)
- `/export [filename]` : texte brut. Sans nom, ouvre un dialogue (presse-papiers ou fichier). — [Commands](https://code.claude.com/docs/en/commands)
- `/fast [on|off]` : mode rapide (v2.1.205). — [Commands](https://code.claude.com/docs/en/commands)
- `/feedback [report]` : même dialogue que `/bug`. Sans argument, ouvre la file des brouillons rédigés par Claude. — [Commands](https://code.claude.com/docs/en/commands)
- `/fewer-permission-prompts` : skill qui propose une allowlist. En 2.1.111, il s'appelait `/less-permission-prompts`. — [Commands](https://code.claude.com/docs/en/commands) ; [Changelog](https://code.claude.com/docs/en/changelog)
- `/focus` : vue focus (dernier prompt + résumé d'une ligne + réponse), **fullscreen uniquement** (v2.1.110). — [Commands](https://code.claude.com/docs/en/commands)
- `/fork [prompt]` : copie la conversation dans une nouvelle session d'arrière-plan (v2.1.212+). Entre v2.1.161 et 2.1.211, lançait un sous-agent *forké*. — [Commands](https://code.claude.com/docs/en/commands)
- `/goal [condition|clear]` : Claude continue jusqu'à ce que la condition soit remplie (v2.1.139). — [Commands](https://code.claude.com/docs/en/commands)
- `/heapdump` : caché. — [Commands](https://code.claude.com/docs/en/commands)
- `/help` : aide et liste des commandes. — [Commands](https://code.claude.com/docs/en/commands)
- `/hooks` : affiche les hooks (lecture seule). — [Commands](https://code.claude.com/docs/en/commands)
- `/ide` : intégrations IDE et statut. — [Commands](https://code.claude.com/docs/en/commands)
- `/import [codex|gemini|cursor] [--dry-run] [--yes]` : importe la configuration d'autres agents (v2.1.213, Cursor depuis 2.1.265). — [Commands](https://code.claude.com/docs/en/commands)
- `/init` : génère `CLAUDE.md`. `CLAUDE_CODE_NEW_INIT=1` donne le flux interactif. — [Commands](https://code.claude.com/docs/en/commands)
- `/insights` : rapport HTML d'analyse des sessions. — [Commands](https://code.claude.com/docs/en/commands)
- `/install-github-app` et `/install-slack-app`. — [Commands](https://code.claude.com/docs/en/commands)
- `/keybindings` : ouvre le fichier de raccourcis. — [Commands](https://code.claude.com/docs/en/commands)
- `/list-agents` (`/peers`) : pairs joignables par messagerie inter-session (v2.1.224). — [Commands](https://code.claude.com/docs/en/commands)
- `/login` et `/logout`. — [Commands](https://code.claude.com/docs/en/commands)
- `/loop [interval] [prompt]` (`/proactive`) : skill. — [Commands](https://code.claude.com/docs/en/commands)
- `/mcp [reconnect <server>|enable|disable [<server>|all]]` : liste interactive des serveurs. — [Commands](https://code.claude.com/docs/en/commands)
- `/memory` : édite les CLAUDE.md et bascule l'auto-mémoire. — [Commands](https://code.claude.com/docs/en/commands)
- `/mobile` (`/ios`, `/android`) : QR code de l'app mobile. — [Commands](https://code.claude.com/docs/en/commands)
- `/model [model]` : sélecteur, effort réglé avec ←/→, `s` pour cette session seulement. — [Commands](https://code.claude.com/docs/en/commands)
- `/output-style [style]` : liste ou change le style (v2.1.269+). — [Commands](https://code.claude.com/docs/en/commands)
- `/passes` : partager une semaine gratuite (comptes éligibles). — [Commands](https://code.claude.com/docs/en/commands)
- `/permissions` (`/allowed-tools`) : dialogue des règles allow/ask/deny. — [Commands](https://code.claude.com/docs/en/commands)
- `/plan [description]` : passe en mode plan. — [Commands](https://code.claude.com/docs/en/commands)
- `/plugin [subcommand]` : menu des plugins ou sous-commandes `list`, `install`, `enable`, `disable`. — [Commands](https://code.claude.com/docs/en/commands)
- `/powerup` : leçons interactives animées (v2.1.90). — [Commands](https://code.claude.com/docs/en/commands)
- `/pr-comments` : **retiré en v2.1.91**. — [Commands](https://code.claude.com/docs/en/commands)
- `/privacy-settings` : Pro et Max seulement. — [Commands](https://code.claude.com/docs/en/commands)
- `/radio` : Claude FM. — [Commands](https://code.claude.com/docs/en/commands)
- `/rate-limit-options` : caché du menu, choix proposés quand on atteint une limite. — [Commands](https://code.claude.com/docs/en/commands)
- `/recap` : résumé de session en une ligne. — [Commands](https://code.claude.com/docs/en/commands)
- `/release-notes` : sélecteur de version interactif. Les notes s'affichent dans le transcript sans entrer dans la conversation que voit Claude. — [Commands](https://code.claude.com/docs/en/commands)
- `/reload-plugins [--force]` et `/reload-skills`. — [Commands](https://code.claude.com/docs/en/commands)
- `/remote-control` (`/rc`) et `/remote-env`. — [Commands](https://code.claude.com/docs/en/commands)
- `/rename [name]` : nom affiché sur la barre de prompt. Rejet avec `That name is empty once invisible characters are removed. Usage: /rename <name>`. — [Commands](https://code.claude.com/docs/en/commands)
- `/resume [session]` (`/continue`) : sélecteur de sessions, où les sessions d'arrière-plan sont marquées `bg`. — [Commands](https://code.claude.com/docs/en/commands)
- `/review` : alias de `/code-review` depuis v2.1.223. — [Commands](https://code.claude.com/docs/en/commands) ; [Changelog](https://code.claude.com/docs/en/changelog)
- `/rewind` (`/checkpoint`, `/undo`). — [Commands](https://code.claude.com/docs/en/commands)
- `/run`, `/run-skill-generator`, `/verify` : skills. — [Commands](https://code.claude.com/docs/en/commands)
- `/sandbox` : bascule le mode sandbox. — [Commands](https://code.claude.com/docs/en/commands)
- `/schedule [description]` (`/routines`) : routines cloud. — [Commands](https://code.claude.com/docs/en/commands)
- `/scroll-speed` : fullscreen uniquement (v2.1.139). — [Commands](https://code.claude.com/docs/en/commands)
- `/security-review` : revue de sécurité du diff par rapport à la branche par défaut d'origin. — [Commands](https://code.claude.com/docs/en/commands)
- `/setup-bedrock` et `/setup-vertex` : cachés, sauf si le fournisseur correspondant est configuré. — [Commands](https://code.claude.com/docs/en/commands)
- `/simplify [target]` : skill de nettoyage avec quatre agents. En 2.1.147, `/simplify` avait été renommé en `/code-review` ; le nom est aujourd'hui réutilisé pour un skill de nettoyage. — [Commands](https://code.claude.com/docs/en/commands) ; [Changelog](https://code.claude.com/docs/en/changelog)
- `/skill-doctor` (v2.1.252/261) et `/skills` (`t` trie par tokens, `Space`/`Enter` changent la visibilité). — [Commands](https://code.claude.com/docs/en/commands)
- `/stats` : alias de `/usage`, s'ouvre sur l'onglet Stats. — [Commands](https://code.claude.com/docs/en/commands)
- `/status` : Settings sur l'onglet Status. Fonctionne pendant que Claude répond. — [Commands](https://code.claude.com/docs/en/commands)
- `/statusline` : configure la ligne de statut en langage naturel. Sans argument, se configure depuis le prompt shell. — [Commands](https://code.claude.com/docs/en/commands)
- `/stickers`. — [Commands](https://code.claude.com/docs/en/commands)
- `/stop` : arrête une session d'arrière-plan (seulement quand on y est attaché). — [Commands](https://code.claude.com/docs/en/commands)
- `/subtask <task>` : sous-agent forké dont le résultat revient dans la conversation (v2.1.212). — [Commands](https://code.claude.com/docs/en/commands)
- `/tasks` (`/bashes`) : travail en arrière-plan, y compris les sous-agents terminés. — [Commands](https://code.claude.com/docs/en/commands)
- `/team-onboarding` et `/teleport` (`/tp`). — [Commands](https://code.claude.com/docs/en/commands)
- `/terminal-setup` : Shift+Enter pour VS Code, Cursor, Devin Desktop, Alacritty et Zed. Option+Enter et coupure de la cloche dans Apple Terminal. Accès au presse-papiers dans iTerm2. — [Commands](https://code.claude.com/docs/en/commands)
- `/theme` : thèmes auto, clair/sombre, daltonisés, ANSI et personnalisés, plus « **New custom theme…** ». — [Commands](https://code.claude.com/docs/en/commands)
- `/tui [default|fullscreen]` : change le moteur de rendu et relance (v2.1.110). Sans argument, affiche le moteur actif. — [Commands](https://code.claude.com/docs/en/commands) ; [Changelog](https://code.claude.com/docs/en/changelog)
- `/ultraplan` : **retiré** (utiliser le mode plan). — [Commands](https://code.claude.com/docs/en/commands)
- `/ultrareview [PR or branch]` : alias de `/code-review ultra`. — [Commands](https://code.claude.com/docs/en/commands)
- `/update-config` : skill. — [Commands](https://code.claude.com/docs/en/commands)
- `/upgrade`. — [Commands](https://code.claude.com/docs/en/commands)
- `/usage` (`/cost`, `/stats`) : coût de session, limites du plan et statistiques. — [Commands](https://code.claude.com/docs/en/commands)
- `/usage-credits` : anciennement `/extra-usage`. — [Commands](https://code.claude.com/docs/en/commands)
- `/vim` : **retiré en v2.1.92**, remplacé par `/config` → Editor mode. — [Commands](https://code.claude.com/docs/en/commands)
- `/voice [hold|tap|off]` et `/web-setup`. — [Commands](https://code.claude.com/docs/en/commands)
- `/workflow-authoring` (skill) et `/workflows` (vue de progression). — [Commands](https://code.claude.com/docs/en/commands)

**Descriptions exactes affichées dans le menu `/`** (champ `description` du registre du binaire)
- Exemples : `clear` « Start a new session with empty context; previous session stays on disk (resumable with /resume) » ; `compact` « Free up context by summarizing the conversation so far » ; `context` « Visualize current context usage as a colored grid » ; `copy` « Copy Claude's last response to clipboard (or /copy N for the Nth-latest) » ; `export` « Export the current conversation to a file or clipboard » ; `help` « Show help and available commands » ; `hooks` « View hook configurations for tool events » ; `memory` « Edit CLAUDE.md files and memory settings » ; `model` « Set the AI model for Claude Code » ; `permissions` « Manage allow and deny tool permission rules » ; `plan` « Enable plan mode or view the current session plan » ; `resume` « Resume a previous conversation » ; `status` « Show Claude Code status including version, model, account, API connectivity, and tool statuses » ; `tasks` « View and manage everything running in the background » ; `theme` « Change the theme » ; `tui` « Set the terminal UI renderer (default | fullscreen) » ; `usage` « Show session cost, plan usage, and activity stats » ; `output-style` « List output styles or switch to one » ; `effort` « Set effort level for model usage » ; `btw` « Ask a quick side question without interrupting the main conversation » ; `security-review` « Complete a security review of the pending changes on the current branch » ; `agents` « (removed) Ask Claude to create/manage subagents, or edit .claude/agents/ » ; `extra-usage` « Renamed to /usage-credits ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Alias déclarés dans le registre : `background`→`bg` ; `clear`→`reset`,`new` ; `config`→`settings` ; `desktop`→`app` ; `doctor`→`checkup` ; `exit`→`quit` ; `list-agents`→`peers` ; `mobile`→`ios`,`android` ; `permissions`→`allowed-tools` ; **`plugin`→`plugins`,`marketplace`** ; `remote-control`→`rc` ; **`rename`→`name`** ; `resume`→`continue` ; `rewind`→`checkpoint`,`undo` ; `schedule`→`routines` ; `tasks`→`bashes` ; `teleport`→`tp` ; `usage`→`cost`,`stats`. Les alias en gras ne figurent pas dans la doc. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Commandes présentes dans le binaire mais **absentes de la doc** (probablement filtrées par drapeau ou internes) : `/brief` « Toggle brief-only mode » ; `/cloud-plugins` ; `/daemon` « Manage background services and routines » ; `/design-consent` ; `/design-revoke` ; `/install` « Install Claude Code native build » ; `/loops` « List, create, and delete loops » ; `/pause-memory` (alias `memory-pause`, `toggle-memory`) « Pause automemory for this session » ; `/pro-trial-expired` ; `/session` (alias `remote`) « Show cloud session URL and QR code » ; `/update` (alias `restart`) « Switch to the latest version (conversation continues) » ; `/version` « Show this session's version (autoupdate may have a newer one) » ; `/wellbeing` (alias `breaks`, `break-reminder`, `downtime`) « Configure optional break reminders and quiet-hours nudges » ; `/setup-claude` (alias `setup-cowork`). — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

**Chronologie 2026 des ajouts, retraits et renommages** (changelog officiel)
- 2.1.0 (07/01) : `/teleport`, `/remote-env`, `/plan`. 2.1.6 : recherche dans `/config`, plage de dates `r` dans `/stats` (« Last 7 days, Last 30 days, and All time »). 2.1.30 : `/debug`. 2.1.59 : `/copy`. 2.1.63 : `/simplify` et `/batch`. 2.1.69 : `/claude-api`, `/reload-plugins`. 2.1.71 : `/loop`. 2.1.73 : **`/output-style` déprécié**. 2.1.75 : `/color`. 2.1.76 : `/effort`. 2.1.77 : `/fork` → `/branch`. 2.1.79 : réglage « Show turn duration ». — [Changelog](https://code.claude.com/docs/en/changelog)
- 2.1.90 : `/powerup`. 2.1.91 : `/pr-comments` retiré. 2.1.92 : `/tag` et `/vim` retirés. 2.1.101 : `/team-onboarding`. 2.1.110 : `/tui`, `/focus` (et `Ctrl+O` ne bascule plus que transcript normal ↔ verbeux). 2.1.111 : `/ultrareview`, `/less-permission-prompts`. 2.1.118 : **« Merged `/cost` and `/stats` into `/usage` »**. — [Changelog](https://code.claude.com/docs/en/changelog)
- 2.1.139 : `/goal`, `/scroll-speed`. 2.1.144 : `/extra-usage` → `/usage-credits`, `/resume` montre les sessions `bg`. 2.1.147 : `/simplify` renommé en `/code-review`. 2.1.152 : `/reload-skills`. 2.1.154 : curseur `/effort` « Speed »/« Intelligence » → « Faster »/« Smarter ». 2.1.163 : `/plugin list`. 2.1.169 : `/cd`. 2.1.181 : `/config key=value`. 2.1.191 : `/rewind` peut revenir avant un `/clear`. 2.1.198 : assistant `/agents` retiré. 2.1.205 : `/doctor` devient un bilan complet (`/checkup`). — [Changelog](https://code.claude.com/docs/en/changelog)
- 2.1.212 : nouveau `/fork` et `/subtask`. 2.1.223 : `/review` → alias de `/code-review`. 2.1.246 : onglet **Auto mode** dans `/permissions`. 2.1.261 : `/skill-doctor`. 2.1.269 : **« Added `/output-style [name]` to list and switch output styles »**. 2.1.281 : entrée `/agents (removed)` retirée du menu. — [Changelog](https://code.claude.com/docs/en/changelog)
- `/todos` a été ajouté en 1.0.94 (« Added /todos command to list current todo items »). Il est encore cité en 2.1.14 (« `/config`, `/context`, `/model`, and `/todos` command overlays »). Il est **absent** de la doc actuelle et du registre du binaire 2.1.282, où seule la chaîne `~/.claude/todos/**` subsiste. — [Changelog](https://code.claude.com/docs/en/changelog) ; [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

### Inferences
- Pour une vérification de parité, les commandes « obligatoires » d'un clone 2.1.28x sont celles de la table officielle. `/todos`, `/vim` et `/pr-comments` ne doivent plus figurer comme commandes actives. S'ils existent, ils devraient répondre comme Claude Code (message de retrait ou `Unknown command`).
- La tendance 2026 va vers la consolidation. Un seul dialogue Settings à onglets remplace `/status`, `/config`, `/usage`, `/stats` et `/cost`. Beaucoup de commandes deviennent des skills (`/doctor`, `/code-review`, `/debug`, `/loop`). `/agents` est supprimé au profit du langage naturel.

### Gaps
- Je n'ai pas trouvé la version de retrait de `/todos` : aucune entrée « Removed `/todos` » dans le changelog. Elle se situe entre 2.1.14 et 2.1.282.
- Je n'ai pas trouvé la date du renommage `/less-permission-prompts` → `/fewer-permission-prompts`, ni la version de retrait de `/ultraplan`.
- La disponibilité réelle des commandes non documentées du binaire (`/brief`, `/wellbeing`, `/version`, `/update`…) n'est pas vérifiée. Elles sont probablement derrière des drapeaux.

---

## Q2. Dialogues principaux : ce qu'ils montrent et comment on y navigue

### Takeaway
La plupart des dialogues partagent un même cadre, avec un titre, un sous-titre, la couleur « permission », des onglets navigables par ←/→/Tab (↑/↓ passent de la rangée d'onglets au contenu depuis 2.1.281), `Esc` pour fermer et un double `Ctrl+C`/`Ctrl+D` qui ferme au lieu de quitter (2.1.280/281). Settings (`/config`, `/status`, `/usage`, `/stats`) est **un seul dialogue titré « Settings » avec les onglets Status | Config | Usage | Stats**. `/permissions` a les onglets **Recently denied | Allow | Ask | Deny | Workspace | Auto mode** (la place de Workspace est déduite).

### Cited Findings

**Dialogue Settings (`/config`, `/status`, `/usage`, `/stats`, `/cost`)**
- Le code monte `title:"Settings"` avec les onglets `title:"Status"`, `title:"Config"`, `title:"Usage"`, `title:"Stats"`, en couleur `"permission"`. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- `/status` ouvre Settings sur l'onglet Status : version, modèle, compte, connectivité, et la ligne `Session kind` (`interactive`, `background job · attached` ou `background job · unattended`, depuis v2.1.221). — [Commands](https://code.claude.com/docs/en/commands)
- Autres libellés de l'onglet Status relevés dans le binaire : `Session name` (avec « /rename to add a name »), `Session ID`, `Cloud session ID`, `Session kind`, `Cloud sessions` (« GitHub connected » ou « Not set up · /web-setup to connect GitHub »), `API provider`, `Anthropic base URL`, `System diagnostics`, `Enterprise managed settings (…, merged)`, `Additional CA cert(s)`, `mTLS client cert`, « Paused for this session · /pause-memory to resume ». Le changelog ajoute les lignes `Auto mode server` (2.1.278), « Organization policy » (2.1.261) et `Skipped sources` (2.1.243). — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282) ; [Changelog](https://code.claude.com/docs/en/changelog)
- Onglet **Config** : liste de réglages avec recherche (2.1.6) et souris en fullscreen (molette, clic sur la valeur, survol surligné ; 2.1.271). — [Changelog](https://code.claude.com/docs/en/changelog)
- Libellés exacts de Config dans l'ordre du code : « Auto-compact » · « Continue automatically at usage limit » · « Use this machine's settings in cloud sessions » · « Unattended commands from cloud sessions on this computer » · « Show tips » · « Claude-drafted feedback » (valeurs `notify`/`quiet`/`off`) · « Reduce motion » · « Thinking mode » · « Prompt suggestions » · « Session recap » · « Rewind code (checkpoints) » · « Synced project memory (this directory; applies next session) » · « Dynamic workflows » · « Ultracode keyword trigger » · « Dynamic workflow size » · « Artifacts » · « Verbose output » · « Terminal progress bar » · « Show status in terminal tab » · « Show turn duration » · « Precompute compaction » · « Show message timestamps » · « Time format » · « Default permission mode » · « Worktree base ref » (`fresh`/`head`) · « Use auto mode during plan » · « Respect .gitignore in file picker » · « Skip the /copy picker » · « Copy on select » · « Agents view » · « Open agents view by default » · « Auto-update channel » · « Theme » · « Notifications » (ou « Local notifications ») · « Push when actions required » · « Push when Claude decides » · « Output style » · « Default view » (`transcript`/`chat`/`default`) · « Language » · « Editor mode » (`normal`/`vim`) · « Question auto-continue timeout » (`never`/`60s`/`5m`/`10m`) · « Claude-proposed goals » · « Model » · « Diff tool » (`terminal`/`auto`) · « Auto-connect to IDE (external terminal) » · « Auto-install IDE extension » · « Teammate mode » (`auto`/`tmux`/`iterm2`/`in-process`) · « Dialog expiry » · « Messages from your other sessions » · « Use custom API key: ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Le réglage « Show last response in external editor » est documenté pour `Ctrl+G`. « Default teammate model » a été retiré en 2.1.234. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode) ; [Changelog](https://code.claude.com/docs/en/changelog)
- `/config key=value` fonctionne aussi en `-p` et via Remote Control. Il ne peut pas activer un réglage qui exige une confirmation (ex. `autoContinueAtUsageLimit`). — [Commands](https://code.claude.com/docs/en/commands)

**`/usage` (onglet Usage) et `/stats` (onglet Stats)**
- Le bloc Session donne `Total cost: $0.55`, `Total duration (API): 6m 20s`, `Total duration (wall): 6h 33m 10s`, `Total code changes: 0 lines added, 0 lines removed`, puis `Usage by model:` avec une ligne par modèle (`claude-sonnet-4-6: 1.2k input, 5.3k output, 940.0k cache read, 50.0k cache write ($0.55)`). La note « at your organization's configured rates » apparaît avec `modelPricing`. — [Costs](https://code.claude.com/docs/en/costs)
- Ligne `Prompt cache (main): 14 requests · 91% of input tokens from cache · 2 misses (last 6m 10s ago, 310.2k tokens re-cached) · 1 expected rebuild (compaction or tool-result clearing) · warm (1h TTL, last activity 40s ago)` (v2.1.251+). — [Costs](https://code.claude.com/docs/en/costs)
- Barres du plan : `Current session`, `Current week (all models)`, `Current week (Sonnet only)` ou `Current week (<modèle>)`, chacune au format `<nom>: N% used · resets <heure>`. Section « What's contributing to your limits usage? » avec `Last 24h` / `Last 7d`. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- La ventilation par skill, sous-agent, plugin et serveur MCP, les *behavior flags* (≥10 %) et les lignes Loops basculent entre 24 h et 7 j avec `d`/`w`. En cas d'échec, « Showing last-known usage » s'affiche et `r` relance. Une ligne de crédits d'usage s'affiche (`Unlimited` possible). — [Costs](https://code.claude.com/docs/en/costs)
- Libellés de Stats : `Favorite model`, `Total tokens`, `Sessions`, `Longest session`, `Current streak`, `Longest streak`, `Active days`, `Peak hour`, `Most active day`, « Stats from the last … », une heatmap avec légende « Less … », un graphique asciichart des tokens quotidiens. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282) ; [Changelog](https://code.claude.com/docs/en/changelog)

**`/context`**
- « Visualize current context usage as a colored grid », avec suggestions d'optimisation et avertissement de dépassement. En fullscreen, la ventilation est repliée et le texte « /context all to expand » s'affiche. — [Commands](https://code.claude.com/docs/en/commands) ; [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- La grille utilise les glyphes `⛁` (case pleine), `⛀` (partielle), `⛶` (espace libre) et `⛝` (tampon d'auto-compaction). Le titre est « Context Usage ». Les catégories sont affichées avec `tokens (x.x%)` et « Free space: ». Les sections sont MCP tools, Custom agents, Memory files et Skills, avec les sources `User`/`Managed`/`Plugin`/`MCP`/`Built-in`, plus « Suggestions ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- La forme texte (`-p`) produit un tableau Markdown : `## Context Usage`, `**Model:**`, `**Tokens:**`, `### Estimated usage by category`, lignes `Free space` et `Autocompact buffer`, `### MCP Tools`, `### Custom Agents`, `### Memory Files`, `### Skills`. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

**`/model`**
- Titre « Select model ». Sous-titre « Switch between Claude models. Your pick becomes the default for new sessions. For other/previous model names, specify with --model. » Autres libellés : « Currently using … for this session only (base model: …) », `(default)`, « Effort not supported », un avis sur le mode rapide (« …(/fast). Switching to other models turns off fast mode. »), « Type to search », et les indices « set as default » / « use this session only ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- `Enter` bascule et enregistre par défaut, `s` bascule pour cette session seulement. Le curseur d'effort se règle avec ←/→. Les prix s'affichent sur l'API Anthropic seulement. — [Model config](https://code.claude.com/docs/en/model-config)
- L'effort courant apparaît dans l'en-tête de session à côté du modèle (« with low effort »). Le pied de page l'affiche brièvement au démarrage et à chaque changement. — [Model config](https://code.claude.com/docs/en/model-config)

**`/effort`**
- Curseur interactif. Les extrémités s'appellent « Faster »/« Smarter » depuis 2.1.154. `Enter` enregistre, `s` vaut pour cette session (v2.1.257). `max` vaut toujours pour la session. `ultracode` est affiché « xhigh + workflows ». Autres libellés : « The default effort for this model », « (the default) », « Higher effort levels are capped by your settings or organization. », « Kept effort level as … ». — [Model config](https://code.claude.com/docs/en/model-config) ; [Changelog](https://code.claude.com/docs/en/changelog) ; [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Niveaux par modèle : Fable 5.1/5 et Opus 5.5/5/Sonnet 5/Opus 4.8/4.7 ont `low`…`max` ; Opus 4.6/Sonnet 4.6 ont `low, medium, high, max`. Défaut `medium` sur Opus 5.5, `xhigh` sur Opus 4.7, `high` ailleurs. — [Model config](https://code.claude.com/docs/en/model-config)

**`/permissions`**
- Onglets : « Recently denied », « Allow », « Ask », « Deny », « Auto mode » apparaissent dans cet ordre dans un premier bloc de code, et « Allow », « Ask », « Deny », « Workspace » dans un second. La position exacte de « Workspace » (entre Deny et Auto mode) est donc déduite, pas confirmée. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Le dialogue liste les règles et le `settings.json` d'où chacune vient. Il ouvre en cours de tour (v2.1.234). On y ajoute ou retire des règles, on gère les répertoires, on revoit les refus du mode auto. La recherche se fait avec `/`. Les confirmations de suppression ont No par défaut (2.1.280). ←/→/Tab changent d'onglet depuis la liste. — [Permissions](https://code.claude.com/docs/en/permissions) ; [Commands](https://code.claude.com/docs/en/commands) ; [Changelog](https://code.claude.com/docs/en/changelog)

**`/mcp`**
- Titre « Manage MCP servers ». États relevés : `connected` (`N tools`), `disabled`, `session token rejected`, `tools fetch failed`, `no tools`, `cached`, `pending`, `connecting…`, `reconnecting (n/m)…`, `needs authentication`, `not configured`, `config issue`. Portées : `claudeai`, `managed`, `ide`, `sse`/`http`/`stdio`. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Depuis 2.1.280, la liste, le détail et `/plugin` affichent tous `⚠` (plus `△`). Une ligne « Show unused connectors » replie les connecteurs jamais utilisés (2.1.161). Le statut HTTP s'affiche en cas d'échec (2.1.219). Une barre de défilement apparaît en fullscreen (2.1.281). — [Changelog](https://code.claude.com/docs/en/changelog)

**`/hooks`**
- « Type `/hooks` to open the hooks browser. You'll see a list of all available hook events, with a count next to each event that has hooks configured. » Le détail montre l'événement, le matcher, le type, le fichier source et la commande. Le menu est **en lecture seule**. — [Hooks guide](https://code.claude.com/docs/en/hooks-guide)
- 2.1.281 : l'écran de détail indique le type de hook et où le modifier. Les avis hooks désactivés, safe mode et managed-only tiennent en une phrase. — [Changelog](https://code.claude.com/docs/en/changelog)

**`/memory`**
- Liste CLAUDE.md, CLAUDE.local.md et les autres emplacements, par portée utilisateur et projet, y compris les fichiers pas encore créés. Contient une bascule d'auto-mémoire et une option pour ouvrir le dossier d'auto-mémoire. Choisir un fichier l'ouvre dans l'éditeur, en le créant au besoin. — [Memory](https://code.claude.com/docs/en/memory)

**`/resume` (sélecteur de sessions)**
- Touches : ↑/↓ ; →/← déplient ou replient les groupes ; `Enter` ; `Space` prévisualise ; `Ctrl+R` renomme ; `/` ou un caractère lance la recherche (y compris par URL de PR) ; `Ctrl+A` passe à tous les projets ; `Ctrl+W` aux worktrees ; `Ctrl+B` à la branche courante ; `Esc`. — [Sessions](https://code.claude.com/docs/en/sessions)
- Chaque ligne affiche le nom (ou le titre IA, le résumé ou le premier prompt), le temps depuis la dernière activité, la branche git et la taille du fichier. Les entrées `bg` sont des sessions d'arrière-plan. Le chargement continue au défilement (2.1.243). — [Sessions](https://code.claude.com/docs/en/sessions) ; [Changelog](https://code.claude.com/docs/en/changelog)

**`/export`**
- Titre « Export conversation », sous-titre « Select export method ». Options : « Copy to clipboard » (« Copy the conversation to your system clipboard ») et « Save to file » (« Save the conversation to a file in the current directory »), puis « Enter filename: ». Résultats : « Conversation exported to: <path> », « Conversation copied to clipboard », « Export cancelled », « Failed to export conversation: … ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

**`/theme`**
- Options : « Auto (match terminal) », « Dark mode », « Light mode », « Dark mode (colorblind-friendly) », « Light mode (colorblind-friendly) », « Dark mode (ANSI colors only) », « Light mode (ANSI colors only) », puis les thèmes personnalisés « (custom) » et « New custom theme… ». En-tête : « Choose the text style that looks best with your terminal ». Aperçu : diff `demo.js` (`function greet() {` / `-  console.log("Hello, World!");` / `+  console.log("Hello, Claude!");`) et « Syntax theme: … ». `ctrl+t` bascule la coloration syntaxique. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282) ; [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- `Ctrl+E` édite un thème personnalisé. Fichiers `~/.claude/themes/<slug>.json` avec `name`, `base` (`dark`, `light`, `dark-daltonized`, `light-daltonized`, `dark-ansi`, `light-ansi`) et `overrides`. Rechargement à chaud. — [Terminal config](https://code.claude.com/docs/en/terminal-config)

**`/output-style` et « Preferred output style »**
- Sans argument, la commande liste les styles et marque le style courant. Dans `/config` → Output style, un sélecteur titré « Preferred output style » avec « This changes how Claude Code communicates with you ». — [Output styles](https://code.claude.com/docs/en/output-styles) ; [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

**`/plugin`**
- Onglets **Discover** (onglet d'ouverture, recherche, `Enter` pour le détail), **Installed** (avec une section Skills depuis 2.1.186), **Marketplaces** et **Errors**. La fiche d'un plugin du marketplace officiel montre les coûts « Every turn » et « When invoked ». — [Plugins install](https://code.claude.com/docs/en/plugins/install) ; [Changelog](https://code.claude.com/docs/en/changelog)

**`/tasks`**
- Liste le travail en arrière-plan : shells, sous-agents et workflows. Le modèle et l'effort figurent sur chaque ligne (2.1.242/243). `Enter` ouvre le transcript. `x` arrête, avec une confirmation pour `/ultrareview` (2.1.281). Un sous-agent terminé reste 30 s, marqué *done*, avec le hint `/tasks to see subagents` dans le pied de page. — [Sub-agents](https://code.claude.com/docs/en/sub-agents) ; [Changelog](https://code.claude.com/docs/en/changelog)

**`/help`**
- Onglets « General », « Commands » (« Browse default commands ») et « Custom commands » (« Browse custom commands », « No custom commands found »). Ligne « New here? Run /powerup to learn the features most people miss. » et « Something else? Use /feedback to report bugs or request features. ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

**Autres dialogues et overlays**
- `/btw` : overlay refermable (`Space`/`Enter`/`Esc`). ↑/↓ font défiler. `Shift+←/→` ou `[`/`]` parcourent l'historique (v2.1.257). `c` copie en Markdown, `f` forke vers un sous-agent, `x` vide l'historique. Les cinq dernières questions apparaissent en liste atténuée. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- `/diff` : en fullscreen, un panneau latéral (≥110 colonnes, ouverture automatique à ≥144) liste les fichiers avec leurs compteurs +/−. On le ferme avec `✕` ou `/diff`. `Ctrl+X B` change la base de comparaison. Une sélection faite à la souris est jointe au prompt suivant. En mode classique, une visionneuse remplace le prompt avec une vue **Current** et des vues par tour (←/→, ↑/↓, `Enter`, `Esc`). — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- `/goal` : « Goal set: », « Goal active », « /goal clear to stop early », « No goal set », « Goal cleared: ». Panneau superposé avec le temps écoulé, les tours et les tokens (2.1.139). — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282) ; [Changelog](https://code.claude.com/docs/en/changelog)
- `/autocompact` : « Auto-compact window: auto (… tokens (default for this model)) ». Avertissements : « The auto setting picks a window tuned for your model and is strongly recommended… » et « Auto-compact is currently disabled (see /config) ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- `/doctor` : c'est désormais un skill, qui produit des constats puis demande confirmation avant de modifier quoi que ce soit. Il n'y a plus d'écran TUI dédié. — [Commands](https://code.claude.com/docs/en/commands)

### Inferences
- Pour un clone, fusionner `/status`, `/config`, `/usage` et `/stats` dans un dialogue « Settings » à quatre onglets est la structure attendue. Des commandes séparées qui ouvrent des écrans indépendants divergent de CC 2.1.28x.
- `/agents`, `/doctor` (écran) et `/todos` ne doivent plus avoir de dialogue propre.

### Gaps
- Je n'ai pas vu la disposition pixel près (colonnes, marges) de la plupart des dialogues : le binaire donne les libellés, pas une capture. Une capture réelle (session `claude` lancée seule, cf. la note mémoire sur le plein écran) reste nécessaire pour les alignements.
- Le texte exact du rappel `/agents` et la liste d'options du dialogue `/release-notes` n'ont pas été extraits.

---

## Q3. Styles de sortie : définition, styles intégrés, styles personnalisés, affichage dans l'UI

### Takeaway
Un style de sortie est un jeu d'instructions ajouté au prompt système pour toute la session. Il y a quatre styles intégrés en plus de Default : **Proactive, Concise (v2.1.237), Explanatory, Learning**. On les choisit avec `/output-style <style>` (v2.1.269+) ou `/config` → Output style. Le choix est enregistré dans `.claude/settings.local.json`. Explanatory et Learning produisent dans le transcript des blocs visibles `★ Insight ───` et `● Learn by Doing`.

### Cited Findings
- Tableau officiel : Proactive (« starts work right away and makes reasonable assumptions »), Concise (« lead with the result and leave out preamble »), Explanatory (« short `Insight` blocks »), Learning (explique et laisse des morceaux de code à l'utilisateur). Default = aucun style. — [Output styles](https://code.claude.com/docs/en/output-styles)
- Descriptions exactes du sélecteur : Default « Claude completes coding tasks efficiently and provides concise responses » ; Proactive « Claude executes immediately, minimizes interruptions, and prefers action over planning » ; Concise « Claude responds tersely, leading with results and skipping preamble and narration » ; Explanatory « Claude explains its implementation choices and codebase patterns » ; Learning « Claude pauses and asks you to write small pieces of code for hands-on practice ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Rendu d'un bloc Insight, exemple officiel :
  ```
  ★ Insight ─────────────────────────────────────
  - Every route in this repo goes through the withAuth wrapper, …
  ─────────────────────────────────────────────────
  ```
  — [Output styles](https://code.claude.com/docs/en/output-styles)
- Learning : marqueur `TODO(human)` dans le fichier, puis un bloc `● Learn by Doing` avec `Context:`, `Your Task:` et `Guidance:`. Claude s'arrête et attend. — [Output styles](https://code.claude.com/docs/en/output-styles)
- Changement de style : « `/output-style <style>` … With no argument, the command lists the styles you can pick and marks the current one ». Il existe aussi un menu `/config` → **Output style**. La valeur `outputStyle` est sensible à la casse dans les fichiers de réglages, pas dans la commande. Le nouveau style s'applique **au message suivant** ; avant v2.1.251, il fallait `/clear`. — [Output styles](https://code.claude.com/docs/en/output-styles)
- Styles personnalisés : Markdown dans `~/.claude/output-styles`, `.claude/output-styles` ou le dossier des réglages gérés, ou fourni par un plugin (`output-styles/`). Frontmatter `name`, `description` (affichés dans le sélecteur `/config`), `keep-coding-instructions`, `force-for-plugin`. Le terminal lit ces fichiers au démarrage : il faut redémarrer après une modification. — [Output styles](https://code.claude.com/docs/en/output-styles)
- La ligne de statut reçoit `output_style.name`. — [Statusline](https://code.claude.com/docs/en/statusline)
- Historique : 2.1.73 « Deprecated `/output-style` command — use `/config` instead. Output style is now fixed at session start » ; 2.1.269 réintroduction. — [Changelog](https://code.claude.com/docs/en/changelog)

### Inferences
- Un clone doit afficher les styles dans l'ordre Default, Proactive, Concise, Explanatory, Learning, puis les styles personnalisés, avec les descriptions ci-dessus. Il doit aussi rendre `★ Insight` avec les filets horizontaux, ce qui dépend du modèle et non de l'UI.

### Gaps
- L'ordre exact d'affichage dans le sélecteur n'a pas été vérifié à l'écran. L'ordre du code est Default (null), Proactive, Concise, puis les autres.

---

## Q4. Ligne de statut : schéma JSON, rafraîchissement, padding, contenu du pied de page par défaut

### Takeaway
`statusLine` (`type:"command"`, `command`, `padding`, `refreshInterval`, `hideVimModeIndicator`) exécute un script qui reçoit un JSON riche sur stdin. Il est relancé à chaque événement (nouveau message, `/compact`, changement de mode…), avec un anti-rebond de **300 ms** et l'annulation du script en cours. Il s'affiche **au-dessus** des badges du pied de page intégrés, sans les remplacer, mais masque la plupart des indices clavier (`esc to interrupt`, `? for shortcuts`).

### Cited Findings
- Configuration : `{"statusLine":{"type":"command","command":"~/.claude/statusline.sh","padding":2}}`. `padding` vaut 0 par défaut et s'ajoute à l'espacement de l'interface (indentation relative). `refreshInterval` en secondes (min 1). `hideVimModeIndicator` masque le `-- INSERT --` intégré. — [Statusline](https://code.claude.com/docs/en/statusline)
- `/statusline <description>` génère un script dans `~/.claude/` et met à jour les réglages. `/statusline delete|clear|remove it` le retire. — [Statusline](https://code.claude.com/docs/en/statusline)
- Déclencheurs : démarrage ou reprise de session ; nouveau message assistant ; fin de `/compact` ; changement de mode de permission ; bascule vim ; changement de `command` (qui contourne l'anti-rebond) ; timer `refreshInterval` ; `resets_at` d'une limite ; `expires_at` du cache. « debounces updates at 300ms … If a new update triggers while your script is still running, Claude Code cancels the in-flight script. » — [Statusline](https://code.claude.com/docs/en/statusline)
- Sortie : plusieurs lignes possibles, couleurs ANSI, liens OSC 8. `COLUMNS` et `LINES` sont fournis (`tput cols` ne fonctionne pas). La ligne de statut se masque pendant l'autocomplétion, le menu d'aide et les prompts de permission. — [Statusline](https://code.claude.com/docs/en/statusline)
- Champs JSON : `model.{id,display_name}`, `cwd`, `workspace.{current_dir,project_dir,added_dirs,git_worktree,repo.{host,owner,name}}`, `cost.{total_cost_usd,total_duration_ms,total_api_duration_ms,total_lines_added,total_lines_removed}`, `context_window.{total_input_tokens,total_output_tokens,context_window_size,used_percentage,remaining_percentage,current_usage.{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}}`, `exceeds_200k_tokens`, `fast_mode`, `effort.level`, `thinking.enabled`, `rate_limits.{five_hour,seven_day,spend_limit}.{used_percentage,resets_at}`, `prompt_cache.{warm,caching_observed,ttl,expires_at,requests,misses,expected_rebuilds,hit_ratio,cache_write_tokens,miss_recache_tokens,last_miss_at,last_miss_cause,miss_causes,recache_tokens_if_cold}`, `session_id`, `session_name`, `prompt_id`, `transcript_path`, `version`, `output_style.name`, `vim.mode`, `agent.name`, `pr.{number,url,review_state,kind}`, `worktree.{name,path,branch,original_cwd,original_branch}`. — [Statusline](https://code.claude.com/docs/en/statusline)
- Champs parfois absents : `session_name`, `prompt_id`, `workspace.git_worktree`, `workspace.repo`, `effort`, `vim`, `agent`, `pr`, `worktree`, `rate_limits` (Pro/Max seulement, après la première réponse), `prompt_cache`. Champs parfois `null` : `current_usage` (avant le premier appel et après `/compact`), `used_percentage`. `used_percentage` = entrées seules (`input + cache_creation + cache_read`). — [Statusline](https://code.claude.com/docs/en/statusline)
- `subagentStatusLine` remplace le corps de chaque ligne du panneau des sous-agents (défaut `name · description · token count`). Il reçoit `columns` et `tasks[]` (`id`, `name`, `type`, `status`, `description`, `label`, `startTime`, `model`, `effort`, `contextWindowSize`, `tokenCount`, `tokenSamples`, `cwd`) et renvoie `{"id":…,"content":…}` par ligne. — [Statusline](https://code.claude.com/docs/en/statusline)

**Pied de page intégré (sans ligne de statut personnalisée)**
- Indicateur de mode : « gray `⏸ manual mode on` for `default`, or as `⏵⏵ accept edits on`, `⏸ plan mode on`, `⏵⏵ auto mode on`, `⏵⏵ don't ask on`, or `⏵⏵ bypass permissions on` ». `Shift+Tab` fait défiler les modes. — [Permission modes](https://code.claude.com/docs/en/permission-modes)
- Indices : `? for shortcuts`, `esc to interrupt`, `hold space to speak`. Ils sont supprimés quand une ligne de statut personnalisée existe. — [Statusline](https://code.claude.com/docs/en/statusline)
- Contexte : en atténué, `N% until auto-compact`, ou `N% context used` quand la fenêtre n'est pas imposée. Quand l'auto-compaction est coupée, en rouge : `Context low (N% remaining) · Run /compact to compact & continue`. Mémoire critique : « Critical memory usage (X) — restart and resume with claude --continue, or run /compact ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Badge PR cliquable « PR #446 », souligné vert (approved), jaune (pending), rouge (changes requested) ou gris (draft). GitLab : `MR !N`. Indices `install gh for PR status` et `gh auth login for PR status`. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Mode rapide : « A small `↯` icon appears next to the prompt while fast mode is active ». Confirmation `Fast mode ON`/`Fast mode OFF`. L'icône passe au gris pendant le *cooldown*. — [Fast mode](https://code.claude.com/docs/en/fast-mode)
- Effort : affiché brièvement au démarrage et à chaque changement. Hint `/tasks to see subagents` pendant 30 s après un sous-agent. Pour le hint du tour, la tâche en cours sous le prompt, voir Q5. — [Model config](https://code.claude.com/docs/en/model-config) ; [Sub-agents](https://code.claude.com/docs/en/sub-agents)
- Attente de limite d'usage : `Usage limit reached · continuing automatically at 3:45pm · esc to cancel`, puis `Usage limit reset · continuing automatically`, ou `Automatic continue stopped after repeated usage-limit hits · /rate-limit-options to try again`. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Le glyphe IDE `⧉` (U+29C9) préfixe une référence IDE, via la fonction `${⧉} ${texte}`. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

### Inferences
- Un clone fidèle doit rendre la ligne de statut personnalisée dans une rangée à elle, au-dessus des badges. Il doit aussi appliquer l'anti-rebond de 300 ms avec annulation, fournir `COLUMNS`/`LINES` et gérer les champs facultatifs comme absents, pas comme `null`, selon la liste ci-dessus.

### Gaps
- Je n'ai pas la mise en page exacte du pied de page par défaut (ordre gauche/droite des badges : mode, contexte, PR, IDE, tâches d'arrière-plan). Seuls les libellés individuels sont confirmés.
- Je n'ai pas trouvé le texte exact du compteur de tâches d'arrière-plan dans le pied de page.

---

## Q5. Conventions de rendu du transcript

### Takeaway
Chaque bloc assistant ou appel d'outil commence par **`⏺` sur macOS et `●` ailleurs**. Le résultat est indenté sous **`⎿`**. Les sorties longues sont repliées à **3 lignes** avec `… +N lines (ctrl+o to expand)`. La réflexion est repliée en **`✻ Thinking…`** (gris italique). La fin de tour affiche **`✻ <Verbe> for 1m 2s`** avec un verbe tiré de `Baked/Brewed/Churned/Cogitated/Cooked/Crunched/Sautéed/Worked`. Un sous-agent se termine par `Done (N tool uses · Xk tokens · Ys)`. Une interruption donne `Interrupted · What should Claude do instead?`.

### Cited Findings

**Table des glyphes (constantes du binaire)**
- `⏺` (U+23FA) sur macOS, sinon `●` (U+25CF) ; `∙` ; `⌕` ; `✻` (U+273B) ; frames de réflexion `∴ ∷ ∵ ∷` ; `◌` ; `↑ ↓ ↳ ← → ⏎ ↯` ; `○ ◐ ● ◉ ◈ ✦ ◎` ; `⏸` (plan) ; `⏵⏵` (accept edits/auto) ; `↻` ; `⑂` (fork) ; `◇ ◆` ; `※` ; `⚠` ; `⧉` ; `♪` ; `▎ █ ─ ┄ ┃` ; spinner `·|· ·/· ·—· ·\·` ; `·✔︎·` ; `× ✕ ▸` ; `⎿` (U+23BF) ; `⠿` ; spinner braille `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` ; coins arrondis `╭╮╰╯` ; arbre `├ └ │ ┬ ┴`. La bibliothèque `figures` fournit tick `✔`, cross `✘`, warning `⚠`, squareSmall `◻`, squareSmallFilled `◼`, pointer `❯`, checkbox `☐/☒`. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

**Lignes d'outils et résumés repliés (libellés exacts)**
- Repli : 3 lignes au-dessus de la ligne de pli, puis `… +${n} lines` en atténué, suivi de `(ctrl+o to expand)`, où la touche vient du keybinding `app:toggleTranscript`. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Read : « Read **N** lines » (nombre en gras), « Read image (taille) », « Read PDF (taille) », « Read **N** cells » (notebook), « Referenced file **path** » (après compaction). — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Write : « Wrote **N** lines to **path** ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Edit/Update : « Added **N** lines, removed **M** lines ». S'il n'y a que des suppressions : « Removed **M** lines ». Singulier « line ». Le diff suit, avec l'indice d'expansion quand il est replié. Notebook : « Updated cell **id**: ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Groupe de lectures et recherches replié : « Searched for N patterns, read N files, listed N directories » au passé, ou « Searching for 2 patterns, reading 3 files… » en cours (avec `…`). Pour la mémoire : « Recalled N memories », « Searched memories », « Wrote N memories ». Autres : « Listed directory **path** », « Did N searches in Xs » (WebSearch), `Found ${n} files` (Grep/Glob). — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Les appels MCP répétés se replient en `Called slack 3 times`. Les messages d'autres sessions apparaissent en `Message from @<sender>`. `Ctrl+O` les déplie et ajoute l'horodatage et le modèle de chaque message. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Diagnostics IDE : « Found N new diagnostic issues in N files (ctrl+o to expand) ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

**Réflexion (thinking)**
- Espace réservé replié : texte atténué et italique `✻ Thinking…`. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- « Claude Code collapses thinking output by default. Press `Ctrl+O` to toggle verbose mode and see the reasoning as gray italic text. » Les blocs sont caviardés par défaut ; `showThinkingSummaries: true` les rend lisibles. — [Model config](https://code.claude.com/docs/en/model-config)
- Statut du spinner selon la durée : `thinking` (<10 s), `still thinking` (≥10 s), `thinking more` (≥20 s), `thinking some more` (≥30 s), `deep in thought` (≥45 s), puis `thought for Ns`. Autres statuts : `running tool for Xs` / `ran tool for Xs`, `↓ N tokens`. Blocage : `Waiting for API response · will retry in X · check your network`. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Verbes du spinner : liste « Accomplishing, Actioning, Actualizing, Architecting, Baking, … Clauding, … », remplaçable ou extensible via `spinnerVerbs` (`mode: replace|append`). — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

**Fin de tour**
- Ligne `✻` + `${verbe} for ${durée}` en atténué, éventuellement suivie de ` · done <heure>`. Le verbe est choisi de façon déterministe (hachage de l'uuid) parmi `["Baked","Brewed","Churned","Cogitated","Cooked","Crunched","Sautéed","Worked"]`. Variantes : « Waiting for N background agents and N dynamic workflows to finish » ; « · N messages hidden (/focus to show) » ; « · X still running ». Réglage `/config` « Show turn duration » (« Show "Cooked for Nm Ns" after each assistant turn »). — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

**Interruption, rejet, erreurs**
- Interruption : `Interrupted ` (atténué) + `· What should Claude do instead?`, rendu sous `⎿`. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- `Esc` interrompt en gardant le travail fait, puis envoie les messages en file. Sur un prompt de permission, `Esc` équivaut à **No**. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)

**Sous-agents, tâches et todo**
- Fin d'un sous-agent : `Done (${n} tool uses · ${tokens} tokens · ${durée})`, avec `1 tool use` au singulier. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Un panneau sous le prompt affiche les sous-agents en arbre, avec des compteurs `(+N)` pour les descendants. Une ligne réussie disparaît immédiatement et le hint `/tasks to see subagents` s'affiche 30 s. Les forks ont une ligne pour `main` plus une par fork. — [Sub-agents](https://code.claude.com/docs/en/sub-agents)
- Liste de tâches (`Ctrl+T`, 5 visibles au maximum) : en-tête « N tasks (X done, Y in progress, Z open) ». Icônes : `✔` (completed, vert « success », texte barré), `◼` (in_progress, couleur « claude »), `◻` (pending). Propriétaire `(@name)`, bloqueurs après `›`. Débordement : « … +N in progress, M pending, K completed ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282) ; [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Par défaut, la liste ne se remplit que sur les modèles dotés des outils de tâches : Claude 3.x, Opus 4 à 4.7, Sonnet 4 à 4.6, Haiku 4.5. Sur les autres, elle reste vide sauf avec `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Shells d'arrière-plan : `Ctrl+B` (deux fois sous tmux) ; un ID de tâche est renvoyé immédiatement ; `/tasks` les gère. — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)

**Hooks**
- Messages : `${Event} hook error: …`, `${hook} hook returned blocking error`, `Stop hook feedback: …`, `Stop hook error: …`, `${hook} hook stopped continuation: …`, `UserPromptSubmit hook error: …`. Spinner : `Running PreCompact hooks…` / `Running PostCompact hooks…`. Résumé : « Ran **N** stop hooks ». Annulation : « Hook cancelled ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

**Compaction**
- Spinner « Compacting conversation ». Résultat en atténué : `Compacted (ctrl+o to see full summary)` plus un éventuel conseil. Notification contextuelle de 8 s : `Conversation compacted (ctrl+o for history)`. Marqueur de résumé partiel : **Summarized conversation**, avec « Summarized N messages ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282) ; [Checkpointing](https://code.claude.com/docs/en/checkpointing)

**Bannière et conseils**
- L'en-tête de session affiche le modèle avec l'effort (« with low effort »). Le fichier de réglages qui impose le modèle y apparaît le cas échéant. — [Model config](https://code.claude.com/docs/en/model-config)
- Les conseils du spinner incluent par exemple « Use /clear to start fresh when switching topics and free up context » et « Use /btw to ask a quick side question without interrupting Claude's current work ». 2.1.269 ajoute un conseil `/focus`. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282) ; [Changelog](https://code.claude.com/docs/en/changelog)
- Récapitulatif de session en une ligne au retour (≥3 min, ≥3 tours, 400 caractères maximum). — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)

### Inferences
- Les résumés repliés sont construits avec une **valeur numérique en gras** et un texte normal (« Read **42** lines »). Un clone qui imprime tout en gris ou sans gras s'écarte visuellement.
- Le verbe de fin de tour est stable pour un message donné (hachage), il ne change pas à chaque rendu.
- Hors macOS, CC utilise `●` et non `⏺`. Un clone Linux qui force `⏺` diverge du vrai CC sous Linux.

### Gaps
- Je n'ai pas extrait le rendu exact de la bannière de démarrage en 2.1.282 (logo Clawd, lignes version/modèle/dossier). Les notes précédentes dans `research_notes/Fuller TUI écarts avec Claude Code/` la couvrent partiellement.
- Je n'ai pas trouvé la mise en forme exacte du diff Edit (gouttière des numéros de ligne, fonds colorés) dans le binaire. Seuls les jetons `diffAdded`/`diffRemoved` sont attestés.
- Je n'ai pas relevé le libellé exact de la ligne Bash en arrière-plan (« Running in the background » existe 9 fois sans contexte clair).

---

## Q6. Checkpoints et rewind : Esc Esc, `/rewind`, restauration, « Summarize from here »

### Takeaway
Chaque prompt qui démarre un tour crée un checkpoint (les 100 plus récents gardent leurs fichiers). `Esc Esc` sur prompt vide, ou `/rewind`, ouvre un dialogue **« Rewind »** : on choisit un message puis une action parmi *Restore code and conversation / Restore conversation / Restore code / Summarize from here / Summarize up to here / Never mind*.

### Cited Findings
- Si le prompt contient du texte, le double `Esc` le vide (et le range dans l'historique) au lieu d'ouvrir le menu. — [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- Actions : « **Restore code and conversation** », « **Restore conversation** », « **Restore code** », « **Summarize from here** », « **Summarize up to here** », « **Never mind** ». Les deux options de code n'apparaissent que si le point choisi a des modifications de fichiers suivies. — [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- Après une restauration de conversation ou « Summarize from here », le prompt d'origine revient dans l'entrée. « Summarize up to here » laisse l'entrée vide. Un marqueur **Summarized conversation** est inséré. — [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- Résumé guidé : surligner une option Summarize et taper dans la ligne « **add context (optional)** », puis `Enter`. Le chiffre de l'option lance le résumé sans instructions. — [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- Après un `/clear` dans le même processus, une entrée `/resume <session-id> (previous session)` s'affiche en haut (v2.1.191). — [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- Libellés du binaire : titre « Rewind » ; « Restore the code and/or conversation to the point before… » ; « Restore and fork the conversation to the point before… » ; « Nothing to rewind to yet. » ; « Confirm you want to restore … to the point before you sent this message: » ; « The conversation will be unchanged. » ; « No code changes » ; « N files changed » ; « Summarizing… » ; « Rewinding does not affect files edited manually or via bash. ». Erreurs : `Restored the code, but skipped N files: … Skipped files were left untouched — run with --debug for the paths.`, « Failed to restore the code: … », « Failed to restore the conversation: … ». Touches `messageSelector:up/down/top/bottom/select`. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Limites : modifications faites par Bash non suivies, éditions des sous-agents (hors fork au premier plan) non restaurées, messages envoyés en cours de tour non listés, symlinks et hardlinks ignorés. — [Checkpointing](https://code.claude.com/docs/en/checkpointing)

### Inferences
- Le flux attendu comporte deux écrans : une liste des prompts de l'utilisateur (avec heure et nombre de fichiers modifiés), puis une confirmation avec les options. Il y a aussi une variante « fork » (restaurer dans une nouvelle branche).

### Gaps
- Je n'ai pas vérifié à l'écran la disposition exacte de la liste des messages (horodatage, extrait du prompt, `N files changed`).

---

## Q7. Notifications : cloche, notifications OS, iTerm2/Ghostty/Kitty, `preferredNotifChannel`

### Takeaway
Par défaut, CC n'envoie une notification de bureau que dans **Ghostty, Kitty et iTerm2**. Ailleurs, il faut `preferredNotifChannel: "terminal_bell"` ou un hook `Notification`. Les canaux sont `auto`, `iterm2` (OSC 9), `terminal_bell` (`\a`), `iterm2_with_bell`, `kitty` (OSC 99), `ghostty` (OSC 777) et `notifications_disabled`.

### Cited Findings
- « By default Claude Code sends a desktop notification only in Ghostty, Kitty, and iTerm2. In other terminals, set `preferredNotifChannel` to `"terminal_bell"` … or configure a Notification hook. » La notification passe par SSH. iTerm2 exige « Notification Center Alerts » + « Send escape sequence-generated alerts ». tmux exige le *passthrough*. — [Terminal config](https://code.claude.com/docs/en/terminal-config)
- Valeurs et libellés du menu `/config` → « Notifications » : `auto` → « Auto » ; `iterm2` → « iTerm2 (OSC 9) » ; `terminal_bell` → « Terminal Bell (\a) » ; `kitty` → « Kitty (OSC 99) » ; `ghostty` → « Ghostty (OSC 777) » ; `iterm2_with_bell` → « iTerm2 w/ Bell » ; `notifications_disabled` → « Disabled ». Libellés courts : `bell`, `iterm2+bell`, `none`. En auto, Apple_Terminal se rabat sur `terminal_bell`. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Types d'événements notifiés : `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `agent_needs_input`, `agent_completed`, `elicitation_url_dialog`, `worker_permission_prompt`, `push_notification`, `computer_use_enter`, `computer_use_exit`, `quota_auto_resume_fired`… — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Notifications push vers le mobile (2026) : réglages « Push when actions required » et « Push when Claude decides ». Le menu s'intitule alors « Local notifications ». Options de canal « Notify when Claude needs you » et « Notify when Claude is done ». — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282) ; [What's new W16](https://code.claude.com/docs/en/whats-new)
- Signaux terminal voisins : « Terminal progress bar » (« Emit OSC 9;4 progress sequences during long operations ») et « Show status in terminal tab ». `/terminal-setup` coupe la cloche audible d'Apple Terminal. — [binaire 2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282) ; [Commands](https://code.claude.com/docs/en/commands)

### Inferences
- Pour un clone Ink sous Linux/VTE (GNOME Terminal), le comportement CC par défaut est **aucune notification**, sauf si le canal `terminal_bell` est configuré. Émettre OSC 777 ou OSC 9 dans VTE ne serait pas la parité par défaut.

### Gaps
- Je n'ai pas le texte exact des titres et corps de notification (« Claude needs your permission… », « Claude is waiting for your input ») pour 2.1.282.

---

## Q8. Mode headless et print (`-p`, stream-json) : ce qui touche l'UX (bref)

### Takeaway
`-p` accepte `--output-format text|json|stream-json`. En JSON, `total_cost_usd` et le coût par modèle sont inclus. Beaucoup de commandes slash ont une forme texte en `-p` : `/config key=value`, `/model <m>`, `/mcp`, `/output-style`, `/rename`, `/color`, `/effort`, `/import`, `/reload-plugins`, `/advisor`.

### Cited Findings
- « `stream-json`: newline-delimited JSON for real-time streaming » ; `--output-format json` inclut `total_cost_usd` et une ventilation par modèle ; `--json-schema` remplit `structured_output`. — [Headless](https://code.claude.com/docs/en/headless)
- En `-p`, `/mcp` sans argument imprime un résumé texte, `/model <m>` ne vaut que pour la session, `/import` liste puis donne la commande de confirmation, `/usage-credits` refuse et demande une session interactive. Le récapitulatif de session est désactivé en `-p`. — [Commands](https://code.claude.com/docs/en/commands) ; [Costs](https://code.claude.com/docs/en/costs) ; [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Les avertissements de modèle retiré vont sur stderr en format texte (v2.1.182), pas en `json`/`stream-json`. — [Model config](https://code.claude.com/docs/en/model-config)

### Inferences
- Pour la parité headless, les formes texte des commandes (surtout `/context` en tableau Markdown, cf. Q2) sont les sorties à comparer.

### Gaps
- Je n'ai pas relevé le schéma détaillé des événements `stream-json`, jugé hors du périmètre UX TUI.
