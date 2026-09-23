# Claude Code CLI (v2.x, état au 22 sept. 2026) — Sessions, configuration et extensibilité

Contexte de versionnage (vérifié) : dernière version publiée sur npm `@anthropic-ai/claude-code` = **2.1.280 (2026-09-22)**, tag `stable` = 2.1.267 ; jalons : 1.0.0 = 2025-05-22, 2.0.0 = 2025-09-29, 2.1.0 = 2026-01-07, 2.1.100 ≈ 2026-04-10, 2.1.200 = 2026-07-03, 2.1.250 = 2026-08-27, 2.1.269 = 2026-09-11. Le CHANGELOG GitHub n'a pas de dates ; les dates ci-dessous viennent du registre npm. — [npm registry](https://registry.npmjs.org/@anthropic-ai/claude-code) ; [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

Note de méthode : la documentation officielle a migré de `docs.claude.com/en/docs/claude-code/` vers `code.claude.com/docs/en/` (les pages sont servies en Markdown brut via le suffixe `.md`). Les tables de commandes/flags/variables ci-dessous ont été extraites du Markdown brut, pas d'un résumé.

---

## Q1. Catalogue complet des slash commands intégrées (2026)

### Takeaway
La table officielle (page `commands`) liste ~110 entrées en trois catégories : commandes intégrées, « bundled skills » (marquées **Skill**, en fait des SKILL.md livrés avec le binaire) et « bundled workflows ». Plusieurs commandes historiques ont été **retirées** (`/vim` v2.1.92, `/pr-comments` v2.1.91, `/ultraplan`, `/agents` réduit à un rappel depuis v2.1.198) et beaucoup d'entrées 2026 sont liées au cloud/Desktop/Remote Control.

### Cited Findings
Liste exhaustive (nom exact → comportement en une ligne), source unique : [Commands reference](https://code.claude.com/docs/en/commands)

- `/add-dir <path>` — ajoute un répertoire de travail pour la session (autocomplétion Tab ; la config `.claude/` du dossier ajouté n'est pas découverte, sauf `.claude/skills/`).
- `/advisor [model|off]` — active l'outil « advisor » qui consulte un second modèle (`fable`, `opus`, `sonnet` ou ID complet) ; sans argument, picker.
- `/agents` — depuis v2.1.198, imprime seulement un rappel (demander à Claude ou éditer `.claude/agents/`, `~/.claude/agents/`) ; avant, UI interactive de gestion des subagents.
- `/artifacts` — liste les artifacts (pages web publiées), attache/ouvre/copie le lien (v2.1.208+).
- `/auto-mode-setup` — rédige des entrées `autoMode.environment` (plans Pro/Max/Team, v2.1.228+).
- `/autocompact [auto|<tokens>]` — règle la fenêtre d'auto-compaction (`500k`, `auto`), sauvegardée dans les user settings (v2.1.221+).
- `/autofix-pr [prompt]` — lance une session cloud qui surveille la PR de la branche et pousse des correctifs.
- `/background [prompt]` — détache la session courante en agent d'arrière-plan et libère le terminal.
- `/batch <instruction>` — **Skill** : orchestre des changements massifs en 5-30 unités parallèles.
- `/branch [name]` — crée une branche de la conversation (copie du transcript) et y bascule.
- `/btw [question]` — question annexe sans polluer la conversation ; sans argument, réaffiche la dernière réponse.
- `/bug [report]` — signale un bug / partage la conversation (écran de consentement). Alias `/share`.
- `/cd <path>` — déplace la session vers un autre répertoire en gardant la conversation.
- `/chrome` — configure Claude in Chrome.
- `/claude-api [migrate|upgrade|managed-agents-onboard|prompt-audit|cost-optimize|build-eval|hillclimb]` — **Skill** de référence API.
- `/clear [name]` — nouvelle conversation vide ; l'ancienne reste résumable via `/resume` ; le nom optionnel étiquette la conversation quittée.
- `/code-review [low|medium|high|xhigh|max|ultra] [--fix] [--comment] [pr#|branch|path]` — **Skill** de revue ; alias `/review` ; `/ultrareview` = alias de `/code-review ultra`.
- `/color [color|default]` — couleur de la barre de prompt pour la session.
- `/compact [instructions]` — résume la conversation, avec instructions de focalisation optionnelles.
- `/config [key=value ...]` — ouvre l'interface Settings (onglets Config/Status…) ; `key=value` règle directement (`/config verbose=true`, `/config thinking=false`).
- `/context [all]` — visualise l'usage du contexte en grille colorée avec suggestions d'optimisation.
- `/copy [N]` — copie la N-ième dernière réponse dans le presse-papiers.
- `/cost` — alias de `/usage`.
- `/dataviz [request]`, `/design [brief]`, `/design-login`, `/design-sync [hint]` — **Skills** design/graphiques (artifacts).
- `/debug [description]` — **Skill** : active le debug logging et lit `~/.claude/debug/<session-id>.txt`.
- `/deep-research <question>` — **Workflow** intégré (fan-out de recherches web, vérification croisée, rapport cité) ; v2.1.218+.
- `/desktop` — continue la session dans l'app Desktop (alias `/app`).
- `/diff` — revue des changements du working tree (panneau diff).
- `/doctor` — **Skill** (depuis v2.1.205) : diagnostic d'installation/settings et corrections.
- `/effort [level|auto|status]` — niveau d'effort `low`…`xhigh`, `max`, `ultracode`, `auto`.
- `/exit` — quitte (alias `/quit`) ; dans une session background attachée, détache seulement.
- `/export [filename]` — exporte la conversation en texte brut (dialogue clipboard/fichier ou fichier direct).
- `/fast [on|off]` — bascule le fast mode.
- `/feedback [report]` — retour produit (même dialogue que `/bug`).
- `/fewer-permission-prompts` — **Skill** : analyse les transcripts et ajoute une allowlist à `.claude/settings.json`.
- `/focus` — vue focalisée (dernier prompt + résumé des outils + réponse finale).
- `/fork [prompt]` — copie la conversation dans une nouvelle session background.
- `/goal [condition|clear]` — objectif de complétion : Claude enchaîne les tours jusqu'à ce qu'un petit modèle juge la condition atteinte (v2.1.139+).
- `/heapdump` — snapshot mémoire JS (commande cachée du menu).
- `/help` — aide et commandes disponibles (onglets, dont « Custom commands »).
- `/hooks` — visualise la configuration des hooks (lecture seule).
- `/ide` — gère les intégrations IDE et leur statut.
- `/import [codex|gemini|cursor] [--dry-run] [--yes]` — importe la configuration de Codex, Gemini CLI ou Cursor.
- `/init` — génère un `CLAUDE.md` ; `CLAUDE_CODE_NEW_INIT=1` = flux interactif multi-phases (CLAUDE.md, skills, hooks).
- `/insights` — rapport HTML d'analyse des sessions récentes (`~/.claude/usage-data/report.html`) ; v2.1.101+.
- `/install-github-app`, `/install-slack-app` — installation des apps GitHub/Slack.
- `/keybindings` — ouvre `~/.claude/keybindings.json`.
- `/list-agents` — liste subagents, teammates et autres sessions adressables.
- `/login`, `/logout` — authentification.
- `/loop [interval] [prompt]` — **Skill** : répète un prompt (intervalle fixe ou auto-rythmé) ; v2.1.71+.
- `/mcp [reconnect <server>|enable|disable [<server>|all]]` — gestion des serveurs MCP et OAuth.
- `/memory` — édite les CLAUDE.md, active/désactive l'auto memory, ouvre le dossier mémoire.
- `/mobile` — QR code app mobile (alias `/ios`, `/android`).
- `/model [model]` — change de modèle et sauvegarde comme défaut ; flèches gauche/droite pour l'effort.
- `/output-style [style]` — liste/sélectionne un output style (v2.1.269+).
- `/passes` — partage une semaine gratuite (si éligible).
- `/permissions` — dialogue interactif allow/ask/deny par scope, gestion du workspace trust.
- `/plan [description]` — entre en plan mode directement.
- `/plugin [subcommand]` — menu des plugins ou sous-commandes `list`, `install`, `enable`, `disable`, `marketplace add …`.
- `/powerup` — leçons interactives animées sur les fonctionnalités.
- `/pr-comments [PR]` — **retiré en v2.1.91** (demander à Claude directement).
- `/privacy-settings` — paramètres de confidentialité (Pro/Max).
- `/radio` — ouvre « Claude FM » (lo-fi) dans le navigateur.
- `/rate-limit-options` — options quand une limite d'usage bloque (attendre, crédits…).
- `/recap` — résumé d'une ligne de la session.
- `/release-notes` — changelog dans un picker de versions.
- `/reload-plugins [--force]`, `/reload-skills` — rechargent plugins / répertoires de skills sans redémarrer.
- `/remote-control` — rend la session accessible depuis claude.ai / mobile (alias `/rc` côté CLI flag `--rc`).
- `/remote-env` — environnement cloud par défaut.
- `/rename [name]` — renomme la session (nom affiché sur la barre de prompt) ; sans nom, génère un nom.
- `/resume [session]` — reprend par ID ou nom, ou ouvre le picker (sessions background marquées `bg`).
- `/rewind` — rembobine conversation et/ou code, ou résume depuis un message ; alias `/checkpoint`, `/undo`.
- `/run`, `/verify`, `/run-skill-generator` — **Skills** : lancer/piloter l'app, vérifier en la faisant tourner, générer la recette de build (v2.1.215+ pour `/verify`).
- `/sandbox` — bascule le mode sandbox (plateformes supportées).
- `/schedule [description]` — crée/liste/exécute des **routines cloud** (cron) ; v2.1.139+.
- `/scroll-speed` — vitesse de la molette (fullscreen).
- `/security-review` — analyse de sécurité du diff branche vs default.
- `/setup-bedrock`, `/setup-vertex` — assistants de configuration provider (cachés sauf si `CLAUDE_CODE_USE_BEDROCK`/`VERTEX`).
- `/simplify [target]` — **Skill** : 4 agents de revue parallèles pour simplifier le diff.
- `/skill-doctor` — coût en contexte et fréquence d'usage de chaque skill (v2.1.252+).
- `/skills` — liste/filtre/tri par tokens des skills ; `Space`/`Enter` cycle la visibilité d'un skill.
- `/stats` — alias de `/usage` (onglet Stats).
- `/status` — interface Settings, onglet Status (version, modèle, compte, connectivité, « Setting sources »).
- `/statusline` — configure la status line en langage naturel (agent `statusline-setup`).
- `/stickers` — commande de stickers.
- `/stop` — arrête la session background courante (attachée).
- `/subtask <task>` — lance un subagent « fork » en arrière-plan qui hérite de toute la conversation.
- `/tasks` — liste le travail en arrière-plan (subagents, shells, loops) ; alias `/bashes`.
- `/team-onboarding` — génère un guide d'onboarding à partir de 30 jours d'usage.
- `/teleport` — tire une session cloud dans le terminal (alias `/tp`).
- `/terminal-setup` — installe Shift+Enter (VS Code, Cursor, Zed, Alacritty…) / Option+Enter (Apple Terminal).
- `/theme` — thème : `auto` (détection fond clair/sombre), variantes light/dark, daltonien, ANSI.
- `/tui [default|fullscreen]` — bascule le rendu plein écran (research preview).
- `/ultraplan <prompt>` — **retiré** (utiliser plan mode).
- `/ultrareview [PR or branch]` — revue profonde multi-agents dans un sandbox cloud.
- `/update-config [request]` — **Skill** : édite `settings.json` à partir d'une demande en langage naturel.
- `/upgrade` — page de montée de plan.
- `/usage` — coût de session, limites de plan (fenêtres 5 h / 7 j), attribution par skill/subagent/MCP ; `/usage-credits` — crédits d'usage.
- `/vim` — **retiré en v2.1.92** ; mode Vim via `/config` → Editor mode.
- `/voice [hold|tap|…]` — dictée vocale.
- `/web-setup` — connecte GitHub (via `gh`) pour les sessions cloud.
- `/workflow-authoring` — **Skill** de référence pour écrire des scripts de workflow ; `/workflows` — vue de progression (pause `p`, stop `x`, restart `r`, save `s`).

- Commandes cachées : « Claude Code keeps a few available commands, such as `/heapdump`, out of the menu by design ». Une commande envoyée pendant une réponse est mise en file et exécutée après le tour (certaines s'exécutent immédiatement). — [Commands reference](https://code.claude.com/docs/en/commands)
- Datation (première mention dans le CHANGELOG, dates npm) : `/rewind` & `/usage` & « Tab to toggle thinking » = 2.0.0 (2025-09-29) ; `/context` = 1.0.86 ; `/statusline` = 1.0.71 ; `/output-style` = 1.0.81 (2025-08) ; `/stats`, `/rename`, `.claude/rules` = 2.0.64 (2025-12-10) ; `/theme` = 2.0.73 ; `/fork` = 2.1.47 (2026-02-18) ; `/loop` = 2.1.71 ; `/effort` = 2.1.72 ; `/branch` = 2.1.77 ; `/btw` = 2.1.79 (2026-03-18) ; `--bare` = 2.1.81 ; `--json-schema` = 2.1.84 ; `/insights` & `/ultraplan` = 2.1.101 (2026-04-10) ; `/focus` = 2.1.110 ; `/desktop` = 2.1.136 ; `/goal` & `/schedule` = 2.1.139 (2026-05-11) ; `/diff` = 2.1.149 ; `ultracode` = 2.1.160 ; modèle Fable = 2.1.170 (2026-06-09) ; `/verify` = 2.1.215 ; `/autocompact` = 2.1.234 (2026-08-17). — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) ; [npm](https://registry.npmjs.org/@anthropic-ai/claude-code)

### Inferences
- Pour Fuller, le socle minimal « parité 2025 » est : `/help /clear /compact /context /cost|/usage /model /effort /config /status /doctor /init /memory /permissions /hooks /mcp /agents /skills /plugin /resume /rename /rewind /export /copy /diff /theme /keybindings /statusline /terminal-setup /release-notes /bug|/feedback /login|/logout /add-dir /cd /plan /tasks /btw /loop /goal /branch /fork /output-style /fast`. Les commandes cloud/Desktop/Remote Control/artifacts sont spécifiques à l'écosystème Anthropic.
- La tendance 2026 est de convertir les commandes en skills empaquetés (« bundled skills ») : une architecture où `/xxx` = fichier SKILL.md est plus économique qu'un switch de commandes codé en dur.

### Gaps
- Le CHANGELOG ne mentionne pas explicitement la première apparition de `/import` ni de `/help` ; les dates de version sont dérivées du registre npm (publication), pas de dates officielles de release notes.

---

## Q2. Commandes custom, Skills, plugins/marketplaces, output styles

### Takeaway
En 2026 « Custom commands have been merged into skills » : `.claude/commands/deploy.md` et `.claude/skills/deploy/SKILL.md` créent tous deux `/deploy`. Le format SKILL.md (Agent Skills open standard, agentskills.io) offre ~20 champs de frontmatter, la substitution `$ARGUMENTS`/`$0`/`$name`, l'injection shell `` !`cmd` ``, l'exécution forkée dans un subagent, et des hooks. Les plugins (`.claude-plugin/plugin.json`) regroupent skills/agents/hooks/MCP/LSP/workflows et se distribuent via des marketplaces.

### Cited Findings
**Emplacements et nommage**
- Ancien format : `~/.claude/commands/<name>.md` (perso), `.claude/commands/<name>.md` (projet), sous-dossier → namespace `/subdir:name` (`.claude/commands/frontend/component.md` → `/frontend:component`). Format moderne : `~/.claude/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md`, skills imbriqués `apps/web/.claude/skills/deploy/SKILL.md` → `/apps/web:deploy`. Le nom de commande = nom du dossier (ou du fichier), le champ `name` ne fixe le nom que pour les plugins. — [Slash commands](https://code.claude.com/docs/en/slash-commands)
- Autres scopes : skills entreprise (`.claude/skills/` dans le répertoire managed settings), plugins (`/plugin-name:skill-name`), `--add-dir` (`.claude/skills/` du dossier ajouté), skills synchronisés depuis claude.ai (`~/.claude/skills/synced/`, v2.1.273+, désactivable par `"syncClaudeAiSkills": false`). — [Skills](https://code.claude.com/docs/en/skills)
- Résolution des conflits : Enterprise > Personal > Project ; skill local > skill bundled (sauf alias) ; skill > command file ; plugin toujours namespacé ; synced accessible via `/anthropic-skills:name`. — [Slash commands](https://code.claude.com/docs/en/slash-commands)

**Frontmatter SKILL.md (champs et sens)**
- `name`, `description` (auto-invocation ; `description` + `when_to_use` ≤ 1 536 caractères), `when_to_use`, `argument-hint` (`[issue-number]`), `arguments: [issue, branch]` (→ `$issue`, `$branch`), `disable-model-invocation: true` (seul l'utilisateur peut invoquer ; contenu absent du contexte), `user-invocable: false` (seul Claude, caché du menu `/`), `allowed-tools: Bash(git add *) Bash(git commit *)` (pré-approbation pour un tour), `disallowed-tools`, `model`, `effort` (`low|medium|high|xhigh|max`), `context: fork` + `agent: Explore|Plan|general-purpose|<custom>` + `background: false`, `hooks: {...}`, `paths: src/**/*.js` (auto-chargement par glob), `shell: bash|powershell`, `metadata`, `license`, `compatibility` (≤ 500 car.). Booléens acceptés : `true/false/yes/no/on/off/1/0` (v2.1.218+). — [Skills](https://code.claude.com/docs/en/skills)
- Substitutions : `$ARGUMENTS`, `$ARGUMENTS[N]`, `$N` (`$0` = premier), `$name`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_PROJECT_DIR}` (v2.1.196+), `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_EFFORT}` ; arguments multi-mots entre guillemets ; `\$1.00` échappe le `$`. — [Slash commands](https://code.claude.com/docs/en/slash-commands)
- Injection dynamique : `` !`git status --short` `` inline ou bloc ```` ```! ```` multi-lignes ; exécuté une fois avant que Claude voie le contenu ; exit non nul aborte le skill (« Shell command failed for pattern ») sauf exit 1 des commandes de recherche ; soumis aux règles de permission ; désactivable par `disableSkillShellExecution: true` ; jamais exécuté pour les skills synchronisés (v2.1.228+). — [Skills](https://code.claude.com/docs/en/skills)
- Pensée étendue : inclure `ultrathink` n'importe où dans le skill/prompt ; « think », « think hard » ne sont plus des mots-clés reconnus. — [Slash commands](https://code.claude.com/docs/en/slash-commands) ; [Model config](https://code.claude.com/docs/en/model-config)
- Empilement : `/write-tests /fix-issue 123` étend le premier skill + jusqu'à 5 autres ; un skill forké termine la chaîne. — [Slash commands](https://code.claude.com/docs/en/slash-commands)
- Chargement : les descriptions de tous les skills sont dans le system prompt à chaque tour ; le contenu complet se charge à l'invocation (`/name` ou outil `Skill`) et persiste dans la session ; budget de ré-attachement après compaction 25 000 tokens ; modifications de `SKILL.md` détectées à chaud. Permissions : règles `Skill(name)`, `Skill(name *)`. Visibilité : `skillOverrides: {"deploy": "off" | "name-only" | "user-invocable-only"}`, `disableBundledSkills: true`. — [Skills](https://code.claude.com/docs/en/skills)
- Bundled skills listés : `/run /verify /run-skill-generator /debug /code-review (/review) /batch /loop /claude-api /simplify /security-review /init /doctor /keybindings-help /update-config /schedule`. — [Skills](https://code.claude.com/docs/en/skills)
- Références `@fichier` dans les skills : mentionnées (« Claude Code doesn't attach the files that `@` references name the way it does for a local skill » pour les skills synced) ; dans le prompt interactif, `@` déclenche l'autocomplétion de chemins et, avec cross-session messaging, propose les autres sessions live (v2.1.232+). — [Slash commands](https://code.claude.com/docs/en/slash-commands) ; [Interactive mode](https://code.claude.com/docs/en/interactive-mode)

**Plugins & marketplaces**
- Structure : `.claude-plugin/plugin.json` (manifeste, optionnel), `skills/<name>/SKILL.md`, `commands/*.md` (legacy), `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `monitors/monitors.json`, `bin/` (ajouté au PATH de Bash), `settings.json` (seules clés `agent` et `subagentStatusLine`), `workflows/`, `output-styles/`. Un plugin à skill unique peut mettre `SKILL.md` à la racine. — [Create plugins](https://code.claude.com/docs/en/plugins)
- Manifeste : `name` (kebab-case, namespace des skills), `version` (semver, pilote les mises à jour), `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `skills`, `commands`, `agents`, `workflows`, `hooks`, `mcpServers`, `outputStyles`, `lspServers`, `channels`, `dependencies`, `options` (champs configurables via `/config`). — [Plugins reference](https://code.claude.com/docs/en/plugins-reference)
- Test local : `claude --plugin-dir ./my-plugin` (ou `.zip`, ou dossier de plugins v2.1.265+), `--plugin-url https://…/plugin.zip` ; `/reload-plugins` ; `claude plugin validate ./plugin [--strict]` ; `claude plugin init <name>` scaffolde dans `~/.claude/skills/<name>/` (chargé comme `<name>@skills-dir`) ; `claude plugin eval` pour des suites d'évaluation. — [Create plugins](https://code.claude.com/docs/en/plugins)
- CLI : `claude plugin install formatter@my-marketplace [--scope user|project|local]`, `uninstall`, `enable`, `disable`, `update`, `list`, `marketplace add|list|remove|update` (`claude plugin marketplace add anthropics/claude-plugins-official`, `--claudeai <org-library>`). Dans la session : `/plugin marketplace add anthropics/claude-plugins-community`, `/plugin install name@marketplace`. Marketplaces publiques : `claude-plugins-official` (curée, enregistrée automatiquement au premier lancement interactif) et `claude-community` (soumissions revues). — [Discover plugins](https://code.claude.com/docs/en/discover-plugins) ; [Create plugins](https://code.claude.com/docs/en/plugins)
- Persistance : clé `enabledPlugins` dans settings (`--scope project` écrit `.claude/settings.json`), `extraKnownMarketplaces`, `strictKnownMarketplaces`, `blockedMarketplaces`, `pluginConfigs`, `syncClaudeAiPlugins` ; cache local `~/.claude/plugins/cache`, `~/.claude/plugins/installed_plugins.json`, `~/.claude/plugins/synced/`, données `~/.claude/plugins/data/{id}/` (= `${CLAUDE_PLUGIN_DATA}`). — [Plugins reference](https://code.claude.com/docs/en/plugins-reference) ; [Settings reference](https://code.claude.com/docs/en/settings-reference)
- Le menu `/plugin` a un onglet **Errors** où apparaissent les serveurs LSP/plugins qui échouent à charger. — [Create plugins](https://code.claude.com/docs/en/plugins)

**Output styles**
- 4 styles intégrés + Default : **Proactive** (démarre sans poser de questions de routine), **Concise** (v2.1.237+), **Explanatory** (blocs `★ Insight`), **Learning** (laisse des `TODO(human)`). Sélection : `/output-style concise`, `/config` → Output style, clé `"outputStyle": "Explanatory"` (sensible à la casse, écrite dans `.claude/settings.local.json`). Fichiers custom : `~/.claude/output-styles/*.md`, `.claude/output-styles/`, managed ; frontmatter `name`, `description`, `keep-coding-instructions: true` (garde les instructions d'ingénierie par défaut), `force-for-plugin`. Les styles ne s'appliquent pas aux subagents (sauf forks). — [Output styles](https://code.claude.com/docs/en/output-styles)

### Inferences
- Implémenter SKILL.md tel quel (même frontmatter) rend Fuller compatible avec l'écosystème existant de skills et avec le standard Agent Skills, à moindre coût.
- Le mécanisme « description toujours en contexte, corps chargé à la demande » (progressive disclosure) est la clé de la maîtrise du coût de contexte ; à reproduire avec un budget (Claude Code : 25 k tokens de ré-attachement post-compaction).

### Gaps
- La syntaxe exacte de `@path` dans les fichiers de commandes (inclusion de fichier) n'est pas détaillée dans la page 2026 ; seule l'existence de références `@` est confirmée.

---

## Q3. Mémoire : CLAUDE.md, rules, imports, auto memory

### Takeaway
Hiérarchie à 4 niveaux (managed, user, project, local) + `.claude/rules/*.md` scopés par `paths:` + imports `@path` (profondeur 4) + AGENTS.md (v2.1.277+) + **auto memory** (Claude écrit lui-même `~/.claude/projects/<project>/memory/MEMORY.md`, 200 lignes / 25 KB chargées). Le raccourci `#` n'apparaît plus dans les quick commands 2026.

### Cited Findings
- Emplacements : managed = `/Library/Application Support/ClaudeCode/CLAUDE.md` (macOS), `/etc/claude-code/CLAUDE.md` (Linux/WSL), `C:\Program Files\ClaudeCode\CLAUDE.md` ; user = `~/.claude/CLAUDE.md` ; projet = `./CLAUDE.md` ou `./.claude/CLAUDE.md` ; local = `./CLAUDE.local.md` (à gitignorer). Alternative managed : clé `claudeMd` directement dans `managed-settings.json`. — [Memory](https://code.claude.com/docs/en/memory)
- Chargement : tous les `CLAUDE.md`/`CLAUDE.local.md` du cwd et des répertoires parents sont chargés au lancement, concaténés de la racine vers le cwd (`CLAUDE.local.md` après `CLAUDE.md` à chaque niveau) ; ceux des sous-répertoires se chargent « on demand » quand Claude lit des fichiers de ces dossiers ; fichier max 4 MiB, cible < 200 lignes. — [Memory](https://code.claude.com/docs/en/memory)
- Imports : `@path/to/import` (relatif au fichier, ou absolu, ou `@~/.claude/my-project-instructions.md`), récursifs jusqu'à 4 sauts, ignorés dans les blocs/spans de code ; les imports « externes » (hors cwd) d'un fichier projet déclenchent un dialogue d'approbation unique. — [Memory](https://code.claude.com/docs/en/memory)
- Rules : `.claude/rules/*.md` (récursif, symlinks acceptés) et `~/.claude/rules/` ; frontmatter `paths:` (liste YAML ou string, globs avec accolades, budget 1 000 patterns/4 MiB) ; sans `paths` = inconditionnel. Exclusion : `claudeMdExcludes: ["**/monorepo/CLAUDE.md", ".../other-team/.claude/rules/**"]` (toute couche de settings ; les managed ne sont jamais exclus). — [Memory](https://code.claude.com/docs/en/memory)
- AGENTS.md : lu seulement s'il n'y a aucun `CLAUDE.md`/`CLAUDE.local.md` au-dessus (v2.1.277+) ; réglage `pluginConfigs["agents-md@builtin"].options.instructionFiles` = `claude-md-or-agents-md` (défaut) | `claude-md-and-agents-md` | `managed-only`. — [Memory](https://code.claude.com/docs/en/memory)
- `/init` : génère un CLAUDE.md (ou propose des améliorations s'il existe) ; `CLAUDE_CODE_NEW_INIT=1` → flux interactif (CLAUDE.md, skills, hooks, option « personal » créant `CLAUDE.local.md`). `/memory` : liste user/project CLAUDE.md, CLAUDE.local.md, entrées mémoire, toggle auto memory, ouverture dans l'éditeur. `/context` montre quels CLAUDE.md/rules sont chargés. — [Memory](https://code.claude.com/docs/en/memory)
- Auto memory (on par défaut) : 4 types (`user`, `feedback`, `project`, `reference`), stockée dans `~/.claude/projects/<project>/memory/` (`MEMORY.md` = index + fichiers thématiques `user_role.md`, `feedback_testing.md`…), `<project>` dérivé du dépôt git (worktrees partagés) ; premières 200 lignes / 25 KB de `MEMORY.md` chargées à chaque session, le reste à la demande ; champ `modified` (ISO 8601) ajouté au frontmatter (v2.1.214+) ; jamais purgée par le retention sweep ; messages « Saved 2 memories » / « Recalled 2 memories » ; désactivation : `"autoMemoryEnabled": false`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` ; emplacement : `"autoMemoryDirectory": "~/…"` ; non chargée dans les subagents (sauf forks). — [Memory](https://code.claude.com/docs/en/memory)
- Première mention « auto memory » dans le CHANGELOG : 2.1.63 (≈ fin février 2026) ; `.claude/rules` : 2.0.64 (2025-12-10) ; imports `@` : 0.2.107. — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Quick commands documentées en 2026 : `/` (commande), `!` (shell), `@` (fichier), `:` (emoji), `?` (aide) — pas de `#`. « When you ask Claude to remember something… Claude saves it to auto memory. To add instructions to CLAUDE.md instead, ask Claude directly… or edit the file yourself via `/memory`. » — [Interactive mode](https://code.claude.com/docs/en/interactive-mode) ; [Memory](https://code.claude.com/docs/en/memory)

### Inferences
- L'ancien raccourci `#` (quick memory, 2025) semble remplacé par l'auto memory + `/memory` ; Fuller peut conserver `#` comme raccourci mais l'écrire dans un fichier d'auto memory plutôt que dans CLAUDE.md.
- Le découpage « index MEMORY.md court + fichiers thématiques lus à la demande » est un bon patron pour une mémoire persistante à coût de contexte borné.

### Gaps
- Aucune page 2026 ne documente encore un raccourci `#` ; sa suppression est déduite de son absence dans la table des quick commands, non d'une note de retrait explicite.

---

## Q4. Hooks

### Takeaway
Une trentaine d'événements (2026) couvrant outils, permissions, session, compaction, subagents, teams, workflows, worktrees, modèle, fichiers ; 5 types de handlers (`command`, `http`, `mcp_tool`, `prompt`, `agent`) ; contrat JSON stdin/stdout ; exit 2 = blocage ; `/hooks` = navigateur en lecture seule.

### Cited Findings
- Événements (table officielle, cadence) : `SessionStart` (matcher `startup|resume|clear|compact|fork`), `Setup` (`init|maintenance`, via `--init`, `--init-only`, `--maintenance`), `UserPromptSubmit`, `UserPromptExpansion`, `PreToolUse`, `PermissionRequest`, `PermissionDenied`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Notification` (`permission_prompt|idle_prompt|auth_success|elicitation_dialog`), `MessageDisplay`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `Stop`, `StopFailure` (`rate_limit|overloaded|authentication_failed|server_error`), `TeammateIdle`, `InstructionsLoaded` (`session_start|nested_traversal|path_glob_match|include|compact`), `ConfigChange` (`user_settings|project_settings|local_settings|policy_settings`), `CwdChanged`, `DirectoryAdded`, `FileChanged` (matcher = noms de fichiers), `WorktreeCreate`, `WorktreeRemove`, `PreCompact` (`manual|auto`), `PostCompact`, `PreModelSwitch`, `PostModelSwitch`, `Elicitation`, `ElicitationResult`, `SessionEnd` (`clear|resume|logout|prompt_input_exit|other`). — [Hooks reference](https://code.claude.com/docs/en/hooks)
- Format settings.json :
  ```json
  { "hooks": { "PreToolUse": [ { "matcher": "Bash|Edit|Write", "hooks": [ { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/check.sh", "args": [], "if": "Bash(rm *)", "timeout": 600, "statusMessage": "Running security check...", "async": false, "asyncRewake": false, "once": false, "shell": "bash" } ] } ] }, "disableAllHooks": false }
  ```
  Matcher : `*`/vide = tout ; lettres/`|` = liste exacte ; sinon regex JS non ancrée (`^Notebook`, `mcp__memory__.*`). Timeouts par défaut : 600 s (command/http/mcp_tool), 30 s (prompt), 60 s (agent). Forme « exec » (avec `args`, sans shell) vs « shell » (`sh -c`). — [Hooks reference](https://code.claude.com/docs/en/hooks)
- Autres handlers : `{"type":"http","url":"http://localhost:8080/hooks/pre-tool-use","headers":{"Authorization":"Bearer $MY_TOKEN"},"allowedEnvVars":["MY_TOKEN"]}` ; `{"type":"mcp_tool","server":"my_server","tool":"security_scan","input":{"file_path":"${tool_input.file_path}"}}` ; `{"type":"prompt","prompt":"Is this command safe? $ARGUMENTS","model":"…"}` ; `{"type":"agent","prompt":"Verify that $ARGUMENTS is appropriate"}`. — [Hooks reference](https://code.claude.com/docs/en/hooks)
- Stdin JSON commun : `session_id`, `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode`, `effort: {level}`, `hook_event_name`, (+ `agent_id`, `agent_type` en subagent) ; événements outil : `tool_name`, `tool_input`, `tool_use_id`. — [Hooks reference](https://code.claude.com/docs/en/hooks)
- Codes de sortie : 0 = succès (stdout JSON parsé si `{…}`) ; **2 = erreur bloquante** (non annulable par JSON, raison = `reason` ou stderr) ; autres = non bloquant (sauf `WorktreeCreate` : tout non-zéro annule). — [Hooks reference](https://code.claude.com/docs/en/hooks)
- Sortie JSON : `hookSpecificOutput.permissionDecision: allow|deny|ask` + `permissionDecisionReason` + `updatedInput` (PreToolUse) ; `additionalContext` (PostToolUse) ; `decision: allow|deny|prompt` (PermissionRequest) ; `retry: true` (PermissionDenied) ; `updatedInput` (UserPromptSubmit) ; `expandedText` (UserPromptExpansion) ; `stopReason` (Stop) ; `continueAfterPreCompact` (PreCompact) ; `worktreePath` (WorktreeCreate) ; champs universels `systemMessage`, `suppressOutput`, `terminalSequence`. — [Hooks reference](https://code.claude.com/docs/en/hooks)
- Emplacements : `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, managed, `hooks/hooks.json` de plugin, frontmatter `hooks:` de skill (avec `once: true`) et de subagent. Variables : `$CLAUDE_PROJECT_DIR`, `$CLAUDE_PLUGIN_ROOT`, `$CLAUDE_PLUGIN_DATA`, `$CLAUDE_CODE_REMOTE`, `$CLAUDE_EFFORT`, `$CLAUDE_PLUGIN_OPTION_*`, `CLAUDE_ENV_FILE`. Options : `async: true` (non bloquant, `asyncRewake` réveille Claude sur exit 2), `allowManagedHooksOnly`, `allowedHttpHookUrls`, `httpHookAllowedEnvVars`. `/hooks` : navigateur read-only par événement → matcher → handler avec source (User/Project/Local/Plugin/Session). — [Hooks reference](https://code.claude.com/docs/en/hooks) ; [Settings reference](https://code.claude.com/docs/en/settings-reference)
- Exemple PreToolUse pratique (filtrage de sortie de tests) renvoyant `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"command":"…"}}}`. — [Costs](https://code.claude.com/docs/en/costs)
- Datation : hooks + `/hooks` = 1.0.38 (2025-06-30) ; `UserPromptSubmit` 1.0.54 ; `PreCompact` 1.0.48 ; `SessionStart` 1.0.62 ; `SessionEnd` 1.0.85 ; `PermissionRequest` 2.0.45. — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

### Inferences
- Un noyau viable pour Fuller : `SessionStart`, `UserPromptSubmit`, `PreToolUse` (avec `permissionDecision`/`updatedInput`), `PostToolUse`, `Notification`, `Stop`, `SubagentStop`, `PreCompact`, `SessionEnd`, handler `command` avec le même contrat stdin/stdout et exit 2 — cela suffit à réutiliser la majorité des hooks communautaires existants.

### Gaps
- La liste d'événements provient d'un résumé de la page hooks (fetch summarisé) ; les noms sont cohérents avec les autres pages (features-overview, agent-teams, worktrees) mais chaque champ de payload n'a pas été vérifié individuellement.

---

## Q5. MCP

### Takeaway
`claude mcp add` avec 3 transports (stdio, http, sse déprécié ; + ws via `add-json`), 3 scopes (local/project `.mcp.json`/user), OAuth (`/mcp` ou `claude mcp login`), ressources `@server:proto://path`, prompts `/mcp__server__prompt`, outils `mcp__server__tool`, tool search différé par défaut (v2.1.274+), plafond 25 000 tokens de sortie.

### Cited Findings
- Commandes : `claude mcp add --transport http notion https://mcp.notion.com/mcp [--header "Authorization: Bearer …"]`, `claude mcp add --transport sse …` (déprécié), `claude mcp add --transport stdio airtable --env AIRTABLE_API_KEY=… -- npx -y airtable-mcp-server` (`--` sépare), `claude mcp add-json <name> '<json>' [--scope …] [--client-secret]` (supporte `{"type":"ws","url":"wss://…"}`), `add-from-claude-desktop`, `list`, `get <name>`, `remove <name> [--scope local|project|user]`, `login <name> [--no-browser] [--callback-port]`, `logout <name>`, `serve` (Claude Code comme serveur MCP stdio), `reset-project-choices`. — [MCP](https://code.claude.com/docs/en/mcp)
- Scopes : local (défaut, dans `~/.claude.json` par projet), project (`.mcp.json` à la racine, partagé git, nécessite approbation trust), user (`~/.claude.json` global). Format `.mcp.json` : `{"mcpServers":{"db":{"type":"http","url":"…","headers":{"Authorization":"Bearer ${DB_TOKEN}"},"timeout":600000},"local":{"type":"stdio","command":"/opt/bin/server","args":["--port","8080"],"env":{"CONFIG_DIR":"${CLAUDE_PROJECT_DIR}/config"}}}}` ; expansion `${VAR}` et `${VAR:-default}` dans command/args/env/url/headers ; credentials (`ANTHROPIC_API_KEY`, `NPM_TOKEN`…) jamais expansés vers des serveurs distants ; `headersHelper` script pour headers dynamiques ; bloc `oauth: {clientId, callbackPort, authServerMetadataUrl, scopes}`. — [MCP](https://code.claude.com/docs/en/mcp)
- UI `/mcp` : statut par serveur (✔ Connected, ! Needs authentication, ✘ Failed, ⏸ Pending approval, ⊘ Disabled, « cached 2h ago »), sign-in OAuth, clear auth, enable/disable, reconnect ; en mode `-p`, `/mcp` imprime un résumé texte. — [MCP](https://code.claude.com/docs/en/mcp) ; [Headless](https://code.claude.com/docs/en/headless)
- Nommage : outils `mcp__<server>__<tool>` (plugins : `mcp__plugin_<plugin>_<server>__<tool>`) ; ressources `@github:https://api.github.com/repos/owner/repo` ; prompts `/mcp__github__create-pr-description`. — [MCP](https://code.claude.com/docs/en/mcp)
- Variables : `MCP_TIMEOUT` (démarrage, 30 s par défaut en `-p`), `MCP_TOOL_TIMEOUT`, `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`, `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` (2 min → tâche de fond), `MAX_MCP_OUTPUT_TOKENS` (défaut 25 000, avertissement à 10 000 ; excédent écrit dans un fichier), `MCP_SDK_GENERATION=v1|v2`, `MCP_DISCOVERY_CACHE`, `ENABLE_CLAUDEAI_MCP_SERVERS`, `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` (v2.1.280, cap 2 048 car. des descriptions). Tool search activé par défaut v2.1.274+ (serveurs HTTP différés, connexion au premier appel ; outil `ToolSearch`). — [MCP](https://code.claude.com/docs/en/mcp) ; [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Entreprise : `allowedMcpServers`, `deniedMcpServers`, `allowManagedMcpServersOnly`, `managedMcpServers`, `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers`, `disableClaudeAiConnectors`, `allowAllClaudeAiMcps`. Flags : `--mcp-config <fichier|json>` (espace-séparés), `--strict-mcp-config`. — [Settings reference](https://code.claude.com/docs/en/settings-reference) ; [MCP](https://code.claude.com/docs/en/mcp)
- Plugins : `.mcp.json` à la racine du plugin, `${CLAUDE_PLUGIN_ROOT}` ; serveur nommé `plugin:my-plugin:database-tools`. Notifications `list_changed` supportées (v2.1.214+). — [MCP](https://code.claude.com/docs/en/mcp)

### Inferences
- Le trio « scopes + `.mcp.json` versionnable + dialogue de confiance projet » est ce qui rend MCP utilisable en équipe ; à reproduire avant la parité fonctionnelle fine (OAuth, headersHelper).

### Gaps
- Aucune source primaire consultée ne donne la liste exacte des champs du dialogue d'approbation `.mcp.json` (au-delà de « workspace trust »).

---

## Q6. Sessions, reprise et checkpoints

### Takeaway
Transcripts JSONL sous `~/.claude/projects/<cwd-encodé>/<session-id>.jsonl` (30 jours par défaut), reprise par `--continue`/`--resume <id|nom|chemin .jsonl>`/`--from-pr`, picker interactif riche (recherche, aperçu, rename, filtres Ctrl+A/Ctrl+W/Ctrl+B), nommage `-n`/`/rename`, branchement `/branch` / `--fork-session`, checkpoints automatiques par prompt avec `/rewind`/Esc Esc (5 actions dont deux modes de résumé), `/export`.

### Cited Findings
- Stockage : `~/.claude/projects/<project>/<session-id>.jsonl` où `<project>` = chemin du cwd avec les caractères non alphanumériques remplacés par `-` (tronqué à 200 car. + hash) ; sous-dossier `<session>/subagents/*.jsonl` et `<session>/tool-results/` ; format interne non stable (« changes between versions »). Réglages : `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PROJECT_DIR_NAME` (v2.1.234+), `cleanupPeriodDays` (30), `desktopSessionCleanupPeriodDays`, `CLAUDE_CODE_SKIP_PROMPT_HISTORY`, `--no-session-persistence` ; purge : `claude project purge [path] [--dry-run]`. — [Sessions](https://code.claude.com/docs/en/sessions) ; [Claude directory](https://code.claude.com/docs/en/claude-directory)
- Reprise : `claude --continue` (dernière conversation du répertoire ; ignore les sessions `-p`/SDK et celles ouvertes par `/loop`), `claude --resume` (picker), `--resume <name>` (exact → direct ; ambigu → picker pré-rempli), `--resume <session-id>` (cherché dans le projet, ses worktrees puis tous les projets, v2.1.223+), `--resume <chemin .jsonl absolu>`, `--from-pr <n>` ; `/resume [name]` en session. Restauré : historique complet, modèle, agent (`--agent`), permission mode (règles détaillées), goal actif, tâches planifiées non expirées ; non restauré : `--mcp-config`, `--settings`, `--plugin-dir`, `--fallback-model`, `--add-dir`, teammates in-process. « Resume from summary » proposé sur Pro/Max si > 1 h d'inactivité et > 100 k tokens. — [Sessions](https://code.claude.com/docs/en/sessions)
- Picker : `↑/↓`, `→/←` (groupes), `Enter`, `Space` (aperçu), `Ctrl+R` (renommer), `/` ou tout caractère = recherche (accepte une URL de PR GitHub/GitLab/Bitbucket), `Ctrl+A` (tous les projets), `Ctrl+W` (tous les worktrees), `Ctrl+B` (branche git courante), `Esc` ; chaque ligne montre nom/titre IA/résumé/premier prompt + temps écoulé + branche git + taille de fichier ; les sessions background sont marquées `bg` ; l'entrée `/resume <id> (previous session)` apparaît dans le menu rewind après `/clear` (v2.1.191+). — [Sessions](https://code.claude.com/docs/en/sessions) ; [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- Nommage : `claude -n auth-refactor` (`--name`), `/rename auth-refactor`, `Ctrl+R` dans le picker, titre généré à l'acceptation d'un plan ; sessions non nommées reçoivent un nom d'affichage `<dossier>-3f` (v2.1.196+, non résumable) et un **titre généré par le modèle Haiku** à partir du premier prompt (résumable) ; collision de nom → suffixe `-graceful-unicorn` (v2.1.232+). — [Sessions](https://code.claude.com/docs/en/sessions)
- Branches : `/branch [name]` (copie le transcript, garde les grants de permission, continue les tâches de fond) ; `claude --continue --fork-session` / `--resume abc123 --fork-session` (nouvel ID) ; `/fork [prompt]` = copie dans une session background. — [Sessions](https://code.claude.com/docs/en/sessions) ; [Commands](https://code.claude.com/docs/en/commands)
- Checkpoints : snapshot des fichiers avant chaque prompt qui démarre un tour ; 100 checkpoints max par session ; sauvegardés avec la conversation (rewind possible après resume) ; snapshots dans `~/.claude/file-history/<session>/`, purgés à ~30 jours (`cleanupPeriodDays`) ; `fileCheckpointingEnabled` / `CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING`. Menu (`/rewind` ou `Esc Esc` sur input vide) : **Restore code and conversation**, **Restore conversation**, **Restore code**, **Summarize from here**, **Summarize up to here** (+ instructions optionnelles), **Never mind** ; `/rewind [N]` selon la table de commandes recule de N tours. Limites : modifications via Bash non suivies, edits de subagents (sauf fork foreground) non restaurés, symlinks/hard links ignorés, messages envoyés mi-tour non checkpointés, pas un remplaçant de git. — [Checkpointing](https://code.claude.com/docs/en/checkpointing) ; [Claude directory](https://code.claude.com/docs/en/claude-directory)
- `/export [filename]` : menu clipboard/fichier texte lisible ; pour les scripts : `claude -p --resume <id> --output-format json "summarize…" | jq -r '.result'`, `transcript_path` reçu par hooks/statusline, Agent SDK. `/clear` sauvegarde l'ancienne conversation ; `/compact [instructions]` ; `/context`. — [Sessions](https://code.claude.com/docs/en/sessions)
- Sessions background : `claude --bg "prompt"`, `/background`, `claude agents` (vue plein écran de toutes les sessions, `--json`), `claude attach <id>`, `claude logs <id>`, `claude stop|respawn|rm <id>`, `claude daemon status|stop --any` ; état sous `~/.claude/jobs/` et `~/.claude/daemon/`. — [CLI reference](https://code.claude.com/docs/en/cli-reference) ; [Agent view](https://code.claude.com/docs/en/agent-view)

### Inferences
- Un stockage JSONL par cwd encodé + génération asynchrone d'un titre par petit modèle + picker fuzzy avec aperçu constituent l'UX minimale attendue en 2026 ; le double mode « summarize from/up to here » est un différenciateur récent à copier.

### Gaps
- Le format exact des lignes JSONL (types d'entrées) est explicitement non documenté (« internal to Claude Code »).

---

## Q7. Settings : fichiers, précédence, clés, variables d'environnement, `/config`

### Takeaway
5 niveaux (managed > `--settings` CLI > `.claude/settings.local.json` > `.claude/settings.json` > `~/.claude/settings.json`), JSON strict avec schéma publié, ~170 clés documentées (index par catégories) et ~250 variables d'environnement ; `/config` n'expose qu'un sous-ensemble personnel et écrit dans `~/.claude/settings.json`, `.claude/settings.local.json` ou `~/.claude.json`.

### Cited Findings
- Précédence et fichiers : Managed (`managed-settings.json`, MDM, console claude.ai, hôte via SDK `managedSettings`), CLI `--settings <json|path>`, `.claude/settings.local.json` (perso, gitignoré automatiquement), `.claude/settings.json` (équipe), `~/.claude/settings.json` (user). Les listes (permissions, `claudeMdExcludes`…) fusionnent ; `availableModels` managé remplace. `$schema`: `https://json.schemastore.org/claude-code-settings.json`. `/status` → ligne « Setting sources ». Rechargement à chaud avec hook `ConfigChange`. — [Settings](https://code.claude.com/docs/en/settings)
- `/config` : onglet **Config** = « short set of personal options such as theme, editor mode, and verbose output » ; écrit dans `~/.claude/settings.json` (la plupart), `.claude/settings.local.json` (ex. Show tips), `~/.claude.json` (global config) ; `/config key=value`. Autres onglets : Status. Exemple `claude --settings '{"model": "claude-opus-5-5"}'`. — [Settings](https://code.claude.com/docs/en/settings)
- Clés (index officiel, par catégorie) — Model : `advisorModel`, `alwaysThinkingEnabled`, `availableModels`, `effortLevel`, `enforceAvailableModels`, `fallbackModel`, `fastMode`, `fastModePerSessionOptIn`, `language`, `maxEffortLevel`, `model`, `modelOverrides`, `modelPicker`, `modelPricing`, `modelSettings`, `outputStyle`, `promptCacheTtl`, `showThinkingSummaries`, `subagentPromptCacheTtl`, `switchModelsOnFlag`, `ultracode`. Permissions : `permissions.allow/ask/deny/additionalDirectories/blockReadsOutsideWorkingDirectories/defaultMode/disableBypassPermissionsMode`, `autoMode` (+`classifyAllShell`), `disableAutoMode`, `useAutoModeDuringPlan`, `allowManagedPermissionRulesOnly`, `skipAutoPermissionPrompt`, `skipDangerousModePermissionPrompt`. Sandbox : `sandbox.enabled`, `failIfUnavailable`, `autoAllowBashIfSandboxed`, `excludedCommands`, `allowUnsandboxedCommands`, `filesystem.allowWrite/denyWrite/denyRead/allowRead`, `network.allowedDomains/deniedDomains/allowUnixSockets/allowLocalBinding/httpProxyPort/socksProxyPort/tlsTerminate`, `credentials.*`, `ignoreViolations`. Mémoire/contexte : `autoCompactEnabled`, `autoCompactWindow`, `autoMemoryDirectory`, `autoMemoryEnabled`, `bashOutputMaxChars`, `claudeMd`, `claudeMdExcludes`, `env`, `fileCheckpointingEnabled`, `plansDirectory`, `skillListingBudgetFraction`, `skillListingMaxDescChars`, `taskOutputMaxChars`. Interface : `askUserQuestionTimeout`, `autoContinueAtUsageLimit`, `autoScrollEnabled`, `axScreenReader`, `bashEditDiffEnabled`, `companyAnnouncements`, `defaultShell`, `dialogExpiry`, `editorMode`, `emojiCompletionEnabled`, `fileSuggestion`, `footerLinksRegexes`, `keybindingFlavor`, `prefersReducedMotion`, `promptSuggestionEnabled`, `respectGitignore`, `respondToBashCommands`, `showClearContextOnPlanAccept`, `showTurnDuration`, `spellcheck`, `spinnerTipsEnabled`, `spinnerTipsOverride`, `spinnerVerbs`, `statusLine`, `subagentStatusLine`, `syntaxHighlightingDisabled`, `terminalProgressBarEnabled`, `terminalTitleFromRename`, `theme`, `timeFormat`, `timeZone`, `tui`, `verbose`, `viewMode`, `vimInsertModeRemaps`, `voice`, `voiceEnabled`, `wheelScrollAccelerationEnabled`. Git : `attribution` (`.commit`, `.pr`, `.sessionUrl`), `includeCoAuthoredBy`, `includeGitInstructions`, `prUrlTemplate`. Hooks/automation : `allowedHttpHookUrls`, `allowManagedHooksOnly`, `disableAllHooks`, `disableWorkflows`, `enableWorkflows`, `hooks`, `httpHookAllowedEnvVars`, `workflowKeywordTriggerEnabled`, `workflowSizeGuideline`. Plugins/skills : `disableBundledSkills`, `disableSkillShellExecution`, `skillOverrides`, `syncClaudeAiSkills`, `syncClaudeAiPlugins`, `allowedChannelPlugins`, `blockedMarketplaces`, `channelsEnabled`, `disableCommandPluginSources`, `pluginSuggestionMarketplaces`, `pluginTrustMessage`, `strictKnownMarketplaces`, `strictPluginOnlyCustomization`, `enabledPlugins`, `extraKnownMarketplaces`, `pluginConfigs`. MCP : voir Q5. Agents/sessions : `agent`, `crossSessionInbound`, `disableAgentView`, `isolatePeerMachines`, `processWrapper`, `teammateMode`, `worktree.baseRef/symlinkDirectories/sparsePaths/bgIsolation`. Remote/desktop/notifs : `agentPushNotifEnabled`, `awaySummaryEnabled`, `disableArtifact`, `enableArtifact`, `disableRemoteControl`, `inputNeededNotifEnabled`, `preferredNotifChannel`, `remote.defaultEnvironmentId`, `remoteControlAtStartup`, `sshConfigs`, `sshHostAllowlist`. Auth : `apiKeyHelper`, `awsAuthRefresh`, `awsCredentialExport`, `forceLoginMethod`, `forceLoginGatewayUrl`, `forceLoginOrgUUID`, `gcpAuthRefresh`, `otelHeadersHelper`. Updates : `autoUpdatesChannel`, `minimumVersion`, `requiredMinimumVersion`, `requiredMaximumVersion`. Privacy : `cleanupPeriodDays`, `desktopSessionCleanupPeriodDays`, `feedbackDrafts`, `feedbackSurveyRate`, `skipWebFetchPreflight`. Enterprise : `disableSideloadFlags`, `forceRemoteSettingsRefresh`, `managedSourcesBehavior`, `parentSettingsBehavior`, `policyHelper`. — [Settings reference](https://code.claude.com/docs/en/settings-reference)
- Syntaxe des règles de permission : `Bash` (tout), `Bash(npm run *)` (préfixe ; l'espace avant `*` compte : `Bash(ls*)` matche `lsof`), `Bash(git * main)`, `Read(./.env)`, `Read(//**/.env)` (racine FS), `Edit(src/**)`, `WebFetch(domain:example.com)`, `WebFetch(domain:*)`, `mcp__server__tool`, `Agent(Explore)`, `Agent(model:opus)`, `Agent(isolation:worktree)`, `Bash(run_in_background:true)`, `Skill(name *)`, `Workflow(<name>)`. Les wrappers (`/usr/bin/curl`, `sh -c '…'`, `git -C . push`) ne sont pas matchés par `Bash(curl *)`. Modes : `default` (Manual), `acceptEdits`, `plan`, `auto` (classifier), `dontAsk`, `bypassPermissions`, `manual` ; `Shift+Tab` cycle. — [Permissions](https://code.claude.com/docs/en/permissions) ; [Permission modes](https://code.claude.com/docs/en/permission-modes) ; [CLI reference](https://code.claude.com/docs/en/cli-reference)
- Variables d'environnement clés (extrait vérifié) : `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_MODEL` (v2.1.236+), `ANTHROPIC_DEFAULT_OPUS|SONNET|HAIKU|FABLE_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`), `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (défaut 32 000 pour modèles inconnus), `MAX_THINKING_TOKENS` (budget fixe ; `0` désactive ; ignoré par les modèles adaptatifs), `CLAUDE_CODE_EFFORT_LEVEL`, `CLAUDE_CODE_SUBAGENT_MODEL` (+`_FORCE`), `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (100000–1000000, entier), `DISABLE_AUTO_COMPACT`, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, `CLAUDE_CODE_DISABLE_1M_CONTEXT`, `DISABLE_AUTOUPDATER` / `DISABLE_UPDATES`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `DISABLE_COST_WARNINGS`, `DISABLE_PROMPT_CACHING`, `BASH_DEFAULT_TIMEOUT_MS` (120000), `BASH_MAX_TIMEOUT_MS` (600000), `BASH_MAX_OUTPUT_LENGTH` (30000, max 150000), `CLAUDE_CODE_SHELL`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PROJECT_DIR_NAME`, `CLAUDE_CODE_TMPDIR`, `CLAUDE_CODE_SKIP_PROMPT_HISTORY`, `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`, `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `CLAUDE_CODE_DISABLE_FAST_MODE`, `CLAUDE_CODE_DISABLE_CRON`, `CLAUDE_CODE_DISABLE_WORKFLOWS`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, `CLAUDE_CODE_NEW_INIT`, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (3), `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (20), `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS`, `CLAUDE_CODE_FORWARD_SUBAGENT_TEXT`, `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, `MAX_STRUCTURED_OUTPUT_RETRIES`, `CLAUDE_CODE_GOAL_CHECKIN_MINUTES` (30), `CLAUDE_CODE_USE_BEDROCK|VERTEX|FOUNDRY`, `CLAUDE_CODE_ENABLE_TELEMETRY`, `CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL`, `USE_BUILTIN_RIPGREP`, `MCP_TIMEOUT`, `MAX_MCP_OUTPUT_TOKENS`, `HTTP_PROXY`/`HTTPS_PROXY`, `DISABLE_BUG_COMMAND`-style `DISABLE_*_COMMAND` (`DOCTOR`, `FEEDBACK`, `LOGIN`, `LOGOUT`, `UPGRADE`, `INSTALL_GITHUB_APP`, `EXTRA_USAGE`), `CLAUDE_CODE_SIMPLE` / `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT`, `CLAUDE_CODE_SAFE_MODE`, `CLAUDE_ENV_FILE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDECODE` (marqueur d'exécution). Environ 250 variables au total dans la page. — [Environment variables](https://code.claude.com/docs/en/env-vars)
- Global config (`~/.claude.json`) : `autoConnectIde`, `externalEditorContext`, `hasTrustDialogAccepted`, `theme`, `mcpServers`, `projects.<encoded>.trust/sessionMetrics`, OAuth. — [Claude directory](https://code.claude.com/docs/en/claude-directory)
- Arborescence `~/.claude/` : `settings.json`, `CLAUDE.md`, `keybindings.json`, `rules/`, `skills/`, `commands/`, `agents/`, `workflows/`, `agent-memory/`, `output-styles/`, `themes/*.json`, `plugins/`, `projects/<project>/` (transcripts, `memory/`), `sessions/<id>.lock`, `file-history/`, `plans/`, `debug/`, `paste-cache/`, `uploads/`, `session-env/`, `tasks/`, `shell-snapshots/`, `backups/`, `feedback-bundles/`, `usage-data/`, `cache/`, `stats-cache.json`, `history.jsonl` (prompts, jamais purgé), `remote-settings.json`, `policy-limits.json`, `.credentials.json`, `worktrees/`, `ide/`, `teams/`, `jobs/`, `daemon/`. Retention sweep à 30 jours (transcripts, file-history, plans, debug…), auto memory exclue. — [Claude directory](https://code.claude.com/docs/en/claude-directory)

### Inferences
- Pour Fuller : reproduire la hiérarchie 4 fichiers + `--settings` inline, un schéma JSON publié, la fusion des listes, et exposer `/config key=value` ; les env vars les plus demandées par la communauté sont `*_MODEL`, `MAX_OUTPUT_TOKENS`, `THINKING`, `DISABLE_AUTOUPDATER`, `DISABLE_TELEMETRY`, `BASH_*_TIMEOUT`, `CONFIG_DIR`.

### Gaps
- La description ligne à ligne des ~170 clés n'a pas été recopiée (seulement l'index) ; la page settings-reference (444 KB) est la source pour les types/défauts.

---

## Q8. Modèle, effort, thinking, fast mode, contexte 1M

### Takeaway
`/model` accepte des alias (`default`, `best`, `fable`, `opus`, `sonnet`, `haiku`, `opusplan`, `sonnet[1m]`, `opus[1m]`, `fable[1m]`, `opusplan[1m]` v2.1.265+) et sauvegarde le défaut (`s` = session seulement) ; l'effort a 6 niveaux (`low|medium|high|xhigh|max|ultracode`) réglables par `/effort`, `--effort`, env, settings ; la pensée étendue se bascule par Option/Alt+T (impossible à couper sur Opus 5.5/Fable) ; fast mode par `/fast`/Alt+O ; auto-compact configurable.

### Cited Findings
- Ordre de résolution du modèle : `/model` (session) > `--model` > `ANTHROPIC_MODEL` > `"model"` dans settings > `ANTHROPIC_DEFAULT_MODEL`. Picker : flèches, `Enter` sauvegarde, `s` session seulement, ⇦/⇨ ajustent l'effort ; `Option+P`/`Alt+P` ouvre le picker sans vider le prompt. `opusplan` = Opus pour la planification, Sonnet pour l'exécution (CHANGELOG 1.0.88). Modèles 2026 : Opus 5.5 (`claude-opus-5-5`, défaut Opus depuis 2.1.280, 1M contexte, 4 $/20 $ par Mtok), Sonnet 5, Fable 5.1, Haiku 4.5. `availableModels` + `enforceAvailableModels` restreignent ; `ANTHROPIC_CUSTOM_MODEL_OPTION[_NAME|_DESCRIPTION]` ajoute un modèle custom au picker ; `fallbackModel` / `--fallback-model sonnet,haiku` (3 max) ; `switchModelsOnFlag`. — [Model config](https://code.claude.com/docs/en/model-config) ; [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Effort : `/effort` (slider), `/effort high` (sauvegardé par modèle), `/effort auto`, `/effort ultracode`, `s` = session (v2.1.257+) ; `claude --effort xhigh` ; `CLAUDE_CODE_EFFORT_LEVEL` ; `modelSettings: {"opus": {"effort": "high"}}` ; `effortLevel` ; plafond organisationnel `maxEffortLevel` ; `${CLAUDE_EFFORT}` disponible aux skills/hooks. `ultracode` = `xhigh` + orchestration automatique de workflows. — [Model config](https://code.claude.com/docs/en/model-config) ; [Workflows](https://code.claude.com/docs/en/workflows)
- Thinking : `Option+T` (macOS) / `Alt+T` bascule pour la session (en 2.0.0 c'était `Tab`) ; `/config` → thinking mode ; `alwaysThinkingEnabled: true` ; `MAX_THINKING_TOKENS=0` désactive ; `showThinkingSummaries: true` ; `Ctrl+O` (transcript/verbose) montre le thinking en gris italique ; `ultrathink` dans le prompt = raisonnement plus profond pour ce tour. — [Model config](https://code.claude.com/docs/en/model-config) ; [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Fast mode : `/fast [on|off]`, `Option+O`/`Alt+O`, `fastMode: false`, `CLAUDE_CODE_DISABLE_FAST_MODE=1` ; première mention CHANGELOG 2.1.36. — [Model config](https://code.claude.com/docs/en/model-config) ; [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Contexte 1M : natif sur Fable 5.1/5, Sonnet 5, Opus 4.7+ ; variantes `opus[1m]`/`sonnet[1m]` ; `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` ; auto-compact : `/autocompact 500k|auto`, `claude --autocompact 200k`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000`, `autoCompactEnabled`. — [Model config](https://code.claude.com/docs/en/model-config)
- Advisor : `claude --advisor opus`, `advisorModel`, `/advisor`. Safe mode : `claude --safe-mode` (désactive CLAUDE.md, skills, MCP). — [Model config](https://code.claude.com/docs/en/model-config) ; [CLI reference](https://code.claude.com/docs/en/cli-reference)

### Inferences
- Pour un agent Gemini, l'équivalent utile : alias de modèles + variantes de contexte, un slider d'effort mappé au « thinking budget » Gemini, sauvegarde par modèle, et un raccourci clavier de bascule du thinking.

### Gaps
- Le comportement précis d'`opusplan` (moment exact du basculement Opus→Sonnet) n'est décrit que comme « Opus for planning, auto-switches to Sonnet for execution ».

---

## Q9. Mode headless / CI et Agent SDK

### Takeaway
`claude -p` est l'interface SDK en CLI : `--output-format text|json|stream-json`, `--input-format text|stream-json`, `--json-schema`, `--max-turns`, `--max-budget-usd`, `--allowedTools`, `--permission-mode`, `--permission-prompts none`, `--bare` (recommandé, futur défaut), stdin ≤ 10 MB, reprise `-c`/`--resume`, événements `system/init`, `system/api_retry`, exit code 0/non-zéro/143 (SIGTERM). Le SDK TypeScript/Python (« Claude Agent SDK ») expose la même boucle.

### Cited Findings
- Bases : `claude -p "query"`, `cat logs.txt | claude -p "explain"`, `claude -c -p "…"`, `claude -r "<session>" "query"`, `--output-format json` → champs `result`, `session_id`, `total_cost_usd` (+ ventilation par modèle), `structured_output` (avec `--json-schema`), `permission_denials` ; `stream-json` (NDJSON ; `--verbose --include-partial-messages` pour les deltas ; dernière ligne = `result`) ; `--input-format stream-json` ; `jq -rj 'select(.type == "stream_event" and .event.delta.type? == "text_delta") | .event.delta.text'`. Exit 0 succès / non-zéro échec / 143 sur SIGTERM (SessionEnd exécuté). Stdin plafonné à 10 MB. — [Headless](https://code.claude.com/docs/en/headless)
- `--bare` : saute hooks, skills, commands, subagents, plugins, MCP, auto memory, CLAUDE.md ; pas de lecture OAuth/keychain (nécessite `ANTHROPIC_API_KEY` ou `apiKeyHelper`) ; « will become the default for `-p` in a future release ». — [Headless](https://code.claude.com/docs/en/headless)
- Permissions : `--allowedTools "Bash(git diff *),Read"` (syntaxe de règles), `--disallowedTools`, `--permission-mode auto|acceptEdits|dontAsk|plan|bypassPermissions`, `--dangerously-skip-permissions`, `--permission-prompt-tool <mcp tool>`, `--permission-prompts host|none` (v2.1.259+ ; supprime `AskUserQuestion`). — [Headless](https://code.claude.com/docs/en/headless) ; [CLI reference](https://code.claude.com/docs/en/cli-reference)
- System prompt : `--system-prompt`, `--append-system-prompt "…"`, `--append-system-prompt-file`, `--append-subagent-system-prompt[-file]`, `--exclude-dynamic-system-prompt-sections` (cache). Commandes en `-p` : skills utilisateur expansés dans le prompt ; `/model sonnet`, `/effort`, `/fast`, `/config key=value`, `/output-style <style>` acceptés en argument (v2.1.205+/v2.1.269+). — [CLI reference](https://code.claude.com/docs/en/cli-reference) ; [Headless](https://code.claude.com/docs/en/headless)
- Événements stream : `system/init` (modèle, outils, `mcp_servers`, `mcp_server_errors`, `plugins`, `plugin_errors`, `capabilities[]`), `system/api_retry` (`attempt`, `max_retries`, `retry_delay_ms`, `error_status`, `error` catégorie), `system/plugin_install`, `hook_started|hook_progress|hook_response` (`--include-hook-events`), messages de subagents avec `parent_tool_use_id` (`--forward-subagent-text` pour texte/thinking), `prompt_suggestion` (`--prompt-suggestions`). — [Headless](https://code.claude.com/docs/en/headless) ; [CLI reference](https://code.claude.com/docs/en/cli-reference)
- Autres flags CLI 2026 (liste vérifiée) : `--add-dir`, `--agent`, `--agents '{json}'`, `--allow-dangerously-skip-permissions`, `--autocompact`, `--ax-screen-reader`, `--betas`, `--bg`, `--channels`, `--chrome`/`--no-chrome`, `--cloud` (ex `--remote`), `--environment`, `--ref`, `--debug[=cats]`, `--debug-file`, `--disable-slash-commands`, `--effort`, `--exec`, `--fallback-model`, `--fork-session`, `--from-pr`, `--ide`, `--init`, `--init-only`, `--maintenance`, `--max-budget-usd`, `--max-turns`, `--mcp-config`, `--model`, `--name/-n`, `--no-session-persistence`, `--permission-mode`, `--plugin-dir`, `--plugin-url`, `--remote-control/--rc`, `--resume/-r`, `--settings`, `--verbose/-v`, `--worktree/-w`, `--teammate-mode` (caché), `--safe-mode`, `--strict-mcp-config`, `--setting-sources`. Sous-commandes : `claude update|install|auth login|logout|status|agents|attach|logs|stop|respawn|rm|daemon|doctor|import|mcp|plugin|project purge|remote-control|setup-token|ultrareview|gateway|auto-mode defaults|reset|self-hosted-runner`. « `claude --help` does not list every flag ». — [CLI reference](https://code.claude.com/docs/en/cli-reference)
- Agent SDK : packages TypeScript (`claude-agent-sdk-typescript`) et Python (`claude-agent-sdk-python`), « same tools, agent loop, and context management that power Claude Code » ; callbacks `canUseTool`, hooks, permissions, MCP, structured outputs ; rebaptisé « Claude Agent SDK » en 2.0.0. — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) ; [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Arrière-plan en `-p` : shells de fond tués ~5 s après le résultat ; subagents/workflows attendus jusqu'à 10 min d'inactivité (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`). — [Headless](https://code.claude.com/docs/en/headless)

### Inferences
- Un mode `-p` avec `json`/`stream-json` + `session_id` réutilisable + `--json-schema` est le socle d'intégration CI/scripts ; `--bare` montre que l'isolation de la découverte automatique doit être un flag de première classe.

### Gaps
- Le format exact des messages `--input-format stream-json` (schéma d'entrée) n'est pas reproduit dans la page headless consultée (il est dans la doc SDK TypeScript).

---

## Q10. Subagents, agent teams, workflows, tâches planifiées, worktrees, goals

### Takeaway
Quatre mécanismes d'orchestration coexistent : subagents (`.claude/agents/*.md`, outil `Agent`, background par défaut, `SendMessage` pour reprendre), **agent teams** (expérimental, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, mailbox + task list partagée), **dynamic workflows** (scripts JS `.claude/workflows/*.js` avec `agent()/pipeline()/parallel()`, outil `Workflow`, `/workflows`, `/deep-research`, `ultracode`) et tâches planifiées (`/loop`, `CronCreate`, `/schedule` cloud). Isolation par git worktree (`--worktree`, `isolation: worktree`).

### Cited Findings
**Subagents**
- Emplacements (priorité) : managed > `--agents '{json}'` > `.claude/agents/` (récursif, remonté depuis le cwd) > `~/.claude/agents/` > plugin `agents/` (`plugin:agent`). Frontmatter : `name` (obligatoire, sans `:`), `description` (obligatoire), `tools` (allowlist, `Tool(specifier)`, `Agent(worker, researcher)`), `disallowedTools` (`mcp__*`), `model` (`sonnet|opus|haiku|fable|inherit|ID`), `permissionMode`, `maxTurns`, `skills` (préchargés), `mcpServers` (inline ou référence), `hooks`, `memory: user|project|local` (→ `~/.claude/agent-memory/<name>/`, `.claude/agent-memory/`, `.claude/agent-memory-local/` ; `MEMORY.md` 200 lignes/25 KB), `background`, `omitClaudeMd` (v2.1.271+), `isolation: worktree`, `color`, `effort`, `initialPrompt`, `experimental.cacheTtl`. Fichier sans `name` = documentation ; `claude plugin validate .claude/agents`. — [Subagents](https://code.claude.com/docs/en/sub-agents)
- Intégrés : `Explore` (lecture seule), `Plan`, `general-purpose`, `statusline-setup` (Sonnet), `claude-code-guide` (Haiku) ; désactivation `permissions.deny: ["Agent(Explore)"]` ou `CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1`. Invocation : langage naturel, `@agent-code-reviewer` / `@"code-reviewer (agent)"`, `claude --agent code-reviewer` ou `"agent": "…"` dans settings (session entière). Résolution du modèle : paramètre d'appel > frontmatter > `CLAUDE_CODE_SUBAGENT_MODEL` > modèle courant (`_FORCE=1` ignore le frontmatter). — [Subagents](https://code.claude.com/docs/en/sub-agents)
- Foreground vs background : background par défaut en interactif (fork mode), `Ctrl+B` pour basculer une tâche, outils réduits en background ; profondeur d'imbrication 3 (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`), 20 concurrents (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`) ; reprise par nom/ID via `SendMessage` (Explore/Plan one-shot) ; `/subtask <task>` et `/fork` créent des forks héritant de la conversation ; `/tasks` liste ; `Ctrl+X Ctrl+K` tue tous les subagents. — [Subagents](https://code.claude.com/docs/en/sub-agents) ; [Interactive mode](https://code.claude.com/docs/en/interactive-mode)

**Agent teams**
- Activation `{"env": {"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"}}` ; lead + teammates (sessions Claude Code complètes), mailbox `~/.claude/teams/{team}/inboxes/{agent}.json`, config `~/.claude/teams/{team}/config.json`, task list `~/.claude/tasks/{team}/` (`session-<8 car.>`) ; `teammateMode: "in-process"|"auto"|"tmux"|"iterm2"` / `--teammate-mode` ; panneau d'agents (↑/↓, Enter, Esc, `x` stop, Ctrl+T task list) ; hooks `TeammateIdle`, `TaskCreated`, `TaskCompleted` (exit 2 = refuser) ; outils `TaskCreate/TaskGet/TaskList/TaskUpdate`, `SendMessage` ; limites : pas de reprise des teammates in-process, une équipe par session, pas de nesting, ~7× plus de tokens. Première mention CHANGELOG 2.1.32. — [Agent teams](https://code.claude.com/docs/en/agent-teams) ; [Costs](https://code.claude.com/docs/en/costs)

**Dynamic workflows (outil `Workflow`, 2026)**
- Script JS avec `export const meta = {name, description, phases?}` puis corps top-level `await` : `agent(prompt, {schema, label, model})`, `pipeline(list, fn)`, `parallel([...])`, `phase(title)`, `log()`, global `args` ; `Date.now()`/`Math.random()` lancent une erreur (rejeu déterministe). Emplacements : `.claude/workflows/`, `~/.claude/workflows/`, plugins `workflows/` (`/plugin:name`) ; sauvegarde depuis `/workflows` (`s`), `/reload-skills`. Déclenchement : mot-clé `ultracode` dans un prompt humain, « use a workflow », `/effort ultracode`, `claude --effort ultracode` (v2.1.203+). Approbation par mode (Auto : première fois ; Manual : chaque run sauf « don't ask again ») ; en `-p` règle `Workflow` / `Workflow(<name>)`. Limites : 16 agents concurrents (`CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` 1–256, v2.1.269+), 4 096 items par `parallel/pipeline`, 1 000 agents/run ; `workflowSizeGuideline: unrestricted|small|medium|large` ; désactivation `disableWorkflows: true`, `CLAUDE_CODE_DISABLE_WORKFLOWS=1`. `/workflows` : `p` pause, `x` stop, `r` restart, `f` filtre, `s` save ; reprise avec rejeu des résultats sauvegardés. Première mention 2.1.152. — [Workflows](https://code.claude.com/docs/en/workflows) ; [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

**Tâches planifiées, /loop, /goal**
- `/loop 5m check the deploy` (intervalle → cron), `/loop check the deploy` (auto-rythmé 1 min–1 h via `ScheduleWakeup`), `/loop` seul (prompt de maintenance intégré ou `.claude/loop.md` / `~/.claude/loop.md`), `/loop 20m /review-pr 1234` ; unités `s|m|h|d`, granularité 1 min, jitter jusqu'à 30 min, expiration 7 jours, 50 tâches max par session ; outils `CronCreate` (cron 5 champs), `CronList`, `CronDelete` ; rappels one-shot en langage naturel ; `CLAUDE_CODE_DISABLE_CRON=1` ; restaurées au `--resume` (sauf loop auto-rythmé). `/schedule` = routines cloud (min. 1 h). — [Scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks)
- `/goal all tests in test/auth pass` : Claude enchaîne les tours jusqu'à ce qu'un petit modèle juge la condition atteinte ; un goal par session ; check-ins (`CLAUDE_CODE_GOAL_CHECKIN_MINUTES`, 30 min, max 3 idle check-ins) ; `/goal clear`. — [Goal](https://code.claude.com/docs/en/goal)

**Worktrees**
- `claude --worktree feature-auth` / `-w` : crée `.claude/worktrees/<name>/` (à gitignorer) sur une nouvelle branche depuis la branche par défaut (`worktree.baseRef: "head"` pour HEAD) ; `--worktree "#1234"` ou URL de PR/MR ; outil `EnterWorktree` (« work in a worktree ») ; `.worktreeinclude` copie les fichiers ignorés (`.env`) ; `isolation: worktree` pour les subagents ; nettoyage des worktrees de sessions background ; `worktree.symlinkDirectories`, `sparsePaths`, `bgIsolation`. — [Worktrees](https://code.claude.com/docs/en/worktrees) ; [Settings reference](https://code.claude.com/docs/en/settings-reference)

### Inferences
- Pour Fuller, l'ordre de valeur : (1) subagents fichiers `.md` + Agent tool + background/Ctrl+B ; (2) `/loop` + cron interne ; (3) worktree isolation ; (4) workflows scriptés (différenciateur 2026, coûteux à implémenter) ; agent teams restent « experimental » chez Anthropic.

### Gaps
- Le schéma JSON exact des messages de mailbox d'agent teams et l'API complète de l'outil `Workflow` (référence SDK TypeScript) n'ont pas été consultés.

---

## Q11. Git / GitHub

### Takeaway
Claude Code s'appuie sur l'outil Bash + `gh` pour commits/PR (attribution `Co-Authored-By` configurable), fournit `/install-github-app` qui installe l'app GitHub et pousse un workflow `anthropics/claude-code-action@v1` (mentions `@claude`, mode automation avec `prompt`), `/code-review --comment`, `/security-review`, `/autofix-pr`, `/ultrareview` ; `/pr-comments` a été retiré.

### Cited Findings
- Attribution : `includeCoAuthoredBy`, `attribution.commit`, `attribution.pr`, `attribution.sessionUrl`, `includeGitInstructions`, `prUrlTemplate` ; métriques OTel `claude_code.commit.count`, `claude_code.pull_request.count`. Statut PR affiché en session (« PR review status », GitLab MR supporté) et liens `owner/repo#123` cliquables. — [Settings reference](https://code.claude.com/docs/en/settings-reference) ; [Monitoring](https://code.claude.com/docs/en/monitoring-usage) ; [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- `/install-github-app` : github.com seulement, nécessite `gh auth login` et admin du repo ; crée le secret `ANTHROPIC_API_KEY` ou `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`), pousse une branche avec `claude.yml` (+ `claude-code-review.yml`) et ouvre la PR. Workflow minimal :
  ```yaml
  - uses: anthropics/claude-code-action@v1
    with:
      anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
  ```
  Inputs : `prompt` (texte ou `/skill`), `claude_args` (`--max-turns 5 --model claude-sonnet-5 --allowedTools …`), `anthropic_api_key`, `claude_code_oauth_token`, `github_token`, `plugin_marketplaces`, `plugins`, `settings`, `trigger_phrase` (`@claude`), `use_bedrock|use_vertex|use_foundry`, fédération OIDC (`anthropic_federation_rule_id`…). Mode interactif (sans `prompt`, réagit à `@claude`) vs automation (`prompt` fourni, ex. cron `0 9 * * *`). Permissions de l'app : Contents/Issues/Pull requests R/W (+ Actions, Checks, Workflows…). GitLab CI/CD documenté séparément. — [GitHub Actions](https://code.claude.com/docs/en/github-actions)
- Exemple headless commit : `claude -p "Look at my staged changes and create an appropriate commit" --allowedTools "Bash(git diff *),Bash(git log *),Bash(git status *),Bash(git commit *)"`. — [Headless](https://code.claude.com/docs/en/headless)
- `/code-review [niveau] [--fix] [--comment] [pr#|branch|path]`, `/security-review [niveau]` (défaut `high`), `/simplify`, `/ultrareview [PR|branch]` (cloud), `/autofix-pr`, `--from-pr <n>` (picker filtré), `/worktree` n'existe pas mais `--worktree "#1234"` part d'une PR. — [Commands](https://code.claude.com/docs/en/commands) ; [Worktrees](https://code.claude.com/docs/en/worktrees)

### Inferences
- L'essentiel pour un concurrent : instructions git dans le system prompt (désactivables), trailer d'attribution configurable, et un workflow CI générique appelant le mode headless.

### Gaps
- Le corps des instructions git embarquées dans le system prompt n'est pas publié (« Claude Code's system prompt isn't published »).

---

## Q12. Divers : mode interactif, keybindings, status line, IDE, coûts, télémétrie, sandbox, devcontainer, doctor, mises à jour

### Takeaway
L'UX terminal 2026 est très riche : ~30 raccourcis rebindables (`~/.claude/keybindings.json` avec contextes et actions nommées), mode Vim complet, rendu fullscreen optionnel (`/tui`), status line scriptée alimentée par un JSON exhaustif (contexte, coût, cache, rate limits), file d'attente de messages, `/btw`, `/diff`, suggestions de prompt, dictée vocale ; IDE (VS Code, JetBrains) : diff dans l'IDE, sélection partagée, `Cmd/Ctrl+Esc` ; OpenTelemetry natif ; sandbox OS (Seatbelt/bubblewrap) ; `/doctor` et auto-update.

### Cited Findings
- Raccourcis (extraits) : `Ctrl+C` interrompt/vide/quitte (double), `Ctrl+D` quitte (double < 800 ms), `Ctrl+G` / `Ctrl+X Ctrl+E` éditeur externe, `Ctrl+L` redraw, `Ctrl+O` transcript/verbose, `Ctrl+R` recherche historique, `Ctrl+V` image (`[Image #N]`), `Ctrl+B` background, `Ctrl+T` todo list, `Ctrl+S` stash prompt, `Ctrl+Z` suspend, `Tab` autocomplétion/commentaire de permission, `↑/↓` historique, `Esc` interrompt, `Esc Esc` vide le brouillon ou ouvre rewind, `Ctrl+Enter`/`Ctrl+X Ctrl+S` envoie la file (v2.1.275+), `Shift+Tab` (ou `Alt+M`) cycle des modes de permission, `Option/Alt+P` modèle, `Option/Alt+T` thinking, `Option/Alt+O` fast, `Option/Alt+W` annule `ultracode`, `Ctrl+X Ctrl+K` tue les subagents, édition Emacs (`Ctrl+A/E/K/U/W/Y`, `Alt+B/F/D`, `Ctrl+_` undo), multiligne `\`+Enter, `Option+Enter`, `Shift+Enter`, `Ctrl+J` ; transcript viewer `?`, `{`/`}`, `[`, `v`, `q`. Quick commands `/ ! @ : ?`. Mode Vim (NORMAL/INSERT/VISUAL, objets texte, `s/S` v2.1.211+, `vimInsertModeRemaps`). Messages en file d'attente pendant le travail (retour avec `↑`), `/btw` (`c` copie, `f` fork), spell-check, emojis `:name:`, caractères invisibles nettoyés, session recap, attente automatique de reset de limite (`autoContinueAtUsageLimit`, v2.1.234+). — [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Keybindings : `~/.claude/keybindings.json` = `{"$schema":"https://www.schemastore.org/claude-code-keybindings.json","bindings":[{"context":"Chat","bindings":{"ctrl+e":"chat:externalEditor","ctrl+u":null}}]}` ; contextes `Global`, `Chat`, `Autocomplete`, `Settings`, `Confirm`, `Transcript`… ; actions `app:interrupt|exit|redraw|toggleTodos|toggleTranscript`, `history:search|previous|next`, `chat:cancel|clearInput|clearScreen|killAgents|cycleMode|modelPicker|fastMode|thinkingToggle|submit|queueSubmit|sendNow|newline|undo|externalEditor|stash|imagePaste`, `autocomplete:accept|dismiss|previous|next`, `confirm:yes|no`, `transcript:exit` ; chords supportés ; `/keybindings` ouvre le fichier ; `keybindingFlavor`. — [Keybindings](https://code.claude.com/docs/en/keybindings)
- Status line : `"statusLine": {"type":"command","command":"~/.claude/statusline.sh","padding":2,"refreshInterval":N}` ; `/statusline show model name and context percentage` génère le script ; stdin JSON : `session_id`, `session_name`, `prompt_id`, `transcript_path`, `model{id,display_name}`, `workspace{current_dir,project_dir,added_dirs,git_worktree,repo{host,owner,name}}`, `version`, `output_style{name}`, `cost{total_cost_usd,total_duration_ms,total_api_duration_ms,total_lines_added,total_lines_removed}`, `context_window{total_input_tokens,total_output_tokens,context_window_size,used_percentage,remaining_percentage,current_usage{…cache…}}`, `exceeds_200k_tokens`, `prompt_cache{warm,ttl,requests,misses,hit_ratio,…}`, `fast_mode`, `effort{level}`, `thinking{enabled}`, `rate_limits{five_hour{used_percentage,resets_at},seven_day{…}}` ; ANSI et multi-lignes supportés ; `subagentStatusLine`. — [Status line](https://code.claude.com/docs/en/statusline)
- Fullscreen : `/tui fullscreen` (research preview), input fixé en bas, scroll natif via `[`, `/scroll-speed`, setting `tui`. Thèmes : `/theme` (`auto`, light/dark, daltonien, ANSI), `~/.claude/themes/*.json`, `Ctrl+T` dans `/theme` bascule la coloration syntaxique. `/terminal-setup` écrit un keybinding Shift+Enter dans VS Code/Cursor/Zed/Alacritty, désactive `terminal.integrated.gpuAcceleration`. — [Fullscreen](https://code.claude.com/docs/en/fullscreen) ; [Terminal config](https://code.claude.com/docs/en/terminal-config) ; [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- IDE : extension VS Code native (2.0.0) avec diffs inline (accept/reject par changement), plans éditables, `@file.ts#5-10` via `Option/Alt+K`, sélection vue automatiquement, `Cmd+Esc`/`Ctrl+Esc` focus, sessions multiples/groupes, mode terminal, serveur MCP IDE intégré (`getDiagnostics`), `/ide`, `--ide`, `autoConnectIde`, `CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL`. JetBrains : plugin Marketplace, diff dans l'IDE (réglage « Diff tool » dans `/config`), partage de sélection/diagnostics, lance `claude` dans le terminal intégré. — [VS Code](https://code.claude.com/docs/en/vs-code) ; [JetBrains](https://code.claude.com/docs/en/jetbrains) ; [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Coûts : `/usage` (bloc Session : coût estimé au prix liste ou `modelPricing`, durée API/wall, lignes modifiées, usage par modèle, ligne `Prompt cache (main)` v2.1.251+, barres de plan 5 h/7 j, attribution skills/subagents/plugins/MCP, loops, `d`/`w`, `r` retry) ; `/cost` et `/stats` = alias ; `/usage-credits` ; `/insights` (rapport HTML, 200 sessions max) ; `--max-budget-usd` ; `total_cost_usd` en JSON ; coût moyen entreprise ≈ 13 $/dev/jour actif, 150–250 $/mois ; compaction personnalisable via section « # Compact instructions » du CLAUDE.md. — [Costs](https://code.claude.com/docs/en/costs)
- Télémétrie : `CLAUDE_CODE_ENABLE_TELEMETRY=1` + `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_TRACES_EXPORTER`, `OTEL_EXPORTER_OTLP_PROTOCOL|ENDPOINT|HEADERS`, `OTEL_METRIC_EXPORT_INTERVAL` (60000), `OTEL_LOGS_EXPORT_INTERVAL` (5000), `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS`, `OTEL_METRICS_INCLUDE_SESSION_ID|VERSION|ACCOUNT_UUID|REPOSITORY` ; métriques `claude_code.session.count`, `lines_of_code.count`, `pull_request.count`, `commit.count`, `cost.usage`, `token.usage`, `code_edit_tool.decision`, `active_time.total` ; événement `hook_execution_complete`. Opt-out : `DISABLE_TELEMETRY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`. — [Monitoring](https://code.claude.com/docs/en/monitoring-usage) ; [Env vars](https://code.claude.com/docs/en/env-vars)
- Sandbox : `/sandbox` (panneau, sauvegarde dans `.claude/settings.local.json`) ; macOS Seatbelt, Linux/WSL2 bubblewrap + socat (+ seccomp `@anthropic-ai/sandbox-runtime`) ; `claude --settings '{"sandbox": {"enabled": true, "allowUnsandboxedCommands": false}}'` ; clés `sandbox.*` (voir Q7) ; devcontainer de référence avec `init-firewall.sh` (allowlist réseau) et volume persistant pour `~/.claude`. — [Sandboxing](https://code.claude.com/docs/en/sandboxing) ; [Devcontainer](https://code.claude.com/docs/en/devcontainer)
- Doctor/updates : `/doctor` (skill, v2.1.205+) et `claude doctor` (read-only) ; `claude update`, `claude install [stable|latest]`, `/upgrade` (plan), `/release-notes`, `autoUpdatesChannel`, `DISABLE_AUTOUPDATER`, `minimumVersion`/`requiredMinimumVersion` ; debug `claude --debug='mcp,startup'`, `--debug-file`, `/debug`, logs `~/.claude/debug/`. — [CLI reference](https://code.claude.com/docs/en/cli-reference) ; [Commands](https://code.claude.com/docs/en/commands)
- Comparatif officiel des mécanismes d'extension (features-overview) : CLAUDE.md (chargé à chaque session, contenu complet), Output style, Skill (descriptions toujours, corps à la demande), Subagent (contexte isolé), Dynamic workflow, Cross-session messaging, Code intelligence (LSP), MCP (noms d'outils, schémas à la demande), Hook (zéro contexte), Artifact ; combinaisons recommandées Skill+MCP, Skill+Subagent, CLAUDE.md+Skills, Hook+MCP. — [Features overview](https://code.claude.com/docs/en/features-overview)

### Inferences
- Le JSON de status line est un bon « contrat public » de télémétrie de session ; l'adopter tel quel dans Fuller permet de réutiliser les scripts de status line communautaires.
- Les briques « sans réseau Anthropic » (sandbox OS, devcontainer, OTel, keybindings, fullscreen) sont directement transposables à un agent Gemini.

### Gaps
- Le contenu détaillé des onglets de `/help` et le format des thèmes custom `~/.claude/themes/*.json` n'ont pas été vérifiés dans une page dédiée.
- Les sources communautaires (awesome-claude-code, cheat sheets) n'ont pas été consultées : la documentation officielle 2026 et le CHANGELOG couvraient déjà l'intégralité des questions, et les listes communautaires 2025 sont périmées sur plusieurs commandes retirées (`/vim`, `/pr-comments`, `/ultraplan`).
