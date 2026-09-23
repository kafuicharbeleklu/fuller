# Claude Code (CLI interactif, v2.x, état septembre 2026) — rendu des sorties, affichage des appels d'outils, UX des permissions

Notes de recherche destinées à construire la checklist de fonctionnalités de « Fuller » (TUI Ink/React + Gemini). Périmètre : ce que Claude Code affiche à l'écran, avec quels symboles/libellés exacts, et comment il le rend techniquement. Les faits datés/versionnés sont indiqués quand la source les donne. Les sources primaires (docs officielles `code.claude.com`, CHANGELOG, issues GitHub, arborescence du code source fuité v2.1.88) sont privilégiées ; les blogs tiers sont signalés comme tels.

Contexte de version : la doc officielle a migré de `docs.claude.com/en/docs/claude-code/*` vers `code.claude.com/docs/en/*` (redirections 301 constatées). Le CHANGELOG le plus récent consulté va jusqu'à **v2.1.280** (septembre 2026). Le code source complet (≈513 000 lignes TS, 1 906 fichiers) a fuité le 31 mars 2026 via un fichier `.map` du paquet npm `@anthropic-ai/claude-code@2.1.88` ; les noms de composants ci-dessous viennent de l'arborescence de ce dump. — [Zscaler](https://www.zscaler.com/blogs/security-research/anthropic-claude-code-leak), [dev.to minnzen](https://dev.to/minnzen/i-studied-claude-codes-leaked-source-and-built-a-terminal-ui-toolkit-from-it-4poh), [Njengah/claude-code-source-code-leak](https://github.com/Njengah/claude-code-source-code-leak/)

---

## Q1. Rendu des messages : markdown, code, streaming, symboles, thinking, troncature

### Takeaway
Claude Code aplatit le markdown en styles ANSI (titres = gras, blockquote = barre `▎`, listes imbriquées `1.`→`a.`→`i.`), préfixe chaque message assistant d'un `⏺` et chaque résultat d'outil d'un `⎿`, et replie tout ce qui dépasse 3-4 lignes derrière `… +N lines (ctrl+o to expand)`. Le thinking est masqué par défaut depuis février 2026 (header `redact-thinking-2026-02-12`) et n'est visible qu'en mode transcript (`Ctrl+O`) avec `showThinkingSummaries` + `verbose`.

### Cited Findings

**Symboles et structure visuelle des messages**
- « Every assistant message gets a `⏺` bullet » (U+23FA sur macOS, `●` sur d'autres systèmes) ; « `⎿` marks a tool result — the output of a file read, shell command, or search » ; les blockquotes deviennent une barre `▎` ; « `## Heading` becomes bold text (the boldness is an ANSI code your clipboard drops), inline code loses its backticks » ; les listes imbriquées « cycle their markers by depth — `1.` → `a.` → `i.` » ; « The terminal hard-wraps every line at your window width and indents continuations to line up under the `⏺` » ; les frames du spinner sont « `· ✢ ✳ ✶ ✻ ✽` » ; le presse-papiers capture aussi les « spinner glyphs and `(ctrl+o to expand)` hints », « box borders, and hint text ». — [Trevor Fox, juillet 2026](https://trevorfox.com/2026/07/clean-up-claude-code-copy-paste/)
- Exemple réel d'un bloc outil replié (issue #12589) :
  ```
  ⏺ Bash(sk work-list)
  ⎿ Work Items (3 total, 0 in progress, 3 not started)
  🟠 HIGH
  … +11 lines (ctrl+o to expand)
  ```
  Le seuil de repli est global et codé en dur à « 3-4 lignes » ; la demande de seuil configurable (`outputCollapseThreshold`) a été fermée comme doublon. — [Issue #12589](https://github.com/anthropics/claude-code/issues/12589)
- Demandes récurrentes non satisfaites : réglage pour tout déplier par défaut (#25776), réglage persistant pour tout replier (#91827), `ctrl+o` qui ne déplie pas complètement Bash (#26954) ni Read (#8214), `ctrl+o` qui masque les questions posées par Claude (#40984), retour de `Ctrl+S` pour replier/déplier (#17092). — [#25776](https://github.com/anthropics/claude-code/issues/25776), [#91827](https://github.com/anthropics/claude-code/issues/91827), [#26954](https://github.com/anthropics/claude-code/issues/26954), [#8214](https://github.com/anthropics/claude-code/issues/8214), [#40984](https://github.com/anthropics/claude-code/issues/40984), [#17092](https://github.com/anthropics/claude-code/issues/17092)
- En mode fullscreen : « Click a collapsed tool result to expand it and see the full output. Click again to collapse. The tool call and its result expand together. Only messages that have more to show are clickable. » ; un clic déplie aussi la sortie d'une commande `!` (v2.1.257+). — [Docs Fullscreen](https://code.claude.com/docs/en/fullscreen)
- `Ctrl+O` = « Toggle transcript viewer — Shows detailed tool usage and execution, with a timestamp and the model used on each assistant message. Also expands lines that collapse by default, such as MCP calls, shown as a single `Called slack 3 times` line, and messages from your other sessions, shown as a one-line `Message from @<sender>` preview ». Dans le transcript viewer : `Ctrl+E` = « Toggle show all content » (renderer classique seulement, rebindable `transcript:toggleShowAll`), `q`/`Ctrl+C`/`Esc` = sortir, `?` = aide (fullscreen), `{`/`}` = prompt précédent/suivant (fullscreen), `[` = écrire toute la conversation dans le scrollback natif, `v` = ouvrir dans `$VISUAL`/`$EDITOR`. — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- `Ctrl+L` = « Redraw the screen — Forces a full terminal redraw, keeping input and conversation history ». — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Messages utilisateur envoyés/en file « show in gray until Claude starts responding to them » ; les messages en file sont listés « above the input box ». — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)

**Markdown : ce qui est rendu et ce qui ne l'est pas**
- Issue #26390 (février 2026, fermée « not planned ») : fonctionnent — gras, italique, gras-italique, code inline, blocs de code fencés avec coloration, blocs `diff`, tables, listes à puces et numérotées, blockquote simple. Cassés — titres h2–h6 « Identical bold text, no hierarchy distinction », labels de liens (`[guide](url)` → « Raw URL only; label discarded »), barré `~~old~~` (tildes affichés), task lists `- [x]` (rendus comme puces, état perdu), blockquotes imbriqués, entités HTML non décodées. Le renderer est décrit comme CommonMark + GFM mais ≈40 % des features GFM sont silencieusement supprimées ; nom de la bibliothèque non précisé. — [Issue #26390](https://github.com/anthropics/claude-code/issues/26390)
- Les cases GFM `- [ ]` / `- [x]` sont rendues comme cases à cocher depuis **v2.1.149** (glyphes non documentés) ; c'est distinct de la task list `Ctrl+T`. — [Issue #61593](https://github.com/anthropics/claude-code/issues/61593)
- v2.1.280 : « Improved code blocks that don't name a language: they are now colored like inline code, so commands stand out from the surrounding text ». — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- `Ctrl+T` dans le picker `/theme` : « Toggle syntax highlighting for code blocks — Controls whether code in Claude's responses uses syntax coloring ». — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Bugs de rendu markdown sur Windows Terminal : gras/backticks rendus comme artefacts barrés (#37479) ; coloration syntaxique cassée (#22406). — [#37479](https://github.com/anthropics/claude-code/issues/37479), [#22406](https://github.com/anthropics/claude-code/issues/22406)
- Composants du dump source liés au rendu : `src/components/Markdown.tsx`, `src/components/HighlightedCode/` (contient au moins `Fallback.tsx`), `src/components/messages/AssistantTextMessage.tsx`, `AssistantThinkingMessage.tsx`, `AssistantRedactedThinkingMessage.tsx`, `HighlightedThinkingText.tsx`, `AssistantToolUseMessage.tsx`, `UserToolResultMessage/`, `CollapsedReadSearchContent.tsx`, `GroupedToolUseContent.tsx`, `CompactBoundaryMessage.tsx`, `HookProgressMessage.tsx`, `PlanApprovalMessage.tsx`, `RateLimitMessage.tsx`, `SystemAPIErrorMessage.tsx`, `UserBashInputMessage.tsx`, `UserBashOutputMessage.tsx`, `UserImageMessage.tsx`, `UserPromptMessage.tsx`, `AttachmentMessage.tsx`. — [Njengah leak: src/components/messages](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components/messages), [src/components](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components)

**Spinner / ligne d'état pendant la génération**
- Format rapporté : « ✻ Cogitating… (esc to interrupt · 3.2k tokens) » — verbe fantaisiste + instruction d'interruption + compteur de tokens ; `Esc` interrompt même en plein stream. — [M.academy](https://m.academy/lessons/interrupt-agentic-code-writing-process-claude-code/), [Zenva](https://academy.zenva.com/claude-code-interface-explained/) (blogs tiers)
- 187 verbes de spinner (« Accomplishing, Actioning, Architecting, Baking, Beaming, Beboppin', Befuddling, … Cogitating, … Reticulating ») tirés aléatoirement ; « reticulating » est un clin d'œil à SimCity 2000. — [DeepakNess](https://deepakness.com/raw/claude-spinner-verbs/), [Pilot Shell](https://pilot-shell.com/blog/claude-code-source-leak)
- v2.1.274 : « Improved the spinner status during long thinking: it now reads 'deep in thought' after 45s, and shows 'picking the thought back up' while recovering » ; « while a SessionStart, UserPromptSubmit, PreToolUse or SessionEnd hook runs, the spinner says so with elapsed time » ; v2.1.280 : correction d'une double ellipse « …… » sur les lignes de compaction comme 'Running PreCompact hooks…' ; « spinner tip » suggérant `/focus` (v2.1.269). — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Demandes d'option pour désactiver/personnaliser le texte du spinner (#27976, #64098) et plainte que les verbes mignons masquent la fin réelle de la réponse (#52759). — [#27976](https://github.com/anthropics/claude-code/issues/27976), [#64098](https://github.com/anthropics/claude-code/issues/64098), [#52759](https://github.com/anthropics/claude-code/issues/52759)
- Avec une status line custom, Claude Code « stops showing most of the footer's keyboard hints, including `esc to interrupt`, the `? for shortcuts` fallback, and the `hold space to speak` hint ». — [Docs Statusline](https://code.claude.com/docs/en/statusline)

**Extended thinking**
- Avant février 2026 : thinking affiché déplié avec libellé « Thinking… » / « ✻ Thinking » en style atténué/italique. Après : « collapsed gray bars with a note suggesting users press `Ctrl+O to expand` ». Mécanisme : header beta `redact-thinking-2026-02-12` ; pour le revoir il faut deux réglages dans `~/.claude/settings.json` : `"showThinkingSummaries": true` (dé-rédaction côté serveur) et `"verbose": true` (ou `Ctrl+O` par session). Version testée 2.1.195. — [wmedia.es](https://wmedia.es/en/tips/claude-code-bring-back-hidden-thinking) (blog tiers)
- « Thinking blocks appear collapsed by default each session. The only way to show them is pressing ctrl+o, which toggles the entire transcript view » ; pas de réglage pour les garder ouverts. — [ClaudeLog](https://claudelog.com/faqs/why-cant-i-see-claude-thinking/)
- Issue #36006 (fermée doublon) proposait `⟐ Thinking (1.2s, 340 tokens) [Ctrl-O to expand]` et `"showThinking": "collapsed" | "expanded" | "hidden"` — non implémenté tel quel. — [#36006](https://github.com/anthropics/claude-code/issues/36006)
- `Option+T`/`Alt+T` = « Toggle extended thinking » (sans effet sur Opus 5.5 / Fable qui pensent toujours). — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- v2.1.280 : « Improved `/cost` cache-miss causes to name thinking mode and thinking display changes ». — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

**Vue `/focus` (v2.1.269+)**
- « Toggle the focus view, which shows only your last prompt, a one-line tool-call summary with edit diffstats, and the final response. The tool-call summary also counts the subagents launched in the turn and collapses completed background-task notifications into a single count. » Persistant entre sessions. — [Docs Commands](https://code.claude.com/docs/en/commands), [Docs Fullscreen](https://code.claude.com/docs/en/fullscreen)

### Inferences
- Le streaming visible est du texte qui s'ajoute au bas de la zone dynamique ; en renderer classique tout le « bas » (spinner + texte en cours + prompt) est repeint à chaque frame, ce qui explique le flicker historique (voir Q7). Le texte assistant terminé est ensuite figé dans le scrollback.
- La ligne de spinner combine : glyphe animé (`·✢✳✶✻✽`), verbe aléatoire + `…`, puis entre parenthèses `esc to interrupt`, éventuellement durée écoulée et tokens ; les « tips » y sont injectés.
- Pour Fuller : reproduire au minimum `⏺`/`⎿`, le repli à N lignes avec un hint cliquable/raccourci, un mode transcript séparé, et un rendu markdown « aplati » avec titres gras — sans viser la fidélité GFM complète que Claude Code n'a pas non plus.

### Gaps
- Bibliothèque de rendu markdown et de coloration syntaxique de Claude Code : non confirmée. Un résultat de recherche mentionnant « markdown-it + Shiki, 57 langages » provient de la DeepWiki du projet **tiers** `touwaeriol/claude-code-plus`, pas de Claude Code — à ne pas attribuer. Le `package.json` du dump fuité n'était pas accessible (404). — [DeepWiki claude-code-plus](https://deepwiki.com/touwaeriol/claude-code-plus/6.5-markdown-and-syntax-highlighting)
- Granularité exacte du streaming (token par token vs. par bloc) et la cadence de rendu ne sont pas documentées officiellement ; seul « maxFps: 30 » d'Ink upstream et le budget « ~16 ms » cité par un blog tiers sont disponibles (voir Q7).
- Couleurs exactes (hex/ANSI) des messages user vs assistant : non trouvées dans les sources publiques ; seul le « gray » des messages en file et le « gray » de l'indicateur de mode manual sont documentés.
- Glyphes exacts utilisés pour les task lists GFM depuis v2.1.149 : non documentés.

---

## Q2. Cartes d'appels d'outils : Read, Bash, Edit/Write (diff), Grep/Glob, Web, Agent, Todo, tâches de fond, transcript

### Takeaway
Chaque appel est une ligne `⏺ Tool(arg)` suivie d'un résultat `⎿ …` replié à 3-4 lignes ; les diffs Edit sont en unified diff coloré (constantes `diffAdded`/`diffRemoved`, fallback « Binary file - cannot display diff »/`DiffTooLarge`) ; les sous-agents s'affichent dans un panneau sous le prompt avec arbre `(+N)` et résumé `Done (N tool uses · M tokens · Xs)` ; la task list `Ctrl+T` montre 5 items max ; `Ctrl+B` passe Bash/agents en arrière-plan, `/tasks` les liste.

### Cited Findings

**Format générique et libellés d'outils**
- Ligne d'appel `⏺ Bash(sk work-list)` puis `⎿ <1re ligne>` … `… +11 lines (ctrl+o to expand)` (voir Q1). — [Issue #12589](https://github.com/anthropics/claude-code/issues/12589)
- Le libellé affiché dans le transcript peut différer du nom canonique : « the tool labeled `Stop Task` in the transcript has the canonical name `TaskStop` ». Libellés transcript documentés : Agent, Artifact, Ask User Question, Bash, Edit, Enter Plan Mode, Exit Plan Mode, Glob, Grep, LSP, Monitor, Notebook Edit, PowerShell, Read, Send Message, Skill, Stop Task, Task Create/Get/List/Update, Todo Write, Tool Search, Web Fetch, Web Search, Workflow, Write. `MultiEdit` est qualifié de « legacy », `TaskOutput` de « deprecated; use `Read` instead ». — [Docs Permissions](https://code.claude.com/docs/en/permissions), [Docs Tools reference](https://code.claude.com/docs/en/tools-reference)
- Après compaction, un fichier relu de plus de 5 000 tokens « comes back as a path reference without its content, shown as `Referenced file` instead of `Read` ». — [Docs Context window](https://code.claude.com/docs/en/context-window)
- Les appels MCP répétés se replient en une ligne « `Called slack 3 times` » (dépliable via `Ctrl+O`). — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- v2.1.269 : « transcript updates no longer re-process the whole conversation to build the collapsed tool-use summaries » (il existe donc des résumés d'appels d'outils repliés calculés). — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Composants du dump : `AssistantToolUseMessage.tsx`, `UserToolResultMessage/`, `GroupedToolUseContent.tsx`, `CollapsedReadSearchContent.tsx` (repli des Read/Grep/Glob), `BashModeProgress.tsx`, `AgentProgressLine.tsx`, `FilePathLink.tsx`. — [Njengah leak](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components/messages)

**Read**
- Read « Reads file contents with line numbers » ; au-delà de la limite de tokens il retourne la première page avec une notice `PARTIAL view` ; fichiers vides → notice ; offset au-delà de la fin → notice avec le nombre de lignes ; images >500 KB recompressées en JPEG ; PDF >10 pages lus par plages de 20 pages ; `.ipynb` refusés >100 MB. — [Docs Tools reference](https://code.claude.com/docs/en/tools-reference)
- Bug : Read affiche « (ctrl+o to expand) » mais ne se déplie pas (#8214). — [#8214](https://github.com/anthropics/claude-code/issues/8214)

**Bash**
- Limites de sortie : timeout par défaut 2 min (`BASH_DEFAULT_TIMEOUT_MS`, `BASH_MAX_TIMEOUT_MS` max 10 min) ; ≈30 000 caractères inline par défaut (`bashOutputMaxChars` jusqu'à 128 000) ; au-delà, sauvegarde dans un fichier avec chemin + aperçu ≈2 000 caractères ; échec : ≈10 000 caractères head+tail ; `BASH_MAX_OUTPUT_LENGTH` 30 000 (jusqu'à 150 000) ; tâche tuée au-delà de 5 GB. Les commandes atteignant le timeout passent automatiquement en arrière-plan (sauf `sleep`) avec « explicit message when moved to background with task ID and output file path ». — [Docs Tools reference](https://code.claude.com/docs/en/tools-reference)
- v2.1.269 : « Added a diff of the files a Bash command changed to the Bash tool result when the Bash tool handles file edits (setting `bashEditDiffEnabled`) ». — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Mode shell `!` : `! npm test` s'exécute et « Claude responds to the command output automatically once it lands in the transcript » (désactivable via `respondToBashCommands`) ; supporte `Ctrl+B`. — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)

**Tâches de fond (Ctrl+B, /tasks, /bashes)**
- `Ctrl+B` = « Background running tasks — Backgrounds Bash commands and agents. Tmux users press twice » ; retour immédiat d'un ID de tâche ; nettoyage à la sortie ; `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` désactive. — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- `/tasks` « Lists all running and recently completed subagents » avec statut, modèle et effort (v2.1.242+) ; `Enter` sur une ligne ouvre son transcript ; le footer affiche « `/tasks to see subagents` » pendant 30 s après la fin d'un sous-agent. — [Docs Sub-agents](https://code.claude.com/docs/en/sub-agents)
- v2.1.277 : « Fixed background shell tasks reporting benign non-zero exits (e.g. grep with no matches) as failures » ; v2.1.269 : nettoyage des codes d'échappement dans les notifications de tâches. — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- La doc ne mentionne plus `/bashes` ; le composant `BashModeProgress.tsx` existe dans le dump. — [Docs Commands](https://code.claude.com/docs/en/commands), [Njengah leak](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components)

**Edit / Write / diff**
- Rendu attendu du diff Edit (issue #59078, v2.1.141) : unified diff avec `-` rouge, `+` vert, lignes de contexte ; le code contient les constantes `diffAdded`, `diffAddedDimmed`, `diffRemoved`, `diffRemovedDimmed`, `DiffTooLarge`, `Binary file - cannot display diff`. Bug rapporté : « renders entire file as all-green additions (no removals, no context) ». — [Issue #59078](https://github.com/anthropics/claude-code/issues/59078)
- Composants du dump : `FileEditToolDiff.tsx`, `StructuredDiff/`, `diff/DiffDetailView.tsx`, `diff/DiffDialog.tsx`, `diff/DiffFileList.tsx`. — [Njengah leak: components](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components), [components/diff](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components/diff)
- Les chemins de fichiers imprimés après un Edit ou Write sont cliquables (Cmd/Ctrl+clic) en fullscreen ; chemins UNC rendus en texte brut. — [Docs Fullscreen](https://code.claude.com/docs/en/fullscreen)
- `/diff` (v2.1.260, 3 sept. 2026) : panneau latéral en fullscreen listant les fichiers modifiés avec compteurs +/−, rafraîchi à chaque Edit ou commande shell ; nécessite git, ≥110 colonnes ; s'ouvre seul dès que Claude édite si ≥144 colonnes ; `Ctrl+X B` cycle la base de comparaison (session / non commité / depuis la branche par défaut) ; sélection de lignes à la souris attachée au prompt suivant ; fermeture par `✕`. En renderer classique : « diff viewer » à la place du prompt avec vue **Current** + une vue par tour, navigation Left/Right/Up/Down/Enter/Esc. v2.1.274 : « `/diff` panel to open fully rendered in one step ». — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode), [Claude Camp](https://claudecamp.ai/blog/claude-code-diff-panel-live-review), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Checkpoints : chaque prompt crée un checkpoint (100 max), `Esc Esc` (prompt vide) ou `/rewind` ouvre le menu : « Restore code and conversation », « Restore conversation », « Restore code », « Summarize from here », « Summarize up to here », « Never mind » ; marqueur « **Summarized conversation** » inséré ; entrée `/resume <session-id> (previous session)` après `/clear` (v2.1.191+) ; avertissement `Restored the code, but skipped N files`. — [Docs Checkpointing](https://code.claude.com/docs/en/checkpointing)

**Grep / Glob**
- Grep : modes `files_with_matches` (défaut), `content` (fichier + n° de ligne, `No entries at this offset`), `count` ; pagination `head_limit`/`offset`. Glob : plafond 100 fichiers, tri par date de modification, flag de troncature. — [Docs Tools reference](https://code.claude.com/docs/en/tools-reference)

**WebFetch / WebSearch**
- WebFetch demande permission sauf « a built-in set of preapproved documentation domains » ; « don't ask again » sauvegarde « Permanently per repository and domain » ; WebSearch : « Permanently per repository ». Les prompts WebFetch/navigateur n'offrent pas le champ commentaire. — [Docs Permissions](https://code.claude.com/docs/en/permissions)

**Agent / Task (sous-agents)**
- « Claude Code shows nested subagents as a tree in the subagent panel below the prompt input and marks each row that still has descendants in the panel with a `(+N)` count » ; résumé de fin `Done (N tool uses · M tokens · Xs)` ; les sous-agents réussis disparaissent immédiatement (v2.1.232+) avec hint footer, les échoués/arrêtés restent 30 s ; `Ctrl+O` ouvre le transcript d'un sous-agent visible. — [Docs Sub-agents](https://code.claude.com/docs/en/sub-agents)
- `Ctrl+X Ctrl+K` = « Stop all running background subagents … Press twice within 3 seconds to confirm ». — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- v2.1.274 : « hook progress and sub-agent activity no longer re-process the whole conversation on every update ». Composants : `AgentProgressLine.tsx`, `CoordinatorAgentStatus.tsx`, `components/agents/`, `components/teams/`, `components/tasks/`. — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [Njengah leak](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components)

**TodoWrite / task list**
- `Ctrl+T` = « Toggle Claude's task checklist … in the status area » ; « The display shows up to five tasks at a time » ; état déplié restauré au `--resume` ; persistant à travers les compactions ; `CLAUDE_CODE_TASK_LIST_ID` partage la liste (`~/.claude/tasks/`). — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Format historique du rendu TodoWrite (issue #6891) : `☐` pending, `☑` completed, `⬜` in_progress ; régression signalée où seul « Todos have been modified successfully… » s'affichait. — [Issue #6891](https://github.com/anthropics/claude-code/issues/6891)
- v2.1.233 : TodoWrite/TaskCreate/… désactivés par défaut sur Opus 4.8, Sonnet 5, Fable 5, Mythos 5 et suivants ; `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` les rétablit ; les outils Task* ne sont fournis par défaut que sur Claude 3.x, Opus 4–4.7, Sonnet 4–4.6, Haiku 4.5. — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode), [Claude Code blog (tiers)](https://claudcod.com/blog/claude-code-todowrite-disabled/)

**NotebookEdit / MultiEdit / autres**
- `NotebookEdit` = « Modifies Jupyter notebook cells by `cell_id` » (libellé « Notebook Edit ») ; composant de permission dédié `NotebookEditPermissionRequest/` ; `MultiEdit` legacy (les règles `Edit(path)` couvrent tous les outils d'édition). — [Docs Tools reference](https://code.claude.com/docs/en/tools-reference), [Njengah leak: permissions](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components/permissions)

### Inferences
- La convention d'affichage est uniforme : `⏺ Nom(argument principal)` sur une ligne, résultat sous `⎿` indenté, repli automatique, et un « résumé replié » calculé par type d'outil (le composant `CollapsedReadSearchContent` suggère un résumé spécifique pour Read/Grep/Glob).
- Le panneau de sous-agents est une zone dynamique séparée (sous le prompt), pas dans le scrollback ; les notifications de fin sont injectées comme messages.
- La disparition de `/bashes` de la doc et l'existence de `/tasks` unifié (shells + sous-agents + workflows) indiquent une consolidation en 2026.

### Gaps
- Libellés exacts des résumés repliés (« Read 120 lines », « Found N files », « Updated file.ts with 3 additions and 1 removal », « Wrote N lines to … ») : non trouvés textuellement dans une source publique fiable ; la mention « Updated file with N additions and M removals » dans l'extraction de #59078 peut être une paraphrase — à vérifier empiriquement dans un terminal.
- Présence de numéros de ligne et de fonds colorés (background) dans le diff Edit : seules les constantes de couleur `diffAdded/diffRemoved(+Dimmed)` sont attestées ; les détails de mise en page (largeur, gouttière, numéros) ne le sont pas.
- Rendu exact d'un appel Agent en cours (spinner nested, compteur d'outils en direct) au-delà de la description « live updates including tool usage and token counts » de la doc.

---

## Q3. UX des permissions : prompts, modes, règles, /permissions, sandbox, retour au modèle

### Takeaway
Le prompt Edit affiche « Do you want to make this edit to <fichier>? » avec `1. Yes / 2. Yes, allow all edits during this session (shift+tab) / 3. Type here to tell Claude what to do differently` ; le prompt Bash offre « Yes », « Yes, and don't ask again for … », depuis v2.1.247 « Yes, and switch to auto mode », et « No » ; `Tab` sur Yes/No ouvre un champ de commentaire transmis au modèle ; les modes sont `default`(Manual)/`acceptEdits`/`plan`/`auto`/`dontAsk`/`bypassPermissions` cyclés par `Shift+Tab` avec indicateurs `⏸ manual mode on`, `⏵⏵ accept edits on`, `⏸ plan mode on`, `⏵⏵ auto mode on`, `⏵⏵ don't ask on`, `⏵⏵ bypass permissions on`.

### Cited Findings

**Prompt Edit**
- Texte exact observé :
  ```
  Do you want to make this edit to Taskfile.yml?
  ❯ 1. Yes
    2. Yes, allow all edits during this session (shift+tab)
    3. Type here to tell Claude what to do differently
  ```
  et avec `--permission-mode acceptEdits` l'indicateur « accept edits on (shift+tab to cycle) » sous le champ de saisie. — [jbranchaud/til](https://github.com/jbranchaud/til/blob/master/claude-code/allow-edits-from-the-start.md)
- Une approbation d'édition n'est jamais sauvegardée dans un fichier : « File modification … Yes … Until session end ». Pour une écriture dans `.claude/`, le prompt propose « **Yes, and allow Claude to edit its own settings for this session** » (bug #37029 : chaque édition re-prompte). — [Docs Permissions](https://code.claude.com/docs/en/permissions), [Docs Permission modes](https://code.claude.com/docs/en/permission-modes), [#37029](https://github.com/anthropics/claude-code/issues/37029)
- `Shift+Tab` sur un prompt de fichier ferme le champ commentaire (v2.1.235+ ; avant, il sélectionnait l'option « allow for the rest of the session » et jetait le commentaire). — [Docs Permissions](https://code.claude.com/docs/en/permissions)

**Prompt Bash**
- Tableau officiel : Bash « Yes, except a built-in set of read-only commands » ; « don't ask again » = « Permanently per repository and command » ; règle écrite dans `.claude/settings.local.json` à la racine du dépôt git (résolue via worktrees, v2.1.211+). — [Docs Permissions](https://code.claude.com/docs/en/permissions)
- « The permission dialog writes the space-separated form when you select "Yes, and don't ask again" for a command prefix » (ex. `Bash(npm run *)`) ; pour une commande composée « saves a separate rule for each subcommand that requires approval … Up to 5 rules ». — [Docs Permissions](https://code.claude.com/docs/en/permissions)
- Variantes de libellé rapportées : « Yes, and don't ask again for [command] in [directory] », « Yes, and don't ask again for: cd:* », « Yes, and don't ask again for similar commands in [directory] ». — [Munder Difflin (tiers)](https://munderdiffl.in/blog/why-does-claude-code-keep-asking-for-permission/), [#29400](https://github.com/anthropics/claude-code/issues/29400), [#16735](https://github.com/anthropics/claude-code/issues/16735)
- v2.1.247+ : « Claude Code adds **Yes, and switch to auto mode** to a Bash command's permission prompt » (Manual/acceptEdits, quand auto est disponible ; pas sur PowerShell ni sur les prompts forcés par une règle `ask` ou un hook). — [Docs Permission modes](https://code.claude.com/docs/en/permission-modes)
- « Sometimes a permission prompt offers only a one-time approval, with no "don't ask again" option » quand le prompt ne peut pas montrer tout ce qu'il autoriserait. — [Docs Permissions](https://code.claude.com/docs/en/permissions)
- v2.1.275 : « Improved the dangerous-rm permission prompt to name the flagged rm command and suggest a `${VAR:?}` guard ». — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Un prompt « d » pour voir le diff complet, « e » pour éditer, « y/n » — mentionnés par un blog tiers, **non confirmés** par la doc officielle. — [claudefa.st](https://claudefa.st/blog/guide/mechanics/output-formatting)

**Commentaire et retour au modèle (denials)**
- « move to **Yes** or **No** and press `Tab` to open a comment field » ; `Enter` envoie ; **Yes** → « runs the action, then sends your comment to Claude after the result » ; **No** → « sends your comment to Claude as the reason for the denial, and Claude continues working. If you select **No** without a comment on a prompt from the main conversation, Claude Code stops the turn. » `Esc` sur un prompt = No sans commentaire. — [Docs Permissions](https://code.claude.com/docs/en/permissions), [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Navigation : `Left/Right` = « Cycle through dialog tabs — Navigate between tabs in permission dialogs and menus » ; v2.1.280 : Home/End réparés dans les prompts ; « a stray `n` closing dialogs and a stray `y` confirming them » corrigé (Enter/Esc acceptent/annulent ; `y`/`n` rebindables `confirm:yes`/`confirm:no`). — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Auto mode : « If the classifier blocks, Claude receives the reason and tries an alternative. In most sessions the reason names the rule the classifier matched, such as `[Data Exfiltration]` ». Une action bloquée : « Claude Code shows a notification and lists the action in `/permissions` under the **Recently denied** tab, where you can press `r` to retry it with a manual approval ». Après 3 blocages consécutifs ou 20 au total, auto mode se met en pause et re-prompte. — [Docs Permission modes](https://code.claude.com/docs/en/permission-modes)
- Sandbox : « Claude Code reports sandbox violations in the blocked command's result, naming the path or host the sandbox denied » ; Claude peut relancer avec `dangerouslyDisableSandbox` → prompt normal en Manual ; désactivable via `"allowUnsandboxedCommands": false` (affiché **Strict sandbox mode** dans l'onglet **Overrides** de `/sandbox`). — [Docs Sandboxing](https://code.claude.com/docs/en/sandboxing)

**Modes de permission**
- `default` (« Labeled Manual in the CLI », alias `manual`, v2.1.200+) ; `acceptEdits` (auto-accepte éditions + `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp`, `sed` dans le working dir) ; `plan` ; `auto` (« Auto-approves tool calls with background safety checks », classifieur = Sonnet 5 par défaut) ; `dontAsk` (refuse tout ce qui prompterait) ; `bypassPermissions` (skip sauf « actions no mode auto-approves »). Sur Pro/Max/Team, « the built-in starting permission mode is auto mode ». `permissions.disableBypassPermissionsMode` / `permissions.disableAutoMode` = `"disable"`. — [Docs Permissions](https://code.claude.com/docs/en/permissions), [Docs Permission modes](https://code.claude.com/docs/en/permission-modes)
- Cycle `Shift+Tab` : « From `auto`, the first press switches to `default`, and the cycle then runs `default` → `acceptEdits` → `plan` → back to `default`. Optional modes … slot in after `plan` » (`bypassPermissions` d'abord, `auto` en dernier ; `dontAsk` jamais dans le cycle). Indicateurs : « a gray `⏸ manual mode on` for `default`, or as `⏵⏵ accept edits on`, `⏸ plan mode on`, `⏵⏵ auto mode on`, `⏵⏵ don't ask on`, or `⏵⏵ bypass permissions on` ». `Alt+M` sur Windows si VT input indisponible. — [Docs Permission modes](https://code.claude.com/docs/en/permission-modes), [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- `bypassPermissions` n'apparaît qu'après `--permission-mode bypassPermissions`, `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions` ou `permissions.defaultMode`. Dialog dédié dans le dump : `BypassPermissionsModeDialog.tsx`, `AutoModeOptInDialog.tsx`. — [Docs Permission modes](https://code.claude.com/docs/en/permission-modes), [Njengah leak](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components)
- Auto mode : classifieur côté serveur par défaut pour API/Enterprise/Bedrock/Vertex/Foundry (v2.1.278) ; `allowed_domains` par commande sous sandbox (v2.1.271) ; le classifieur voit messages user, appels d'outils (sauf lectures) et CLAUDE.md, « Tool results are stripped ». — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [Docs Permission modes](https://code.claude.com/docs/en/permission-modes)

**Syntaxe des règles**
- `Tool` ou `Tool(specifier)` ; `Bash(npm run build)` exact ; `Bash(npm run *)` préfixe (« `:*` suffix is an equivalent way to write a trailing wildcard ») ; `Read(./.env)`, `Edit(src/**)` (gitignore : `//` absolu, `/` relatif à la source des settings, `~/` home), `WebFetch(domain:example.com)`, `mcp__server__tool`, `mcp__puppeteer__*`, `Agent(Explore)`, `Skill(deploy *)`, paramètres `Agent(model:opus)`, `Bash(run_in_background:true)` (deny/ask seulement). Ordre d'évaluation « deny, then ask, then allow ». Un deny sur un nom d'outil nu « removes the tool from Claude's context entirely ». Opérateurs reconnus pour le découpage : `&&`, `||`, `;`, `|`, `|&`, `&`, retours à la ligne ; wrappers `timeout`, `time`, `nice`, `nohup`, `stdbuf`, `command`, `builtin`, `noglob`, `xargs` nu strippés. Commandes read-only intégrées : `ls`, `cat`, `echo`, `pwd`, `head`, `tail`, `grep`, `find`, `wc`, `which`, `diff`, `stat`, `du`, `cd`, formes read-only de `git`. — [Docs Permissions](https://code.claude.com/docs/en/permissions), [Docs Tools reference](https://code.claude.com/docs/en/tools-reference)
- Exemple JSON :
  ```json
  { "permissions": { "allow": ["Bash(npm run *)", "Bash(git commit *)"], "deny": ["Bash(git push *)"] } }
  ```
  — [Docs Permissions](https://code.claude.com/docs/en/permissions)

**/permissions**
- « Manage allow, ask, and deny rules … Opens an interactive dialog where you can view rules by scope, add or remove rules, manage working directories, and review recent auto mode denials » ; onglet **Auto mode** (règles du classifieur), onglet **Recently denied** ; modifiable pendant que Claude travaille (v2.1.234+). v2.1.280 : focus retourne à la liste après action, confirmations de suppression par défaut sur No, `←/→`/Tab changent d'onglet. — [Docs Commands](https://code.claude.com/docs/en/commands), [Docs Permissions](https://code.claude.com/docs/en/permissions), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

**Sandbox Bash (2026)**
- Intégré, macOS (Seatbelt) / Linux / WSL2 (bubblewrap + seccomp optionnel), pas Windows natif ; `/sandbox` ouvre un panneau à trois onglets (**Mode**, …, + **Dependencies** sur Linux si seccomp manque). Deux modes : **Auto-allow** (« runs it inside the sandbox and approves it automatically ») et **Regular permissions**. Réglages : `sandbox.filesystem.allowWrite/denyWrite/denyRead/allowRead/disabled`, `allowedDomains`/`deniedDomains`, `excludedCommands`, `allowUnsandboxedCommands`. « `/sandbox` is not a permission mode ». — [Docs Sandboxing](https://code.claude.com/docs/en/sandboxing)

**Composants de permission (dump)**
- `src/components/permissions/` : `PermissionRequest.tsx`, `PermissionDialog.tsx`, `PermissionPrompt.tsx`, `PermissionRequestTitle.tsx`, `PermissionExplanation.tsx`, `PermissionRuleExplanation.tsx`, `PermissionDecisionDebugInfo.tsx`, `FallbackPermissionRequest.tsx`, `SandboxPermissionRequest.tsx`, `WorkerBadge.tsx`, `WorkerPendingPermission.tsx`, dossiers `BashPermissionRequest`, `PowerShellPermissionRequest`, `FileEditPermissionRequest`, `FileWritePermissionRequest`, `FilesystemPermissionRequest`, `FilePermissionDialog`, `NotebookEditPermissionRequest`, `SedEditPermissionRequest`, `WebFetchPermissionRequest`, `SkillPermissionRequest`, `AskUserQuestionPermissionRequest`, `EnterPlanModePermissionRequest`, `ExitPlanModePermissionRequest`, `ComputerUseApproval`, `rules/`. — [Njengah leak: permissions](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components/permissions)

### Inferences
- Le prompt est un composant `Select` avec `❯` sur l'option courante, options numérotées (touches 1-3), et une 3e option « Type here… » qui est un champ de texte libre servant de refus commenté ; le diff Edit est rendu au-dessus des options par `FileEditPermissionRequest` (même composant de diff que dans le transcript).
- Pour Fuller : implémenter (1) une liste d'options numérotées avec un texte libre de refus, (2) une règle générée automatiquement (préfixe `cmd *`) persistée par dépôt, (3) un champ commentaire renvoyé au modèle après le résultat ou comme motif de refus, (4) un cycle de modes affiché en pied de page avec les glyphes `⏸`/`⏵⏵`.

### Gaps
- Libellé exact et complet de l'option Bash « Yes, and don't ask again for … » en v2.1.28x (les variantes citées viennent de blogs/issues, pas de la doc).
- Mise en page exacte du diff dans le prompt Edit (numéros de ligne, contexte) : non documentée.
- Rendu visuel de la « notification » d'action bloquée par auto mode : non décrit.

---

## Q4. UX du plan mode

### Takeaway
Le plan est présenté par l'outil `ExitPlanMode` avec un prompt à trois options — « Yes, and use auto mode » (ou « Yes, auto-accept edits » sans auto mode, ou « Yes, and switch to BYPASS PERMISSIONS (no further prompts) for this session » avec bypass) / « Yes, manually approve edits » / « No, keep planning » — `Ctrl+G` ouvre le plan dans l'éditeur ; le plan est stocké sur disque et ré-injecté après compaction ; le footer affiche `⏸ plan mode on`.

### Cited Findings
- « Plan mode tells Claude to research and propose changes without making them … The status bar shows `⏸ plan mode on` while plan mode is active. » Entrée via `Shift+Tab`, `/plan [description]` (« `/plan fix the auth bug` »), ou `claude --permission-mode plan` ; `Shift+Tab` à nouveau quitte sans approuver. — [Docs Permission modes](https://code.claude.com/docs/en/permission-modes), [Docs Common workflows](https://code.claude.com/docs/en/common-workflows), [Docs Commands](https://code.claude.com/docs/en/commands)
- Options d'approbation (verbatim) : « **Yes, and use auto mode**: approve and start in auto mode. If auto mode isn't available to your session … this option reads **Yes, auto-accept edits**. If you started the session with bypass permissions enabled, the option reads **Yes, and switch to BYPASS PERMISSIONS (no further prompts) for this session** instead. » ; « **Yes, manually approve edits**: approve and review each edit individually. » ; « **No, keep planning**: stay in plan mode and tell Claude what to change. » ; « Approving a plan exits plan mode and switches the session to the permission mode each approve option describes ». — [Docs Permission modes](https://code.claude.com/docs/en/permission-modes)
- « Press `Ctrl+G` to open the proposed plan in your default text editor and edit it directly before Claude proceeds. When `showClearContextOnPlanAccept` is enabled, the list gains a first option that approves the plan and clears the planning context. » ; accepter un plan « gives the session a generated title based on the plan ». — [Docs Permission modes](https://code.claude.com/docs/en/permission-modes)
- Question du titre du prompt (« Would you like to proceed? ») et l'ancienne 1re option « Yes, and auto-accept edits » (issue #2988 demandant à ne pas activer auto-accept en sortie de plan). — [#2988](https://github.com/anthropics/claude-code/issues/2988), [dev.to rulestack](https://dev.to/rulestack/claude-code-plan-mode-what-it-actually-blocks-what-still-runs-and-what-approving-switches-you-22m3)
- Pendant la planification, avec auto mode disponible et `useAutoModeDuringPlan` (activé par défaut), « the classifier reviews shell commands during planning instead of prompting you » ; sinon seules les commandes read-only passent sans prompt. En session interactive avec bypass disponible, les blocages du plan mode ne sont pas appliqués. — [Docs Permission modes](https://code.claude.com/docs/en/permission-modes)
- Fichier de plan : « The plan Claude wrote in plan mode — Re-injected from disk » après compaction. — [Docs Context window](https://code.claude.com/docs/en/context-window)
- Outils dédiés : `EnterPlanMode` (« Switches to plan mode to design an approach before coding »), `ExitPlanMode` (« Presents a plan for approval and exits plan mode ») ; composants `EnterPlanModePermissionRequest/`, `ExitPlanModePermissionRequest/`, `messages/PlanApprovalMessage.tsx`, `messages/UserPlanMessage.tsx`. — [Docs Tools reference](https://code.claude.com/docs/en/tools-reference), [Njengah leak](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components/permissions)
- VS Code (2.1.269-2.1.277) : « Plan dialog », « plan review card » avec commentaires de page, correctif « when auto mode is available, its first option is now 'Yes, and use auto mode' ». — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- `/plan` : « Enter plan mode directly from the prompt. Pass an optional description to enter plan mode and immediately start with that task ». — [Docs Commands](https://code.claude.com/docs/en/commands)

### Inferences
- Le plan (markdown) est rendu dans le transcript via le renderer markdown standard, puis le prompt `ExitPlanModePermissionRequest` affiche la liste d'options ; c'est un cas particulier du composant de permission générique.
- Le libellé de la 1re option dépend dynamiquement des modes disponibles (auto / acceptEdits / bypass), donc Fuller doit prévoir une option « approuve + change de mode » paramétrable.

### Gaps
- Emplacement exact du fichier de plan (`~/.claude/plans/…` ?) : la doc consultée dit seulement « re-injected from disk ».
- Texte exact du titre du prompt d'approbation dans la v2.1.28x (« Would you like to proceed? » n'apparaît que dans des sources tierces/anciennes).

---

## Q5. Widgets de session : /cost (/usage), /context, auto-compact, /compact, /export

### Takeaway
`/cost` est un alias de `/usage` dont le bloc Session affiche `Total cost / Total duration (API) / Total duration (wall) / Total code changes / Usage by model` (+ ligne `Prompt cache (main)` depuis v2.1.251) ; `/context` dessine une grille colorée par catégorie avec suggestions ; l'auto-compact se déclenche à un seuil dépendant du modèle (ex. ≈967K sur fenêtre 1M, 200K sur Sonnet/Opus 4.6) réglable via `/autocompact 500k` ; `/compact <focus>` guide le résumé ; `/export` copie ou sauvegarde le texte brut.

### Cited Findings

**/cost et /usage**
- « `/cost` — Alias for `/usage` ». Bloc Session (verbatim) :
  ```
  Total cost:            $0.55
  Total duration (API):  6m 20s
  Total duration (wall): 6h 33m 10s
  Total code changes:    0 lines added, 0 lines removed
  Usage by model:
     claude-sonnet-4-6:  1.2k input, 5.3k output, 940.0k cache read, 50.0k cache write ($0.55)
  ```
  Ligne `Prompt cache (main):   14 requests · 91% of input tokens from cache · 2 misses (last 6m 10s ago, 310.2k tokens re-cached) · 1 expected rebuild (compaction or tool-result clearing) · warm (1h TTL, last activity 40s ago)` (v2.1.251+, « likely cause: … » v2.1.260+). Totaux remis à zéro par `/clear` (v2.1.211+). Note « at your organization's configured rates » si `modelPricing`. Abonnés : barres de plan, attribution par skills/sous-agents/plugins/MCP, « Behavior flags », « Loops », touches `d`/`w` (24 h / 7 jours), `r` retry, note « Showing last-known usage ». — [Docs Commands](https://code.claude.com/docs/en/commands), [Docs Costs](https://code.claude.com/docs/en/costs)
- Le résumé de coût imprimé à la sortie (Ctrl+C/Ctrl+D) a disparu vers la v2.0.14 (issue #9463 fermée doublon) ; format historique :
  ```
  Total cost:            $0.0411
  Total duration (API):  30.7s
  Total duration (wall): 1m 4s
  Total code changes:    0 lines added, 0 lines removed
  Usage by model:
      claude-3-5-haiku:  10.5k input, 411 output, 0 cache read, 0 cache write ($0.0100)
         claude-sonnet:  13 input, 483 output, 40.0k cache read, 3.1k cache write ($0.0310)
  ```
  — [Issue #9463](https://github.com/anthropics/claude-code/issues/9463)
- Champs JSON de la status line : `cost.total_cost_usd`, `cost.total_lines_added/removed`, `cost.total_duration_ms`, `cost.total_api_duration_ms`, `context_window.used_percentage` (input-only : `input_tokens + cache_creation + cache_read`), `remaining_percentage`, `context_window_size` (200000 ou 1000000), `exceeds_200k_tokens`, `rate_limits.five_hour/seven_day.used_percentage`, `prompt_cache`, `pr.number`. La status line « renders in its own row above the built-in footer badges ». — [Docs Statusline](https://code.claude.com/docs/en/statusline)
- Dialog `CostThresholdDialog.tsx` dans le dump. — [Njengah leak](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components)

**/context**
- « Visualize current context usage as a colored grid. Shows optimization suggestions for context-heavy tools, memory bloat, and capacity warnings. When the conversation exceeds the context window, the output includes a warning showing how far over the limit you are and which command frees space. In fullscreen mode, `/context` collapses the per-item breakdown to keep the grid visible. Pass `all` to expand it ». Composant `ContextVisualization.tsx`. — [Docs Commands](https://code.claude.com/docs/en/commands), [Njengah leak](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components)
- Description tierce : grille de symboles `⛁`, `⛀`, `⛝`, `⛶` (10×10 pour 200K, 20×10 pour 1M), catégories System Prompt, System Tools, MCP Tools, Custom Agents, Memory Files, Skills, Messages, Free Space, Autocompact Buffer (« 13,000 Tokens » réservés). Autre blog : légende « System prompt (●), System tools (●), Skills (○), Messages (○), Free space (□), Autocompact buffer (■) » avec tokens et pourcentages ; exemples 10,7k tokens de system prompt, 28,5k d'outils. — [Vincent Qiao](https://blog.vincentqiao.com/en/posts/claude-code-context/), [jdhodges](https://www.jdhodges.com/blog/claude-code-context-slash-command-token-usage/), [XDA](https://www.xda-developers.com/claude-code-using-fifty-thousand-tokens-before-typed-prompt-fixed-it/) (tiers)
- v2.1.280 : « Fixed the context meter and auto-compact counting advisor-tool turns at roughly twice their real context size ». — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

**Auto-compact et avertissements**
- Indicateur « Context left until auto-compact: XX% » décrit comme barre de progression temps réel ; à 0 % la compaction se déclenche. — [Medium, L. K. Swain](https://lalatenduswain.medium.com/understanding-context-left-until-auto-compact-0-in-claude-cli-b7f6e43a62dc), [ClaudeLog](https://claudelog.com/faqs/what-is-claude-code-auto-compact/) (tiers)
- Seuils officiels : sans réglage, compaction « when the conversation reaches the model's context limit », sauf : Sonnet 4.6/Opus 4.6 sans contexte étendu → 200K ; modèles 1M natifs (Sonnet 5, Fable, Opus 4.7+) → « at about 967K tokens by default » ; `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` → 200K. Réglage : `/autocompact 500k` (setting `autoCompactWindow`, `/autocompact auto`), flag `--autocompact`, env `CLAUDE_CODE_AUTO_COMPACT_WINDOW` ; valeurs 100K–1M (`200000`, `500k`, `1M`, ou `200`). — [Docs Model config](https://code.claude.com/docs/en/model-config), [Docs Context window](https://code.claude.com/docs/en/context-window)
- Chiffre tiers plus ancien : déclenchement « approximately 83.5% of the context window » (~167K sur 200K). — [ClaudeLog](https://claudelog.com/faqs/what-is-claude-code-auto-compact/)
- Messages d'erreur liés : `Prompt is too long`, `Prompt is too long · automatic compaction failed:`, `Context limit reached · /compact or /clear to continue`, `Context limit reached · /clear to continue`. v2.1.273 : session bloquée sur « Prompt is too long » corrigée. — [Docs Errors](https://code.claude.com/docs/en/errors), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Ce qui survit à la compaction : system prompt, CLAUDE.md racine, auto memory, snapshot git, plan (ré-injectés depuis le disque) ; jusqu'à 5 fichiers relus ; skills ré-injectées (5 000 tokens/skill, 25 000 total) ; tâches de fond continuent ; hooks `SessionStart` source `compact`. Depuis v2.1.198 la requête de résumé hérite du réglage thinking. Composant `CompactBoundaryMessage.tsx`. — [Docs Context window](https://code.claude.com/docs/en/context-window), [Njengah leak](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components/messages)
- `/compact` : « Free up context by summarizing the conversation so far. Optionally pass focus instructions for the summary » ; exemple `/compact Focus on code samples and API usage` ; en session vide → `Not enough messages to compact.` ; instructions permanentes via section `# Compact instructions` de CLAUDE.md ; alternative `/rewind` → « Summarize from here / up to here » avec champ « add context (optional) » et marqueur « Summarized conversation ». — [Docs Costs](https://code.claude.com/docs/en/costs), [Docs Checkpointing](https://code.claude.com/docs/en/checkpointing)
- Lignes de statut spinner pendant la compaction : « Running PreCompact hooks… » (v2.1.280). — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- En fullscreen : « You can scroll back to the start of the session even after compaction … Claude Code keeps every earlier message in the fullscreen scrollback across repeated compactions ». — [Docs Fullscreen](https://code.claude.com/docs/en/fullscreen)

**/export, /clear, /btw, recap**
- `/export` : « Export the current conversation as plain text. With a filename, writes directly to that file. Without, opens a dialog to copy to clipboard or save to a file » (composant `ExportDialog.tsx`). `/clear` (alias `/reset`, `/new`) accepte un nom pour étiqueter la conversation précédente. `/btw` : question annexe en overlay sans polluer le contexte (`f` = forker en sous-agent). Session recap : « one-line recap » après ≥3 min d'absence (400 caractères max, `/recap`). — [Docs Commands](https://code.claude.com/docs/en/commands), [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)

### Inferences
- Le pourcentage de contexte est calculé côté client à partir des champs `usage` de la dernière réponse API (input-only), et le même chiffre alimente la status line, `/context` et le déclenchement auto-compact.
- Fuller peut reproduire `/cost` avec un tableau aligné à deux colonnes (label + valeur) et un `Usage by model` indenté, et `/context` avec une grille de N cellules (100 ou 200) coloriées par catégorie + légende.

### Gaps
- Sortie verbatim complète de `/context` en v2.1.28x (glyphes exacts, ordre des lignes) : seules des descriptions tierces divergentes (`⛁⛀⛝⛶` vs `●○□■`) ont été trouvées.
- Texte exact du message affiché pendant l'auto-compaction dans le CLI (« Compacting conversation… » ?). La phrase « Compacting our conversation so we can keep chatting… » citée par un blog tiers ressemble au message de claude.ai, pas au CLI. — [Unmarkdown (tiers)](https://unmarkdown.com/blog/claude-compacting-explained)
- Rendu exact de l'avertissement de contexte bas dans le footer (seuil en %, couleur) : non documenté officiellement.

---

## Q6. Erreurs et informations : erreurs API, retries, limites, tips, résumé de sortie

### Takeaway
Les erreurs API s'affichent inline sous la forme `API Error (529 {...overloaded_error...}) · Retrying in N seconds… (attempt X/10)` (10 tentatives avec backoff) ; les limites d'usage produisent « You've hit your session limit / weekly limit / Opus limit… » avec heure de reset et, depuis v2.1.234, une attente automatique jusqu'au reset ; les « tips » sont injectés dans la ligne du spinner ; le résumé de coût à la sortie n'existe plus (remplacé par `/usage`).

### Cited Findings
- Format observé (v1.0.56, toujours cité en 2026) : `API Error (529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}) · Retrying in 2 seconds… (attempt 3/10)` ; « Claude Code retries transient failures up to 10 times with exponential backoff before showing you an error ». Composant `SystemAPIErrorMessage.tsx`. — [Issue #4058](https://github.com/anthropics/claude-code/issues/4058), [Issue #60577](https://github.com/anthropics/claude-code/issues/60577), [Njengah leak](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components/messages)
- Messages documentés (référence d'erreurs) : `API Error: 500 Internal server error`, `API Error: Repeated 529 Overloaded errors`, `Request timed out`, `API Error: No response from API`, `Server error mid-response. The response above may be incomplete.`, `Waiting for API response · will retry in …`, `Connection lost mid-response`, `Your computer went to sleep mid-response`, `The response stopped arriving`, `Connection closed mid-response`, `Response stalled mid-stream`, `You've hit your session limit` / `weekly limit` / `Opus limit` / `Sonnet limit` / `monthly spend limit` / `individual spend limit` / `org's monthly spend limit` / `channel's monthly spend limit` / `team's shared budget` / `individual usage limit`, `Prompt is too long`, `Input is too long for requested model`, `Cannot switch renderers in this session`, `Cannot switch renderers while work is running in the background`. — [Docs Errors](https://code.claude.com/docs/en/errors)
- Limites : « The message shows when the window resets » ; v2.1.234+ : « wait and continue the interrupted task automatically after the reset » (menu `/rate-limit-options`, setting `autoContinueAtUsageLimit`) ; composant `RateLimitMessage.tsx`. — [Docs Costs](https://code.claude.com/docs/en/costs), [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Erreurs de renderer : « Claude Code exited after an unrecoverable interface error » (v2.1.277 corrige un cas au premier spinner), « Claude Code's fullscreen renderer didn't finish starting last time on this machine », « Claude Code's fullscreen renderer has repeatedly failed to start on this machine ». — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [Docs Fullscreen](https://code.claude.com/docs/en/fullscreen)
- Tips : « spinner tip » (ex. suggestion de `/focus`, du desktop app pour Bedrock/Vertex, du plugin frontend-design) ; hint tmux « one-time hint at startup if it detects tmux with mouse mode off » ; hints footer PR : « install gh for PR status », « gh auth login for PR status », badge « PR #446 » / « MR !N » souligné en couleur selon l'état. — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [Docs Fullscreen](https://code.claude.com/docs/en/fullscreen), [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Toasts : « Claude Code prints a toast after each copy telling you which path it used » (pbcopy/OSC 52/tmux). — [Docs Fullscreen](https://code.claude.com/docs/en/fullscreen)
- Dialogs système : `InvalidConfigDialog.tsx` (settings invalides listées au démarrage), `TrustDialog/`, `ManagedSettingsSecurityDialog/`, `AutoUpdater.tsx`, `KeybindingWarnings.tsx`, `ShutdownMessage.tsx`. — [Njengah leak](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components)
- `Ctrl+D` : « The first press shows a confirmation hint and a second press within 800ms exits » ; `Ctrl+C` : « first press clears the prompt input and a second press exits ». — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)

### Inferences
- Les erreurs API sont des messages « system » insérés dans le flux (composant dédié) plutôt que des boîtes modales ; le compte à rebours de retry est mis à jour en place dans la zone dynamique.
- Il n'y a plus de « résumé final » à la sortie ; l'équivalent est `/usage` et la status line.

### Gaps
- Couleur/forme exacte des « yellow warning boxes » (encadrés jaunes) : aucune source ne décrit le style ; seules les chaînes de message sont attestées.
- Texte exact du message de retry en v2.1.28x (`Waiting for API response · will retry in …` d'après la référence d'erreurs, mais la forme complète n'est pas citée).

---

## Q7. Approche technique de rendu : Ink/Yoga, scrollback, alt-screen, flicker, largeur, symboles

### Takeaway
Claude Code a quitté Ink upstream (v2.0.10, oct. 2025) pour un renderer maison gardant React comme modèle de composants : reconciler custom, port Yoga en pur TypeScript, parseur ANSI/CSI/DEC/OSC, rendu différentiel cellule par cellule (v2.0.72, déc. 2025, « ~85 % de flicker en moins »), puis un mode « fullscreen » sur écran alternatif avec scrollback virtualisé (`CLAUDE_CODE_NO_FLICKER=1`, v2.1.88, 30 mars 2026), devenu défaut pour les nouveaux utilisateurs à partir du 6 mai 2026 / v2.1.239 ; le renderer « classique » (scrollback natif) reste sélectionnable via `/tui default`.

### Cited Findings

**Modèle Ink d'origine (référence pour Fuller)**
- Ink : `<Static>` « permanently renders its output above everything else », « useful for displaying activity like completed tasks or logs - things that don't change after they're rendered » ; ne traite que les nouveaux `items`. Options `alternateScreen` (buffer séparé, restauré à la sortie), `incrementalRendering` (« only updates changed lines instead of redrawing the entire output »), `maxFps` (défaut 30), `debug`. En CI « only the last frame is rendered on exit ». — [Ink README](https://github.com/vadimdemedes/ink/blob/master/readme.md)
- Diagnostic (Peter Steinberger) : « Ink, the React-based terminal renderer Claude Code originally used, didn't support the kind of fine-grained incremental updates needed for a long-running interactive UI » ; deux stratégies possibles — alt-screen ou « Carefully re-render changed parts while leaving the scrollback unchanged » ; Anthropic a « rewrote the renderer from scratch — while still keeping React as the component model » car « We value this native experience a lot » (sélection/scroll/recherche natifs). — [steipete.me](https://steipete.me/posts/2025/signature-flicker)
- Staff Anthropic (HN) : « Ink…clears and redraws for each update » ; « ~5ms to go from the React scene graph to ANSI » ; « We've rewritten our rendering system from scratch…only ~1/3 of sessions see at least a flicker » ; nouveau renderer différentiel : « Converting screen buffers to packed TypedArrays to reduce garbage collection pressure », double-buffering avec diff par cellule ; « Synchronized output totally eliminates flickering…patches accepted to VSCode's terminal and tmux ». Le proxy Rust `claude-chill` filtre les redraws redondants. — [HN « Claude Chill »](https://news.ycombinator.com/item?id=46699072)
- Chronologie tierce : v2.0.10 (oct. 2025) « replaced Ink library with custom renderer » ; v2.0.72 (déc. 2025) renderer différentiel ; janv. 2026 TypedArray ; v2.1.19–2.1.83 correctifs ciblés ; v2.1.88 (30 mars 2026) `CLAUDE_CODE_NO_FLICKER=1`. Pipeline : « React scene graph → layout → rasterization to 2D terminal cell grid → diffing against previous frame → ANSI escape code generation — all within ~16ms ». Ampleur : >1 000 upvotes (#1913, #769, #3648), « 4,000 to 6,700 scroll events per second ». — [slyapustin.com](https://slyapustin.com/blog/claude-code-no-flicker.html), [Boris Cherny (Threads)](https://www.threads.com/@boris_cherny/post/DSZbZatiIvJ/) (« reduce flickering by roughly 85% »)
- Régression v2.1.89 (1er avril 2026) : alt-screen activé par défaut, « When output exceeds terminal height (~24 rows), the entire conversation is re-rendered from scratch, destroying scrollback content » (bannière affichée 3 fois) ; contournement `CLAUDE_CODE_NO_FLICKER=0` ; fermé doublon de #41814. — [Issue #41965](https://github.com/anthropics/claude-code/issues/41965)

**Renderer fullscreen (2026)**
- « draws the interface on the terminal's alternate screen buffer, like `vim` or `htop`, and only renders messages that are currently visible » ; « The input box stays fixed at the bottom » ; « Only visible messages are kept in the render tree, so memory stays constant » ; « Fullscreen rendering sends only the cells that changed between frames » ; `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT=1` repeint tout (ConPTY/Windows Terminal) ; « Claude Code probes the terminal for synchronized-output support at startup and uses it when the terminal reports it » (tmux ≤3.6 ne l'implémente pas). — [Docs Fullscreen](https://code.claude.com/docs/en/fullscreen)
- Sélection du renderer : `/tui fullscreen` / `/tui default` / `/tui` (relance le process en conservant la conversation, le mode, le modèle) ; env `CLAUDE_CODE_NO_FLICKER=1|0`, `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`, setting `tui` ; défaut fullscreen si premier lancement ≥ v2.1.239 (sans feature flags) ou première utilisation ≥ 6 mai 2026 ; dialog de proposition affiché au plus 3 fois (« Not now ») ; classique forcé en screen-reader mode, iTerm2 `tmux -CC`, SSH vers Windows ; après 2 démarrages ratés retour au classique. — [Docs Fullscreen](https://code.claude.com/docs/en/fullscreen)
- Souris : clic dans le prompt, clic sur options de menus/permissions (v2.1.187+), multi-select (v2.1.208+), `/config` (v2.1.271+), clic pour déplier un résultat d'outil, Cmd/Ctrl+clic sur URL/chemin, drag-select avec copie automatique (double-clic mot, triple-clic ligne), molette ; `CLAUDE_CODE_DISABLE_MOUSE=1`, `CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1` (v2.1.195+), `CLAUDE_CODE_SCROLL_SPEED` (1–20, `/scroll-speed`), `wheelScrollAccelerationEnabled`. Scroll : `PgUp/PgDn` (demi-écran), `Ctrl+Home/End`, bouton flottant « Jump to bottom » avec « 3 new messages », en-tête atténué montrant le dernier prompt hors vue, `claudeCode.scrollToBottomOnSend` (v2.1.274), Auto-scroll désactivable dans `/config`. Scrollbar à droite dans `/artifacts`, `/workflows` (v2.1.275/280). — [Docs Fullscreen](https://code.claude.com/docs/en/fullscreen), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Correctifs récents : v2.1.274 « large diffs and long transcripts render faster, with fewer slow frames » ; v2.1.275 « freezing or blanking for several seconds when scrolling up past a large file diff », lignes vides après resize ; v2.1.269 fond stale après perte de background ; v2.1.277 « the screen could stop updating for the rest of the session after an internal rendering error » ; v2.1.280 retour de `Ctrl+L`/`Cmd+K` = redraw. — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

**Architecture du code (dump v2.1.88)**
- Stack : Bun runtime, React + « Ink » interne, Zod v4 ; « a custom React reconciler … a pure TypeScript Yoga layout port (~2700 lignes), a complete ANSI/CSI/DEC/ESC/OSC parser stack » ; composants compilés avec React Compiler ; dead-code elimination via `bun:bundle` `feature()` ; système de keybindings avec chords. — [dev.to minnzen](https://dev.to/minnzen/i-studied-claude-codes-leaked-source-and-built-a-terminal-ui-toolkit-from-it-4poh), [claudefa.st](https://claudefa.st/blog/guide/mechanics/claude-code-source-leak), [Pilot Shell](https://pilot-shell.com/blog/claude-code-source-leak)
- `src/ink/` : `ink.tsx`, `reconciler.ts`, `renderer.ts`, `screen.ts`, `terminal.ts`, `output.ts`, `render-to-screen.ts`, `render-node-to-output.ts`, `render-border.ts`, `dom.ts`, `layout/`, `termio/`, `events/`, `hooks/`, `components/` (Box, Text, Static…), `Ansi.tsx`, `colorize.ts`, `styles.ts`, `wrapAnsi.ts`, `wrap-text.ts`, `stringWidth.ts`, `widest-line.ts`, `measure-text.ts`, `measure-element.ts`, `selection.ts`, `focus.ts`, `parse-keypress.ts`, `frame.ts`, `bidi.ts`. — [Njengah leak: src/ink](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/ink)
- `src/components/` : `App.tsx`, `FullscreenLayout.tsx`, `Messages.tsx`, `MessageRow.tsx`, `Message.tsx`, `MessageResponse.tsx`, `Markdown.tsx`, `PromptInput/`, `Spinner/`, `StructuredDiff/`, `HighlightedCode/`, `FileEditToolDiff.tsx`, `FilePathLink.tsx`, `ContextVisualization.tsx`, `ContextSuggestions.tsx`, `CostThresholdDialog.tsx`, `ExportDialog.tsx`, `HistorySearchDialog.tsx`, `GlobalSearchDialog.tsx`, `ModelPicker.tsx`, `DevBar.tsx`, `LogoV2/`, `CustomSelect/`, `design-system/`, `ui/`, `permissions/`, `messages/`, `diff/`, `tasks/`, `agents/`, `teams/`, `sandbox/`, `shell/`, `mcp/`, `memory/`, `skills/`, `hooks/`, `wizard/`, `Settings/`, `HelpV2/`. — [Njengah leak: src/components](https://github.com/Njengah/claude-code-source-code-leak/tree/main/src/components)
- Le dump révèle aussi un « Buddy companion » (sprite ASCII 5 lignes × 12 colonnes animé), un « Brief mode », KAIROS, Undercover Mode. — [kcc0/claude-code-cli-leak](https://github.com/kcc0/claude-code-cli-leak)

**Largeur, wrapping, terminaux, symboles**
- Hard-wrap à la largeur de fenêtre avec continuation alignée sous `⏺` (voir Q1). Diff panel exige ≥110 colonnes (auto ≥144). Bouton « Jump to bottom » raccourci sur terminal étroit. Rendu adapté aux terminaux : kitty keyboard protocol (Shift+Enter, Ctrl+Shift) v2.1.269 ; réponses de capability queries `^[[?1;2c` filtrées (v2.1.269/275/277) ; rxvt/st/Konsole/urxvt correctifs ; Windows repaint après suppression de caractères invisibles (v2.1.280). — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode), [Docs Fullscreen](https://code.claude.com/docs/en/fullscreen), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Symboles attestés : `⏺` (assistant, U+23FA ; `●` ailleurs), `⎿` (résultat d'outil), `▎` (blockquote), `❯` (curseur de sélection/prompt), `· ✢ ✳ ✶ ✻ ✽` (spinner), `⏸` / `⏵⏵` (indicateurs de mode), `☐ ☑ ⬜` (todos historiques), `✕` (fermeture du diff panel), `⤡`/`⛶` (bouton plein écran de la doc, pas du CLI), `▓` (barres de status line d'exemple), `(+N)` (descendants de sous-agents), chips `[Image #N]`. — [Trevor Fox](https://trevorfox.com/2026/07/clean-up-claude-code-copy-paste/), [Docs Permission modes](https://code.claude.com/docs/en/permission-modes), [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode), [Docs Sub-agents](https://code.claude.com/docs/en/sub-agents), [Issue #6891](https://github.com/anthropics/claude-code/issues/6891)
- Thème : `/config theme=dark`, `/theme` picker (avec `Ctrl+T` pour la coloration) ; crash corrigé sur `theme` mal formé dans `~/.claude.json` (v2.1.277) ; crash sur codes couleur dans le prompt (v2.1.277). — [Docs Commands](https://code.claude.com/docs/en/commands), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

### Inferences
- Le renderer « classique » 2026 n'est plus l'Ink upstream : c'est le renderer différentiel maison écrivant dans le scrollback natif (les messages terminés sont figés en haut, la zone dynamique — spinner, texte en cours, panneau sous-agents, prompt, footer — est repeinte par diff de cellules). Le fullscreen est la même pile avec écran alternatif + viewport virtualisé.
- Pour Fuller sur Ink upstream : activer `incrementalRendering`, garder les messages terminés dans `<Static>`, limiter la hauteur de la zone dynamique (repli des sorties à N lignes est aussi une stratégie anti-flicker), et proposer optionnellement `alternateScreen` avec scroll interne ; probing de la « synchronized output » (DEC 2026) si le terminal la supporte.
- Le support 24-bit et les thèmes clair/sombre existent (constantes `diffAdded/…Dimmed`, `/theme`), mais aucune source publique ne précise la palette.

### Gaps
- Contenu détaillé du thread Boris Cherny (mécanique exacte, date) : seul le titre (« ~85 % ») était accessible ; les détails viennent de reprises tierces et du fil HN.
- Confirmation que le renderer classique utilise encore un équivalent de `<Static>` : non trouvée ; `src/ink/components/` contient un `Static` d'après la liste, sans détail sur son usage.
- Palette de couleurs, gestion 24-bit vs 256 couleurs, et usage éventuel de Nerd Fonts : non documentés (les glyphes attestés sont tous Unicode standard, aucun glyphe Nerd Font n'a été observé dans les sources).
- `package.json` du dump (dépendances exactes : chalk, string-width, diff, etc.) : inaccessible (404) dans cette recherche.
