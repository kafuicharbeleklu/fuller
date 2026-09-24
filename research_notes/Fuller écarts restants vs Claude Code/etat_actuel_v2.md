# État actuel de Fuller (v2) — inventaire technique post-refonte

> Audit statique exhaustif de `/home/administrator/Desktop/gemini-code` à la date du 2026‑09‑23, après la refonte P0/P1 (commit `a4aba45`) et les ajouts ultérieurs (commandes/skills, todos/status line, hooks, bash avancé/plan mode, MCP, sous‑agents, images — jusqu'à `8c2f2d6`). Lecture intégrale de `README.md` et de tous les fichiers trackés sous `src/` (~9 100 lignes, 59 fichiers). `tests/resize.test.tsx` (untracked) et `scratch/` ont été ignorés comme demandé. Deux fichiers trackés ont des modifications non commitées à l'heure de l'audit : `src/index.tsx` (+4/-2, un flag `--all` + wiring) et `src/ui/frameWriter.ts` (+2/-1) — le contenu lu et cité ci-dessous est celui du disque (état courant), diffs mineurs. Aucun fichier n'a été modifié par cet audit. Les références sont `fichier:ligne`.
>
> Le premier audit (22/09, avant refonte) est à `research_notes/Fuller TUI écarts avec Claude Code/etat_actuel_codebase.md` (3 174 lignes, 25 fichiers) ; sa structure de checklist a été réutilisée mais tout a été revérifié ligne à ligne dans le code actuel.

---

## 0. Vue d'ensemble

- **Volume** : 59 fichiers, ~9 100 lignes sous `src/`. Plus gros fichiers : `src/agent/loop.ts` (985 l.), `src/tools/registry.ts` (433 l.), `src/ui/InputBox.tsx` (571 l.), `src/ui/commands.ts` (495 l.), `src/index.tsx` (176 l.), `src/agent/gemini.ts` (295 l.), `src/permissions/bashParser.ts` (428 l.), `src/mcp/manager.ts` (165 l.).
- **Stack** (`package.json`) : `@google/genai` ^2.24.0, `@modelcontextprotocol/sdk` ^1.30.0, `cli-highlight`, `commander`, `diff`, `dotenv`, `fast-glob`, `ignore`, `ink` ^5.1.2, `ink-spinner`, `marked` ^18, `react` 18.3, `string-width`. Dev : `vitest`, `ink-testing-library`, `tsx`, `typescript`, `zod` (déclaré en devDependency mais non trouvé importé dans `src/` — à vérifier, résidu probable). Node ≥ 20 (`package.json:37`).
- **Architecture** : une classe `AgentLoop` (`src/agent/loop.ts`) pilote toute la logique métier (tours, outils, permissions, hooks, MCP, sous-agents, plan mode, compaction) via des callbacks (`AgentCallbacks`, `loop.ts:74-87`) consommés par le composant React `App` (`src/ui/App.tsx`). `GeminiAgentSession` (`src/agent/gemini.ts`) encapsule le SDK `@google/genai` (chat, streaming, retry, compaction, historique). Le rendu terminal passe par un `FrameWriter` custom (`src/ui/frameWriter.ts`) qui intercepte `stdout.write` pour corriger l'effacement d'Ink lors des redimensionnements.
- `tsc --noEmit` et `vitest` sont scriptés (`npm run typecheck`, `npm test`) ; **aucune CI** trouvée (pas de `.github/workflows`, pas de `.gitlab-ci.yml`) — voir §7.
- Nom du produit : « Fuller », `CONFIG_DIR_NAME = '.fuller'`, fichier mémoire `FULLER.md` (`src/branding.ts:9-13`), version `0.3.0`.

---

## 1. Rendu

### 1.1 Split Static/dynamic (scrollback vs zone vivante)

`App.tsx:315-317` : le transcript figé est rendu dans `<Static key={generation} items={items}>` (Ink), qui écrit chaque item une fois pour toutes dans le scrollback natif du terminal et ne le retouche plus. La zone dynamique (au-dessous) contient, dans l'ordre : `LiveArea` (texte en cours de streaming + outils en cours, `App.tsx:319`), la ligne de spinner (`App.tsx:320-324`), les notices (`App.tsx:325-329`), le panneau todo (`App.tsx:330-332`), le prompt de permission (`App.tsx:333`), les sélecteurs modaux (`ModelPicker`/`RewindMenu`, `App.tsx:334-362`), et enfin `InputBox` + `Footer` (`App.tsx:363-398`), masqués (`display: 'none'`) quand une modale est ouverte.
Un `generation` (state, `App.tsx:49`) est incrémenté pour forcer Ink à re-mount et redessiner tout le `<Static>` (utilisé par `/clear`, Ctrl+L, Ctrl+O) — cf. `redraw()` `App.tsx:144-147`.

### 1.2 `frameWriter.ts` : effacement physique, repaint

Le README documente 3 bugs de VTE ; le code les corrige ainsi :
- **Effacement** : Ink efface avec `ESC[2K` (EL2) répété N fois (N = nombre de lignes *logiques*). `frameWriter.ts` remplace cette séquence par `ESC[G` + `ESC[K` (EL0 depuis colonne 1) répétée pour le nombre de lignes **physiques** actuelles (`eraseLines()`, `frameWriter.ts:31-36`), calculé par `physicalRows()` (`frameWriter.ts:44-49`, `Math.ceil(stringWidth(line)/columns)` sommé, ou `lines.length` si `reflow=false`).
- **Détection de la regex d'effacement Ink** : `ERASE_RE = /^(?:\x1b\[2K(?:\x1b\[1A)?)+\x1b\[G/` (`frameWriter.ts:28`).
- **`transformChunk()`** (`frameWriter.ts:59-102`, pur, testé) gère : chunk vide → attend du static (`expectStatic`) ; detection de `ESC[2J` (clear écran, laissé tel quel) ; détection de sortie « static » (scrollback, jamais effacée) ; sinon, remplace le préfixe d'effacement et mémorise `lastFrame` (le cadre courant, sans le `\n` final d'Ink, pour garder le curseur sur la dernière ligne du cadre — `frameWriter.ts:100-101`).
- **Sortie synchronisée** : chaque écriture est enveloppée `\x1b[?2026h${out}\x1b[?2026l` (DEC 2026, `frameWriter.ts:172,174`) sauf si `syncOutput:false`.
- **Redimensionnement** : débounce 120 ms dans `App.tsx:154-167` (`setTimeout(..., 120)`), pas de re-render à chaque event ; `index.tsx:144` supprime les listeners `resize` natifs d'Ink pour éviter la course avec le débounce.
- **`FULLER_NO_REFLOW`** documenté dans le README mais le nom de variable réel dans le code est `FULLER_REFLOW=1` pour **activer** le reflow (`index.tsx:121`, `reflow: process.env.FULLER_REFLOW === '1'`) — donc reflow **désactivé par défaut**, contrairement à ce que suggère le README (qui parle de désactiver via `FULLER_NO_REFLOW`). C'est une incohérence doc/code à signaler (§8).
- **`repaint()`** (`frameWriter.ts:179-186`) : recompose l'écran visible ligne par ligne avec `composeRepaint()` (`frameWriter.ts:112-138`) — jamais `ESC[2J` (qui pousserait l'écran dans l'historique sous VTE/tmux), mais un positionnement absolu `ESC[r;1H ESC[K` par ligne (`frameWriter.ts:129`), en prenant la fin du transcript (`tail`) qui rentre au-dessus du cadre courant.
- **`needsRepaint()`** (`frameWriter.ts:178`) renvoie `lastEraseWrapped`, vrai si le dernier effacement a dû couvrir plus de lignes physiques que logiques (cadre qui avait replié) — c'est le signal qui déclenche un `repaint()` (consommé côté `App.tsx`/`index.tsx`, la logique de déclenchement précise n'est pas dans `frameWriter.ts` lui-même mais bien pilotée à l'extérieur par le state `resizeTick`).
- Debug : `FULLER_DEBUG_FRAMES` (fichier de log, `frameWriter.ts:5-8,164-169`).

### 1.3 Marge de mise en page

`index.tsx:127-134` : un `Proxy` sur `stdout` retranche 1 colonne (`LAYOUT_MARGIN=1`) à `stdout.columns` vu par Ink, pour qu'aucune ligne ne finisse jamais dans la dernière colonne (état de « pending wrap » qui perturbe le reflow de certains terminaux).

### 1.4 Spinner

`Spinner.tsx:8-16` (`useSpinnerFrame`) : anime `SPINNER_FRAMES = ['·','✢','✳','✶','✻','✽','✻','✶','✳','✢']` (`branding.ts:49`) toutes les 120 ms (`intervalMs` par défaut). `SpinnerLine` (`Spinner.tsx:26-58`) choisit un verbe aléatoire dans `SPINNER_VERBS` (18 verbes façon Claude Code : Pondering, Thinking, Musing… `branding.ts:43-47`), change de verbe toutes les 4 s, bascule sur « Deep in thought » après 45 s, affiche `esc to interrupt · Ns · ↓ X tokens`. États `compacting`/`running_tool` ont leur propre libellé fixe (`Spinner.tsx:44-45`).

### 1.5 Transcript — items `⏺` / `⎿`

`Transcript.tsx` (`TranscriptItemView`, mémoïsé `React.memo`) rend par `item.kind` :
- `banner` → `<Banner/>`.
- `user` : préfixe `❯ ` sur la 1ʳᵉ ligne (`Transcript.tsx:37`), gras sauf pour `kind==='command'` ; rendu spécial pour `kind==='bash'` (préfixe `! `, couleur `bashBorder`, `Transcript.tsx:24-30`) ; pièces jointes images affichées `🖼 [Image #n] nom · X KB` (`Transcript.tsx:41-45`).
- `text` (réponse assistant) : glyphe `⏺` (`BULLET`, `glyphs.ts:12`) + Markdown (`Transcript.tsx:50-58`).
- `tool` → délègue à `ToolRow` (`Transcript.tsx:60-65`).
- `system` : cas `compact` (résumé, 8 lignes visibles hors verbose + « … +N lines (ctrl+o to expand) », `Transcript.tsx:69-80`), cas `notice` (glyphe `⎿`, couleur erreur si commence par `✗`, `Transcript.tsx:82-89`), cas générique (glyphe `⏺` gris + Markdown, `Transcript.tsx:90-97`).
- `turn_end` : ligne `✻ Worked for Xs · N tool uses`, **masquée si <3s et 0 outil** (`Transcript.tsx:101`) — évite le bruit sur les réponses courtes.

### 1.6 `ToolRow.tsx` — détail collapsed/verbose par outil

Constantes : `COLLAPSED_LINES=4`, `VERBOSE_LINES=400` (`ToolRow.tsx:18-19`). Icône = spinner frame si `running`/`confirming`, `·` si `pending`, `⏺` sinon, coloré par statut (`ToolRow.tsx:32-39`). Corps (`renderBody()`, `ToolRow.tsx:77-131`) :
- `pending` → rien ; `confirming` → « Waiting for permission… » ; `running` → 4 dernières lignes de sortie live (`toolCall.result`) + « Running… Ns » (>2s) ; `rejected` → message ; `failed` → jusqu'à 400 (verbose) ou 4 lignes de l'erreur.
- **`todo_write`** : liste avec glyphes ☑/◐/☐, 8 items max hors verbose, `… +N more (ctrl+o to expand)`.
- **`edit_file`/`write_file`** : `summary` + `DiffView` (30 lignes collapsed / 2000 verbose).
- **`read_file`** : collapsed = juste le résumé (« Read N lines ») ; verbose = résumé + 60 lignes de contenu — **le contenu réel n'est jamais visible en mode collapsed**, contrairement à Claude Code qui affiche un extrait.
- **`search_files`/`glob`/`list_directory`** : collapsed = résumé + 3 lignes ; verbose = 400 lignes.
- **`web_fetch`** : 3 lignes collapsed / 200 verbose.
- **`exit_plan_mode`, `agent`, `mcp__*`** : pas de cas spécial → branche `default` (`toolCall.result || toolCall.summary`, `max` lignes) ; le plan complet est en fait injecté séparément dans le transcript par `loop.ts:795` (item `text` distinct « **Plan** … »), pas via `ToolRow`.

### 1.7 `Markdown.tsx` (via `marked` + `cli-highlight`)

Capacités : titres (h1-h6, gras+souligné pour h1, couleur accent pour h1/h2), paragraphes, gras/italique/barré, code inline (couleur `theme.code`), liens (`texte (href)` si texte≠href, souligné), images (`[image: alt]`, pas de rendu réel — normal en TUI), citations `>` (barre `▎`), listes ordonnées/non-ordonnées imbriquées (puces `•`/`◦` alternées par profondeur, listes ordonnées `a./b./…` niveau 1 puis `1./2./…`), cases à cocher `☑/☐` (task lists GFM), tableaux (largeur de colonne calculée dynamiquement selon la largeur du terminal, `renderTable`, `Markdown.tsx:83-103`), règles horizontales, coloration syntaxique via `cli-highlight` (cache `Map`, `Markdown.tsx:15-31`), décodage d'entités HTML custom (`Markdown.tsx:8-13`). **Non supporté** : rendu réel d'images, notes de bas de page, HTML embarqué avancé (rendu tel quel comme texte brut, `Markdown.tsx:174-176`), pas de rendu LaTeX/math, pas de liens cliquables OSC 8 (juste `(href)` en texte).

### 1.8 `DiffView.tsx`

Parse un diff unifié (`parseUnifiedDiff`, gère `+++`/`---`/`@@ -a,b +c,d @@`) en hunks de lignes `add`/`del`/`ctx`. Rendu : numéro de ligne aligné à droite (ancien pour `del`, nouveau pour `add`), signe `+`/`-`/` `, couleur + fond (`diffAddedBg`/`diffRemovedBg`, seulement en truecolor) pour add/del, tabulations remplacées par 2 espaces, séparateur `···` entre hunks non contigus, troncature à `maxLines` (30 collapsed / 2000 verbose) avec `… +N lines (ctrl+o to expand in the transcript)`.

### 1.9 Thèmes (`theme.tsx`)

9 thèmes : `dark`, `light`, `dark-daltonized`, `light-daltonized`, `dark-ansi`, `light-ansi`, `monokai`, `ocean`, `forest`, plus `auto` (détection `COLORFGBG`, `detectBackground()`, `theme.tsx:142-150` — pas de round-trip OSC, best-effort). Détection truecolor via `COLORTERM`/`TERM_PROGRAM`/`WT_SESSION` (`theme.tsx:32`). Tokens : `text, subtle, accent, secondary, success, warning, error, permission, promptBorder, bashBorder, planMode, autoAccept, bypass, diffAdded/Removed(+Bg), user, tool, code, link` (17 tokens, `theme.tsx:7-30`). Persisté dans `~/.fuller/theme.json` avec `overrides` arbitraires (`theme.tsx:157-172`) — un thème custom complet n'est pas exposé en CLI/slash mais peut être injecté à la main dans ce fichier JSON.

### 1.10 Glyphes (`glyphs.ts`)

`BULLET='⏺'`, `RESULT='⎿'`, `PLAY='⏵⏵'`, `PAUSE='⏸'` avec calcul de `gap()` selon `stringWidth` pour compenser les glyphes « larges » à 1 colonne réelle. **Aucun fallback ASCII** : pas de détection d'un terminal non-Unicode, les glyphes sont utilisés inconditionnellement (risque d'affichage cassé sur un terminal strictement ASCII/legacy — non testé dans le code).

### 1.11 Banner / Footer / TodoPanel / status line

- **`Banner.tsx`** : cadre arrondi, `✻ Welcome to Fuller vX.Y.Z`, ligne `model · dir · branche(*)`, ligne d'aide statique, `↺ Resumed session` et `※ Tip: …` (un tip aléatoire parmi 8, `branding.ts:51-60`, **en français** alors que le reste de l'UI est en anglais — incohérence).
- **`Footer.tsx`** : partie gauche = mode courant (`! bash mode`, `⏵⏵ accept edits on`, `⏸ plan mode on`, `⏵⏵ bypass permissions on`, ou aide contextuelle `esc to interrupt`/`? for shortcuts`/`enter to send · \⏎ for newline`) ; partie droite = tâches en arrière-plan, `Context left until auto-compact: X%` (coloré warning si <20%), modèle. Si `statusLine` custom configurée, remplace la partie droite par jusqu'à 3 lignes de la sortie du script (`Footer.tsx:36-44`).
- **`TodoPanel.tsx`** : affiché tant qu'il reste des todos non complétés, fenêtre glissante autour de l'item `in_progress` (`maxItems` = 3 à 6 selon la hauteur du terminal), compteur `done/total`, `(ctrl+t to hide)`.
- **`useStatusLine.ts`** : construit un JSON compatible Claude Code (`buildStatusJson`, mêmes clés : `model.id`, `workspace.current_dir`, `cost.total_tokens`, `context_window.used_percentage`, `permission_mode`… — `useStatusLine.ts:19-47`), l'envoie sur stdin du script configuré (`runStatusCommand`, timeout 5s, `useStatusLine.ts:49-66`), avec debounce 300 ms et `refreshInterval` optionnel en secondes.

### 1.12 Non implémenté (constaté en lisant le code)

Aucune trace de : mode plein écran / écran alternatif (`ESC[?1049h`) — le README le confirme explicitement comme du P3 non fait ; souris (aucun listener `mousedown`/séquences SGR mouse dans `useRawInput.ts`) ; liens cliquables OSC 8 (`\x1b]8;;url\x1b\``) ; mode transcript « less-like » paginé (Ctrl+O bascule juste un booléen `verbose` global, pas un pager) ; mode lecteur d'écran/accessibilité.

---

## 2. Saisie (`InputBox.tsx` + `useRawInput.ts`)

### 2.1 Parsing bas niveau (`useRawInput.ts`)

`parseKeys()` (`useRawInput.ts:36-122`) décode manuellement les séquences CSI (`ESC[…`), le "Kitty keyboard protocol" partiel (final `u` avec code Unicode + modificateurs, `useRawInput.ts:59-66`), les vieilles séquences `ESC[27;mod;code~`, les touches nommées (`CSI_NAMES`, flèches/home/end/delete/pageup/pagedown/tab), SS3 (`ESC O A`…), Alt+touche (`ESC` suivi d'un caractère), Ctrl+lettre (codes <32), et le bracketed paste (`\x1b[200~…\x1b[201~`, y compris à cheval sur plusieurs chunks stdin, `useRawInput.ts:145-166`). Debug via `FULLER_DEBUG_KEYS`.

### 2.2 Table des raccourcis (`InputBox.tsx`, gérés dans `handle()`)

| Touche | Contexte | Effet | Fichier:ligne |
|---|---|---|---|
| Ctrl+A / Ctrl+E | édition | début / fin de ligne courante (multi-ligne aware) | `InputBox.tsx:387-388` |
| Ctrl+B / Ctrl+F | édition | curseur -1/+1 code point | `InputBox.tsx:389-390` |
| Alt+B / Alt+F | édition | saut de mot gauche/droite | `InputBox.tsx:453-454` |
| Ctrl+K | édition | kill jusqu'à fin de ligne (ou fusionne avec la ligne suivante si déjà en fin) | `InputBox.tsx:391`, `killToEnd` `176-183` |
| Ctrl+U | édition | kill jusqu'à début de ligne | `InputBox.tsx:392`, `killToStart` `184-191` |
| Ctrl+W / Ctrl+H | édition | supprime le mot précédent (Ctrl+H = backspace simple) | `InputBox.tsx:393` |
| Ctrl+Y | édition | yank (colle le kill-ring) | `InputBox.tsx:394` |
| Ctrl+_ / Ctrl+Z | édition | undo (pile de snapshots, throttle 600 ms pendant la frappe) | `InputBox.tsx:386`, `undo()` `193-196` |
| Ctrl+J | édition | insère une nouvelle ligne | `InputBox.tsx:395` |
| Alt+D | édition | supprime le mot suivant | `InputBox.tsx:455` |
| Ctrl+O | UI | bascule transcript verbeux + redessine l'écran | `InputBox.tsx:379` |
| Ctrl+T | UI | affiche/masque le panneau todo | `InputBox.tsx:380` |
| Ctrl+V (Alt+V Windows) | UI | colle une image du presse-papiers | `InputBox.tsx:381,452` |
| Ctrl+L | UI | redessine l'écran (`clearScreen`) | `InputBox.tsx:382` |
| Ctrl+R | UI | ouvre la recherche incrémentale dans l'historique | `InputBox.tsx:383-384` |
| Ctrl+C (texte présent) | édition | vide la saisie | `InputBox.tsx:368` |
| Ctrl+C (busy) | contrôle | interrompt le tour en cours | `InputBox.tsx:367` |
| Ctrl+C ×2 (<1.5s, vide, idle) | contrôle | quitte l'app | `InputBox.tsx:370-373` |
| Ctrl+D (vide, idle) | contrôle | quitte l'app | `InputBox.tsx:376` |
| Ctrl+D (texte présent) | édition | delete-forward | `InputBox.tsx:377` |
| Shift+Tab | mode | cycle les modes de permission | `InputBox.tsx:411` |
| Tab | menu | complète la sélection du menu `/` ou `@` sans soumettre | `InputBox.tsx:412` |
| Entrée | soumission | soumet (sauf `\`+Entrée → nouvelle ligne, ou menu ouvert → complète+exécute) | `InputBox.tsx:414-422` |
| Alt/Ctrl/Shift+Entrée | édition | insère une nouvelle ligne (fallback si le terminal ne supporte pas Kitty) | `InputBox.tsx:415` |
| ↑ / ↓ (menu ouvert) | menu | navigue dans la liste `/` ou `@` | `InputBox.tsx:424,430` |
| ↑ (saisie vide, queue non vide) | queue | rappelle le dernier prompt en attente | `InputBox.tsx:425` |
| ↑ / ↓ | multi-ligne / historique | change de ligne si multi-ligne, sinon navigue l'historique des prompts | `InputBox.tsx:426-433` |
| ←/→ (+Ctrl/Alt) | édition | curseur ±1 code point / ±1 mot | `InputBox.tsx:434-441` |
| Home/End (+Ctrl) | édition | début/fin de ligne, ou tout le texte si Ctrl | `InputBox.tsx:442-443` |
| Backspace (+Alt/Ctrl) | édition | backspace simple ou suppression de mot ; supprime aussi un `[Pasted text #N]`/`[Image #N]` entier d'un coup | `InputBox.tsx:130-141,444-448` |
| Delete | édition | delete-forward | `InputBox.tsx:449` |
| `!` (saisie vide) | mode | entre en mode bash | `InputBox.tsx:458-462` |
| `?` (saisie vide) | UI | bascule le panneau d'aide clavier | `InputBox.tsx:463` |
| Esc | contrôle | ferme le menu, ou interrompt si busy, ou quitte bash mode si vide, ou (double-Esc <600ms) vide la saisie / ouvre rewind | `InputBox.tsx:401-409` |
| Ctrl+R puis Ctrl+R | recherche | passe au résultat suivant | `InputBox.tsx:339-345` |

### 2.3 Paste folding

`insertPaste()` (`InputBox.tsx:216-226`) : normalise `\r\n`→`\n`, si >3 lignes **ou** >800 caractères, remplace par `[Pasted text #N +L lines]` et garde le texte réel dans `pastes.current` (Map). `expandPastes()` (`InputBox.tsx:214`) le réinjecte à la soumission. Un backspace juste après le marqueur supprime le bloc entier (`InputBox.tsx:135-136`).

### 2.4 Images (Ctrl+V)

`imageClipboard.ts` : macOS → `osascript` écrit un PNG via AppleScript (`readClipboardImage`, l. 53-60) ; Windows → PowerShell + `System.Windows.Forms.Clipboard` (l. 61-67) ; Linux → tente `wl-paste --type image/png`, puis `xclip -t image/png`, puis `xsel` (l. 68-76), valide la signature PNG (`PNG_MAGIC`). Limite **7 Mo** (`MAX_IMAGE_BYTES = 7*1024*1024`, l. 20) — conforme au README. Cache dans `~/.fuller/paste-cache/`.

### 2.5 Complétion `@fichier`

`InputBox.tsx:89-102` détecte un token `@…` avant le curseur (regex `(?:^|\s)(@[^\s@]*)$`), charge l'index via `fileIndex.ts:getFileIndex()` (cache 30 s, `fast-glob` avec exclusions `node_modules/.git/dist/build/.next/coverage`, respecte aussi `.gitignore` via `ignore`, plafond 8000 fichiers, profondeur 8). `fuzzyFilter()` (`fileIndex.ts:34-53`) : score = substring sur le basename (1000) > substring sur le chemin complet (800/600) > sous-séquence ordonnée (300) — pas de vrai fuzzy scoring type fzf (pas de bonus de proximité/consécutivité). Limite 8 résultats par défaut.

### 2.6 Menu `/`

`InputBox.tsx:84-87` : actif si le texte commence par `/` et ne contient pas d'espace ; filtre par préfixe ou sous-chaîne après le premier caractère. La liste vient de `menuCommands` (`App.tsx:247-256`) = `COMMANDS` statiques + skills `userInvocable` découverts.

### 2.7 Mode bash `!`

Détecté si saisie vide et premier caractère tapé = `!` (`InputBox.tsx:458-462`), bordure et glyphe dédiés (`bashBorder`), quitte au Backspace sur saisie vide ou Esc.

### 2.8 Historique et Ctrl+R

`session/history.ts` : `~/.fuller/history.jsonl` (JSONL, `{ts, cwd, text}`), 1000 entrées max, dédoublonnage des doublons consécutifs, filtré par `cwd` du projet courant (repli sur tout l'historique si vide). Ctrl+R = recherche **incrémentale par sous-chaîne** (pas fuzzy), insensible à la casse, cycle sur les occurrences avec Ctrl+R répété (`InputBox.tsx:325-330,339-345`) — équivalent à un `reverse-i-search` bash simplifié.

### 2.9 Queue pendant un tour

Les prompts soumis pendant que `busy=true` sont poussés dans `queue` (`loop.ts:406-410`) et affichés au-dessus de l'input (4 premiers + `… +N queued`, `InputBox.tsx:503-510`) ; `↑` sur saisie vide les rappelle un par un dans l'éditeur (`onPopQueue`) plutôt que de les soumettre directement — Claude Code envoie automatiquement toute la queue à la fin du tour, ici le prochain élément de queue est traité automatiquement par `processQueue()` (`loop.ts:414-419,614`) mais l'UI permet aussi de le rappeler manuellement.

### 2.10 Panneau d'aide

`InputBox.tsx:559-568` (`showHelp`, bascule sur `?`) : 5 lignes récapitulant tous les raccourcis (shift+tab, esc, ctrl+o, !/@//, \⏎/ctrl+j, ↑↓, ctrl+r, ctrl+c, ctrl+l, ctrl+_, ctrl+a/e, ctrl+u/k, ctrl+w/y, ctrl+t, ctrl+v).

### 2.11 Undo

Portée = uniquement l'éditeur de saisie courant (texte + curseur), pile de 100 snapshots max, throttle 600 ms pour grouper les frappes rapides en un seul snapshot (`InputBox.tsx:109-115`). Pas d'undo au niveau fichier (c'est le rôle des checkpoints, §4.8) ni de redo.

### 2.12 Select / ModelPicker / SessionPicker / PermissionPrompt / RewindMenu

- **`Select.tsx`** (composant générique réutilisé par ModelPicker/RewindMenu) : ↑/↓ ou j/k (vim-like, seulement dans ce composant), Entrée, Esc/Ctrl+C annule, touches numériques 1-9 sélectionnent directement si `numbered`.
- **`ModelPicker.tsx`** : touche `a` bascule « recommandés » ↔ « tous les modèles », liste chargée depuis l'API (`listChatModels`).
- **`SessionPicker.tsx`** : recherche par frappe libre (filtre titre/id/branche), ↑/↓, Entrée, Esc annule.
- **`PermissionPrompt.tsx`** : ↑/↓ ou j/k, Entrée, chiffres 1-9, `y`/`Y` = première option, `n`/`N` = ouvre le mode feedback texte libre, Shift+Tab = raccourci direct vers l'option `switchMode` (accept edits), Ctrl+C/Esc = refuse.
- **`RewindMenu.tsx`** : liste des 15 derniers checkpoints via `Select`.

### 2.13 Explicitement absent (vérifié dans le code)

- **Mode vim** (normal/insert) : aucune trace, tout le binding est de type Emacs/readline.
- **`keybindings.json` personnalisable** : les bindings sont câblés en dur dans `InputBox.tsx` ; rien ne lit un fichier de config clavier.
- **Souris** : aucun listener de séquences SGR mouse dans `useRawInput.ts`.
- **Ctrl+G / éditeur externe** : non géré (Claude Code ouvre `$EDITOR`).
- **Shift+Entrée sans Kitty protocol** : géré en fallback générique (`e.shift` insère une nouvelle ligne, `InputBox.tsx:415`) — mais sans négociation Kitty explicite (pas de requête `CSI ? u`), donc dépend de ce que le terminal envoie nativement.
- **IME / caractères composés** : aucun traitement spécifique (dead keys, composition Unicode multi-étapes) — les caractères arrivent tels quels via stdin, pas de state machine de composition.
- **Sélection de texte avec Shift+flèches** : non gérée (pas de notion de sélection/marque dans `EditorState`).

---

## 3. Permissions

### 3.1 Syntaxe des règles

`permissions/rules.ts` : format `Tool(spec)` (regex `parseRule`, `rules.ts:29-33`). `TOOL_DISPLAY` mappe les noms internes (`execute_bash`→`Bash`, `edit_file`→`Edit`, etc., `rules.ts:12-27`). `ruleMatches()` (`rules.ts:59-91`) :
- `mcp__serveur` sans spec couvre tout le serveur (préfixe `mcp__serveur__`).
- Bash : `spec` se terminant par `:*` = préfixe (`cmd === prefix || cmd.startsWith(prefix+' ')`), sinon égalité exacte de la commande complète.
- WebFetch : `domain:xxx` compare le hostname (avec sous-domaines), sinon égalité stricte de l'URL.
- Fichiers : glob traduit en RegExp maison (`globToRegExp`, `rules.ts:35-49`, supporte `**`, `*`, `?`), testé contre le chemin relatif au cwd (avec et sans préfixe `./`).
Stockage : `.fuller/settings.local.json` par défaut pour les règles ajoutées via l'UI (`addPermissionRule`, `config.ts:129-145`, scope `local` par défaut — non commité par convention `.gitignore`), mais `/permissions add|deny` écrit aussi dans ce même fichier local. Précédence : **deny toujours prioritaire** sur allow (`rules.ts:158-159`), fusion multi-sources (user < project < local, `config.ts:93-122`) par simple concaténation des tableaux `allow`/`deny`.

### 3.2 Classifieur bash (`bashParser.ts`)

4 niveaux de risque (`RiskLevel`) : `read < edit < exec < danger` (`bashParser.ts:5`). `splitCommand()` sépare sur `&&`, `||`, `;`, `|`, `&`, `\n`, en respectant guillemets simples/doubles et échappements, et extrait les substitutions `$(...)`/`` `...` `` comme segments marqués `subshell` (préfixe `\u0000`). `parseSegment()` tokenize, extrait les redirections (`>`,`>>`,`<`,`<<<`, `>|`, avec cible fd `&N`), et détecte les « wrappers » strippés (`timeout`, `nice`, `ionice`, `nohup`, `command`, `builtin`, `time`, `env`, `exec`, `xargs`, `stdbuf`, `unbuffer` — **`sudo` n'est volontairement PAS strippé**, `bashParser.ts:23-24`, classé direct en `danger`).
`classifySegment()` a des règles spécifiques pour : `rm` (racine/hors-projet/récursif → danger ou exec), `git` (push --force, reset --hard, clean -f, branch -D, checkout/restore écrasant → danger ; sous-commandes en lecture `status/diff/log/show/…` listées `GIT_READ` → read), `find -exec/-delete`, `sed/perl -i`, `awk` avec effet de bord (`system(`, redirections shell), `chmod/chown -R` ou `777` → danger, `kill -1`/`-9 -1` → danger, shells (`sh/bash/zsh/…`) exécutant du contenu réseau (pipeline `curl|bash` → danger via `pipelineToShell`), `curl/wget` (accès réseau = exec, danger si pipé dans un shell), programmes d'édition (`mkdir/touch/cp/mv/…`) selon confinement, commandes en lecture pure (grande liste `READ_ONLY`, avec cas particuliers `echo`/`cat`/`tee` qui deviennent `edit`/`exec` selon la redirection). Détection de fork bomb par regex (`bashParser.ts:402`). `suggestPrefix()` propose une règle « don't ask again » à granularité `programme sous-commande:*` pour les outils connus (`npm test`, `git status`, …).

### 3.3 Options de prompt par outil (`buildOptions`, `rules.ts:185-224`)

- `edit_file`/`write_file` : Yes / « Yes, allow all edits during this session (shift+tab) » (bascule le mode en `acceptEdits`) / No+feedback.
- `execute_bash` : Yes / « don't ask again for `<prefix>` commands in `<projet>` » (règle `Bash(prefix:*)`) / No.
- `web_fetch` : Yes / « don't ask again for `<host>` » (règle `WebFetch(domain:host)`) / No.
- Défaut (MCP, todo, etc.) : Yes / « don't ask again for `<Display>` [(MCP serveur)] » / No.
Toujours 3 options ; l'option « No » ouvre un champ de feedback texte libre transmis au modèle (`PermissionPrompt.tsx:33`).

### 3.4 Modes de permission (`evaluatePermission`, `rules.ts:137-173`)

Ordre d'évaluation : deny rule (bloque tout, y compris en bypass) → `plan` mode refuse tout ce qui n'est pas `read` → allow rule (sauf risque `danger`, qui redemande toujours) → `bypassPermissions` autorise tout → `read` toujours autorisé → `acceptEdits` autorise `edit` automatiquement → sinon `ask`. Le cycle des modes (`default→acceptEdits→plan→bypassPermissions`) est déclenché par Shift+Tab dans `InputBox.tsx:411` → `onCycleMode` → `App.tsx:179-183` (`cycleMode`) → `AgentLoop.setPermissionMode` (`loop.ts:352-357`).

### 3.5 Intégration hooks (`hooks/runner.ts`)

`runHookCommand()` spawn `/bin/bash -c <command>` avec le payload JSON sur stdin (`session_id, cwd, hook_event_name, permission_mode, tool_name, tool_input, tool_response, prompt, message, …`), timeout par hook (`hook.timeout` en secondes, défaut 60s), env `FULLER=1, FULLER_HOOK_EVENT, CLAUDE_PROJECT_DIR, FULLER_PROJECT_DIR` (double variable pour compat Claude Code). Contrat de sortie (`runHooks`, `hooks/runner.ts:147-194`) : exit 2 = bloquant (stderr = raison) ; JSON stdout avec `decision:"block"`, `continue:false`, `hookSpecificOutput.permissionDecision` (`allow`/`deny`/`ask`, rang de priorité `deny>ask>allow` entre hooks multiples), `updatedInput` (fusionné), `additionalContext` (ajouté au contexte du prochain tour). Les hooks d'un même event/matcher tournent **en parallèle** (`Promise.all`, `hooks/runner.ts:150`). Intégration dans `loop.ts` : `PreToolUse` peut fixer `hookAllow` qui court-circuite le prompt de permission (`loop.ts:627-638,678`) ; `PermissionRequest` ne se déclenche que si aucun hook `PreToolUse` n'a déjà tranché (`loop.ts:679-684`) ; `PostToolUse` ajoute du feedback au résultat renvoyé au modèle (`loop.ts:723-727`) ; `UserPromptSubmit`, `SessionStart`, `Stop`, `PreCompact`, `SessionEnd`, `Notification` déclenchés respectivement en `loop.ts:452-465`, `161-163`, `573-581`, `948-954`, `344-346`, `691`.

### 3.6 Règles MCP

`mcp/manager.ts` expose chaque outil sous `mcp__<serveur>__<outil>` (`mcpToolName`, `mcp/schema.ts:43-45`, tronqué à 64 caractères). Les règles de permission suivent le même chemin que les outils natifs (`ruleMatches` sait matcher `mcp__serveur` seul comme préfixe). Transports : stdio (`StdioClientTransport`, env hérité + surchargé, `stderr:'ignore'`) et HTTP — `StreamableHTTPClientTransport` avec repli automatique sur `SSEClientTransport` en cas d'échec de construction, ou direct SSE si `type:'sse'` (`mcp/manager.ts:87-99`). `.mcp.json`/`.fuller/mcp.json`/`~/.fuller/mcp.json` avec expansion `${VAR}`/`${VAR:-default}` (`mcp/config.ts:44-55`). `connectAll()` mémoïse une seule promesse (`readyPromise`), timeout de connexion/listTools 10s par défaut (`withTimeout`, `mcp/manager.ts:159-164`). Conversion JSON Schema → Gemini Schema (`toGeminiSchema`, `mcp/schema.ts`) gère `anyOf/oneOf/allOf` (garde la 1ʳᵉ variante non-null), `nullable`, `enum`, objets vides remplacés par une propriété `input` libre (Gemini rejette les schémas objet vides).

### 3.7 Permissions des sous-agents

`agent/subagents.ts` : 2 sous-agents intégrés (`general-purpose` = tous les outils ; `Explore` = lecture seule `read_file/list_directory/search_files/glob/web_fetch`), plus définitions custom `.fuller/agents/<nom>.md` (frontmatter `description`, `tools`, `model`, `maxturns` — noter la casse minuscule attendue dans le frontmatter, `subagents.ts:56`) avec repli `.claude/agents`. `normalizeToolName()` traduit les noms Claude Code (`bash→execute_bash`, `read→read_file`, `multiedit→edit_file`, etc.). `agent/subagent.ts` : le sous-agent tourne dans **sa propre session Gemini** (`new GeminiAgentSession`, pas de partage d'historique) filtrée aux outils autorisés (`session.setToolFilter`), avec une liste noire fixe `NEVER = ['agent','exit_plan_mode','todo_write']` (pas de récursion, pas de plan/todo state du parent, `subagent.ts:35`). **Chaque appel d'outil du sous-agent repasse par `evaluatePermission()` avec le mode/les règles du parent** et par la fonction `askPermission` transmise par le parent (`loop.ts:765-769`) — donc les prompts de permission remontent bien à l'utilisateur, rien ne bypass silencieusement.

### 3.8 Sécurité des chemins (référence croisée §6, code dans `tools/paths.ts`)

Confinement au workspace + `additionalDirectories`, résolution des symlinks au niveau du plus profond ancestor existant (`safeRealpath`, `paths.ts:56-71`) pour empêcher l'évasion via lien symbolique, liste de patterns sensibles refusés en lecture/écriture (`.env*`, `.git/`, clés SSH/PEM, `.aws/credentials`, `.npmrc`, `.netrc`, `.docker/config.json`, `.gnupg`) — `isSensitivePath`, `paths.ts:11-27`.

### 3.9 Limites constatées

Pas de gestionnaire UI graphique de permissions au-delà du menu `/permissions` textuel (liste + add/deny/remove en ligne de commande) ; pas d'OAuth pour MCP (seulement `headers` statiques) ; pas de « resources »/« prompts » MCP exposés (seulement `tools`, `mcp/manager.ts` ne référence aucune méthode `listResources`/`listPrompts`) ; pas de granularité par sous-arborescence de fichiers autre que globs simples.

---

## 4. Boucle agent

### 4.1 Streaming

`GeminiAgentSession.streamTurn()` (`gemini.ts:172-223`) consomme `chat.sendMessageStream()` chunk par chunk (`for await`), extrait `part.text` (hors `part.thought`) et `part.functionCall`, accumule l'usage (`usageMetadata`). Les chunks texte sont regroupés côté `AgentLoop` par une classe `ChunkBatcher` (`loop.ts:90-102`) qui bufferise et flush toutes les **50 ms** (`intervalMs=50`, conforme au README) pour limiter la fréquence de re-render React/Ink.

### 4.2 Appels d'outils : **séquentiels, pas parallèles**

Contrairement à ce que suggère le README (« appels d'outils parallèles (réponses groupées) »), le code exécute les tool calls d'un même tour **un par un** dans une boucle `for` classique avec `await` (`loop.ts:539-556`) — aucun `Promise.all`. Ce qui est réellement « groupé », c'est la **réponse** : toutes les `functionResponse` du tour sont accumulées dans `responses[]` puis envoyées en un seul message au modèle (`sendToolResponses`, `loop.ts:561`, `gemini.ts:161-170`) — ce qui correspond au test `tests/loop.test.ts` intitulé *« answers parallel tool calls with one batched response »* (le mot « parallel » y désigne des appels demandés simultanément par le modèle, pas une exécution concurrente côté Fuller). C'est un écart potentiel avec Claude Code, qui peut réellement paralléliser certains outils en lecture seule.

### 4.3 Retry / backoff (`agent/retry.ts`)

`isRetryable()` : codes HTTP 429/500/502/503/504, ou messages contenant `resource_exhausted|unavailable|overloaded|fetch failed|econnreset|etimedout|socket hang up|network|deadline` (`retry.ts:17-22`). `withRetry()` : 5 tentatives max par défaut, délai `min(30000, 1000 * 2^(attempt-1)) + jitter(0-500ms)` (backoff exponentiel avec cap 30s + jitter, `retry.ts:52`). Ne retry jamais si du texte a déjà été livré au flux (`delivered` flag côté `gemini.ts:175,218`, pour éviter de dupliquer une réponse partielle affichée). Annulation immédiate sur `AbortSignal`.

### 4.4 Interruption

Chaque tour crée un `AbortController` (`loop.ts:433`) dont le `signal` est transmis à `session.sendUserMessage`/`sendToolResponses` (→ SDK Gemini via `abortSignal` dans la config, `gemini.ts:181`), à `executeCall` (vérifié avant/après chaque outil, `loop.ts:540,559`), et jusqu'aux process enfants bash (`executeBash` écoute `signal` et tue l'arbre de processus avec `SIGTERM` puis `SIGKILL` après 1.5-2s, `tools/bash.ts:48-53`). `AgentLoop.interrupt()` (`loop.ts:394-398`) abort le controller et rejette une éventuelle confirmation de permission en attente. Après interruption, `session.repairHistory()` (`gemini.ts:140-155`) retire les tours d'historique orphelins (function call sans réponse) pour garder un historique valide à renvoyer à l'API.

### 4.5 Queue de prompts

Si un `handleUserInput` arrive pendant `processing=true`, il est empilé dans `this.queue` (`loop.ts:406-409`). À la fin du tour, `processQueue()` (`loop.ts:414-419`) dépile automatiquement le prochain (via `setImmediate`). Un mécanisme séparé existe pour les hooks `Stop` bloquants (`stopHookContinue`, `loop.ts:608-613`) qui réinjecte en tête de queue.

### 4.6 Compaction

**Manuelle** (`/compact [focus]` → `AgentLoop.compact()`, `loop.ts:938-976`) : convertit tout l'historique en texte (`historyToText`, `gemini.ts:276-295`, formate tool calls/résultats tronqués à 400/600 caractères), envoie un prompt de résumé dédié (`compactHistory`, `gemini.ts:225-241` : 5 sections demandées — intention, état, fichiers touchés, commandes exécutées, éléments à retenir — max ~600 mots), puis **remplace tout l'historique du chat** par `resetWithSummary()` (`gemini.ts:130-137`) : un tour `user`="[Conversation summary…]" + `model`="Understood…". Un hook `PreCompact` peut bloquer l'opération (`loop.ts:948-954`).
**Automatique** : `maybeAutoCompact()` (`loop.ts:978-984`), appelé après chaque tour, compare `usage.promptTokens / contextWindow` au seuil `autoCompactThreshold` (0.85 par défaut, `config.ts:200`, configurable). Le calcul se fait sur les **derniers tokens de prompt facturés** (`u.promptTokenCount` de la dernière réponse API), pas sur une estimation locale.

### 4.7 Sessions

Format (`session/store.ts`) : JSON `{meta: {id, title?, workspaceDir, model, createdAt, updatedAt, messageCount, tokenCount, gitBranch?}, messages: ChatMessage[], history?: Content[] (historique Gemini brut), todos?: TodoItem[]}`. Stocké dans `~/.fuller/projects/<workspaceDir-encodé>/<id>.json` (`encodeWorkspace` remplace `/\:` par `-`). Écriture asynchrone sérialisée (chaîne de promesses `pending`, `saveSession`, `store.ts:60-72`) via fichier temporaire + `rename` atomique, debounce 1500ms côté `AgentLoop.scheduleSave()` (`loop.ts:331-337`), flush forcé à la sortie (`AgentLoop.flush()`, `loop.ts:340-349`, avec timeout 3s pour le hook `SessionEnd`). Restauration : `--continue` charge la session la plus récente (`getLatestSession`), `--resume [id]` charge par id ou ouvre `SessionPicker` (`index.tsx:103-115`) ; `AgentLoop.fromSession()` reconstruit un `GeminiAgentSession` avec l'historique Gemini brut (restaure vraiment le contexte modèle, pas juste l'affichage). `session/history.ts` est un fichier **distinct** : `~/.fuller/history.jsonl`, juste la liste plate des prompts saisis (pour ↑/↓/Ctrl+R), pas les sessions complètes.

### 4.8 Checkpoints / rewind

`checkpoint/manager.ts` : avant chaque `write_file`/`edit_file`, un checkpoint est créé (`createCheckpoint`, appelé dans `fileOps.ts:104,161`) contenant le contenu **avant modification** de chaque fichier touché (`originalContent: string|null`, `null` = fichier n'existait pas). Granularité = **par appel d'outil** (pas par tour). Stocké dans `~/.fuller/checkpoints/<sha1(workspaceDir).slice(0,16)>/checkpoints.json`, liste plafonnée à 500 entrées, purge auto des checkpoints >30 jours à l'instanciation. `rewindTo(id)` restaure (ou supprime si le fichier n'existait pas) tous les fichiers de tous les checkpoints depuis le début jusqu'à `id` inclus, puis retire ces checkpoints de la liste. Déclenché par `Esc Esc` (`onDoubleEscape` → ouvre `RewindMenu`, seulement si l'agent n'est pas busy, `App.tsx:279`) ou `/rewind`/`/checkpoints`. **Limite explicite** : seuls les fichiers modifiés par les outils sont trackés — les changements faits via `!bash` (mode shell utilisateur) ne créent pas de checkpoint (mentionné dans `RewindMenu.tsx:24`).

### 4.9 Fichiers mémoire (`contextLoader.ts`)

Candidats (`CANDIDATES`, `contextLoader.ts:12`) : `FULLER.md`, `.fuller/FULLER.md`, `AGENTS.md`, `GEMINI.md`, `CLAUDE.md` (le premier trouvé par dossier gagne). Remonte jusqu'à 8 niveaux de dossiers parents depuis le workspace (`contextLoader.ts:60-66`), s'arrête au home ou à `/`. `FULLER.local.md` est chargé **en plus** (non exclusif) à chaque niveau. Fichier utilisateur `~/.fuller/FULLER.md` toujours inclus en premier. Imports `@chemin` résolus récursivement (`resolveImports`, `contextLoader.ts:27-47`), profondeur max **4**, ignorés à l'intérieur des blocs de code fencés, déduplication par `seen: Set`. Taille max par fichier **200 Ko** (`MAX_FILE_BYTES`). Injecté dans le prompt système sous `# Project memory` avec le chemin relatif et le scope (`systemPrompt.ts:67-72`).

### 4.10 Skills / commandes personnalisées

Déjà détaillé en amont du document (README) — confirmé dans le code : `skills/loader.ts` découvre `.fuller/{skills,commands}` et `~/.fuller/{skills,commands}` puis replis `.claude/{skills,commands}` (précédence : le premier trouvé, `loadSkills`, l. 142-156). Un frontmatter minimal maison est parsé (`parseFrontmatter`, l. 43-64, pas un vrai parseur YAML — gère `key: value`, `key: [a,b]`, et blocs `- item`). `expandSkill()` (l. 170-183) substitue `$ARGUMENTS`/`$1`-`$9` (découpage respectant guillemets, `splitArgs` l. 158-163) et exécute les blocs `` !`commande` `` inline (timeout 30s par défaut) en remplaçant par un bloc code avec la sortie tronquée à 10 000 caractères. L'outil `skill` (registry) permet au modèle de charger une skill `modelInvocable` à la demande.

### 4.11 Hooks dans la boucle — événements réellement déclenchés

Confirmé en croisant `loop.ts` : `SessionStart` (constructeur, `loop.ts:161`), `UserPromptSubmit` (avant chaque tour, peut bloquer ou ajouter du contexte, `loop.ts:452-465`), `PreToolUse`/`PermissionRequest` (dans `executeCall`, avant chaque outil), `PostToolUse` (après chaque outil réussi), `Notification` (quand un prompt de permission s'ouvre, `loop.ts:691`), `Stop` (fin de tour, peut ré-enchaîner un tour), `PreCompact` (avant `/compact`), `SessionEnd` (`flush()`, avec timeout 3s pour ne pas bloquer la sortie).

### 4.12 MCP dans la boucle

Les déclarations d'outils MCP sont ajoutées dynamiquement aux `FunctionDeclaration` Gemini via `session.setExtraTools()` + `session.refresh()` dès qu'un serveur se connecte (`onMcpStatus`, `loop.ts:207-221`) — le chat Gemini est donc **recréé** (nouvel historique injecté) à chaque changement de statut MCP, pas juste patché.

### 4.13 Sous-agents dans la boucle

`handleAgentTool()` (`loop.ts:742-785`) : résout la définition par nom (insensible à la casse en repli), exige un `prompt`, lance `runSubagent()` (voir §3.7) avec un callback `onProgress` qui met à jour en direct le `ToolRow` (fenêtre glissante des 6 dernières lignes de log), et un callback `onUsage` qui alimente le compteur de tokens **cumulatif du parent**.

### 4.14 Tâches en arrière-plan (`tools/background.ts`)

`BackgroundTaskManager.start()` spawn `/bin/bash -c <command>` détaché (`detached:true` hors Windows), sortie redirigée vers un fichier log (`~/.fuller/tasks/<session>/<id>.log`), `unref()` immédiat pour ne pas bloquer la sortie du process principal. `task_output(task_id, wait_seconds)` lit les octets non encore rapportés (`reportedBytes` offset) avec attente active optionnelle (poll 200ms). `task_kill` envoie SIGTERM à tout le groupe de process puis SIGKILL après 2s si besoin. Timeout par défaut porté à `max(timeoutMs, 600000)` pour les tâches de fond (`registry.ts:268`, minimum 10 minutes). Notification automatique au modèle à la fin (`pendingContext`, `loop.ts:157-160`) et au transcript (`⏵ Background task … completed`).

### 4.15 Plan mode

`handleExitPlanMode()` (`loop.ts:788-835`) : le plan complet est injecté comme item `text` dans le transcript (visible intégralement, pas tronqué), sauvegardé dans `~/.fuller/plans/<sessionId>.md`, puis une confirmation à 3 options est proposée : « Yes, and auto-accept edits » (→ `acceptEdits`), « Yes, manually approve edits » (→ `default`), « No, keep planning » (reste en `plan`, feedback renvoyé au modèle). Le système prompt ajoute une note explicite en mode plan interdisant `write_file`/`edit_file`/commandes modifiantes (`systemPrompt.ts:22-25`).

### 4.16 Todos

`todo_write` (registry) valide et remplace toute la liste (`normalizeTodos`, plafond 50 items, `registry.ts:221-230`), stockée dans `AgentLoop.todos` et persistée avec la session (`SessionData.todos`). `TodoPanel` s'affiche automatiquement dès qu'un item non complété apparaît (`onTodosChange`, `App.tsx:109`).

### 4.17 Images

Les images (pièces jointes `ImageAttachment` — collées, glissées, ou `@mentionnées`) sont lues en base64 et envoyées comme `Part[]` `{inlineData:{mimeType, data}}` à côté du texte du prompt (`loop.ts:507-513`), donc dans le même tour `user` que le texte — pas de tour séparé. Détection automatique de chemins d'image dans le texte brut (`findImagePaths`, regex sur extensions, `imageClipboard.ts:85-97`).

### 4.18 Usage / coût

`UsageInfo` (`types.ts:85-95`) : `promptTokens`/`responseTokens` = dernier appel API, `cumulativeTokens` = somme de `totalTokenCount` sur tous les appels de la session (`recordUsage`, `loop.ts:421-428`). **Pas de calcul de coût en $** — `/cost` renvoie un lien vers la page de pricing Google plutôt qu'un montant (`commands.ts:110`, `total_cost_usd: 0` codé en dur dans `useStatusLine.ts:34`). `/context` (`commands.ts:115-129`) estime la répartition (system prompt, mémoire, définitions d'outils, messages) en **divisant le nombre de caractères par 4** — une heuristique grossière, pas un vrai tokenizer.

### 4.19 `headless.ts` — formats de sortie

3 formats : `text` (texte de réponse sur stdout, notices/outils sur stderr), `json` (un seul objet final : `result, session_id, model, num_tool_calls, usage:{total_tokens,api_calls,turns}, duration_ms, is_error, error?`), `stream-json` (JSONL au fil de l'eau : `{type:'session',...}` au début, puis `{type:'assistant'|'tool'|'notice'|'system',...}` par évènement, puis `{type:'result',...}` final). En mode non interactif, une demande de permission est **automatiquement refusée** avec un message expliquant comment débloquer (`--permission-mode acceptEdits`, `--dangerously-skip-permissions`, `--allowedTools`) — `headless.ts:40-46`. Les commandes slash de type `/nom` tapées comme prompt initial sont interprétées comme des skills utilisateur si elles matchent (`headless.ts:52-57`), pas comme les commandes `COMMANDS` intégrées (celles-ci ne sont pas routées en headless).

### 4.20 `systemPrompt.ts`

Sections dynamiques : environnement (cwd, dossiers additionnels, plateforme, date, modèle, branche git, mode + note plan mode), méthode de travail (7 règles fixes), description des outils intégrés (texte fixe, pas généré depuis `registry.ts` — **risque de désynchronisation** si un outil est ajouté sans mettre à jour ce texte, cf. §8), liste des sous-agents (si non filtré), instructions supplémentaires (sous-agents), liste des skills invocables par le modèle, puis mémoire projet (concaténation des fichiers `contextLoader`). Température du modèle fixée à `0.2` (`gemini.ts:102`) — non configurable par l'utilisateur.

---

## 5. Commandes slash, flags CLI, settings

### 5.1 Commandes slash (`src/ui/commands.ts`, tableau `COMMANDS`)

| Commande | Alias | Rôle réel (implémentation) |
|---|---|---|
| `/help` | | Liste commandes + raccourcis (texte généré depuis `COMMANDS`) |
| `/clear` | | Nouvelle conversation : `agent.clearHistory()`, vide todos/items, redessine |
| `/compact [focus]` | | `agent.compact(focus)` |
| `/status` | | Session, modèle, git, mode, règles, mémoire, sources de settings |
| `/cost` | `/usage` | Tokens cumulés, dernier appel, appels API, tours, temps écoulé |
| `/context` | | Répartition estimée (system/mémoire/outils/messages) en `/4` caractères |
| `/model [name\|list\|list all]` | | Sans argument ouvre `ModelPicker` ; `list`/`list all`/`all` affiche un tableau ; sinon change de modèle et tente de récupérer sa fenêtre de contexte |
| `/theme [name]` | | Change de thème (persisté) ou liste les thèmes |
| `/permissions [add\|deny\|remove <rule>]` | | Gère les règles ; sans argument liste allow/deny |
| `/plan` | | Bascule `plan` ↔ `default` |
| `/accept-edits` | | Bascule `acceptEdits` ↔ `default` |
| `/mode <mode>` | | Force un mode explicite |
| `/init` | | Envoie un **prompt au modèle** pour générer/améliorer `FULLER.md` (pas de génération locale) |
| `/memory` | | Liste les fichiers mémoire chargés avec taille |
| `/rewind` | | Ouvre `RewindMenu` |
| `/checkpoints` | | Liste texte des checkpoints |
| `/sessions` | `/resume` | Liste les 15 sessions les plus récentes |
| `/diff` | | `git status --short`/`git diff --stat`/`git diff` via `execute_bash` direct (pas l'outil du modèle) |
| `/export [file]` | | Écrit la conversation en Markdown sur disque |
| `/doctor` | | Diagnostic local (clé API, modèle, workspace, git, TTY, truecolor, FULLER.md, ~/.fuller, versions) |
| `/btw <question>` | | Question one-shot hors historique (`agent.sideChat`, ne touche pas au contexte) |
| `/add-dir <path>` | | Ajoute un dossier autorisé pour la session en cours |
| `/skills [reload]` | | Liste (ou recharge) commandes/skills découverts |
| `/copy [N]` | | Copie la N-ième réponse depuis la fin dans le presse-papiers |
| `/rename <title>` | | Renomme la session (titre affiché) |
| `/agents` | | Liste les sous-agents disponibles |
| `/mcp` | | Statut + outils des serveurs MCP |
| `/tasks [kill <id>]` | | Liste ou tue une tâche de fond |
| `/hooks` | | Liste les hooks configurés |
| `/verbose` | | Bascule le transcript détaillé (alias UI de Ctrl+O) |
| `/about` | | Info produit + 5 proverbes |
| `/exit` | `/quit` | Quitte (flush session + hook SessionEnd) |

Absent de la liste README mais présent dans le code : `/verbose` (alias explicite de Ctrl+O, non documenté dans le README). Les slash-commands des skills utilisateur (`/nom-skill`) sont résolus **après** la table `COMMANDS` (`runCommand`, `commands.ts:469-494`) — une commande skill ne peut donc pas écraser une commande intégrée de même nom.

### 5.2 Flags CLI (`src/index.tsx`, `commander`)

`-m/--model`, `-k/--key`, `-d/--dir` (défaut cwd), `--add-dir <dirs...>` (variadique), `-p/--print`, `--output-format <text|json|stream-json>`, `--permission-mode <mode>`, `--dangerously-skip-permissions`, `-y/--yes` (alias du précédent), `--allowedTools <rules...>` (variadique), `--max-turns <n>`, `-c/--continue`, `-r/--resume [id]` (picker si aucun id), `--list-models`, `--all` (avec `--list-models`), `--theme <name>`. Plus `[prompt...]` en argument positionnel variadique. `--version`/`--help` viennent gratuitement de `commander`. Pas de flag `--verbose`, `--debug`, ni de sous-commandes (`fuller mcp add`, etc. absents — configuration MCP uniquement via fichiers JSON).

### 5.3 Clés de configuration (`src/config.ts`, interface `Settings`/`AppConfig`)

`Settings` : `permissions.{allow,deny,additionalDirectories,defaultMode}`, `model`, `theme`, `contextWindow`, `autoCompact`, `autoCompactThreshold`, `notifications` (`off|permission|all`), `spinnerVerbs`, `bashTimeoutMs`, `maxTurns`, `env` (variables d'environnement injectées si non déjà définies), `statusLine.{type,command,padding,refreshInterval}`, `hooks`. Précédence de fusion (`mergeSettings`, `config.ts:93-122`) : user → project → local, appliquée dans cet ordre avec **concaténation** des tableaux (`allow`/`deny`/`additionalDirectories`) et **fusion superficielle** des objets (`env`, reste des clés scalaires écrasées par la source la plus locale) ; `hooks` fusionné événement par événement (concaténation des groupes). Priorité finale des champs runtime : override CLI > variable d'env (`GEMINI_MODEL`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, `FULLER_CONTEXT_WINDOW`) > `settings.json` fusionné > valeur par défaut codée en dur (`getConfig`, `config.ts:174-206`).

---

## 6. Outils (`src/tools/registry.ts`)

| Outil | Paramètres (Gemini schema) | Implémentation |
|---|---|---|
| `execute_bash` | `command*`, `description?`, `timeout?` (ms, défaut 120000, plafond 600000), `run_in_background?` (bool) | `tools/bash.ts` (spawn détaché, capture 5 Mo max, `AbortSignal`) ou `tools/background.ts` si `run_in_background` |
| `task_output` | `task_id*`, `wait_seconds?` (0-300) | `background.ts:read()`/`wait()` |
| `task_kill` | `task_id*` | `background.ts:kill()` |
| `read_file` | `file_path*`, `offset?`, `limit?` | `fileOps.ts:readFile` (numéroté, 2000 lignes/2000 car. par ligne max, 5 Mo max, détection binaire) |
| `write_file` | `file_path*`, `content*` | `fileOps.ts:writeFile` (checkpoint avant écriture, confinement `paths.ts`, refus fichiers sensibles) |
| `edit_file` | `file_path*`, `target_content*`, `replacement_content*`, `replace_all?` | `fileOps.ts:editFile` (remplacement exact, erreur si 0 ou >1 occurrence sans `replace_all`, checkpoint avant écriture) — **pas d'édition multi-blocs atomique en un seul appel** (équivalent `MultiEdit` de Claude Code absent) |
| `list_directory` | `dir_path?`, `recursive?` (2 niveaux max) | `search.ts:listDirectory` (respecte `.gitignore` + ignorés fixes) |
| `search_files` | `query*`, `regex?`, `ignore_case?`, `glob?`, `path?`, `max_results?`, `output_mode?` (`content\|files_with_matches\|count`), `context_lines?`, `head_limit?` | `search.ts:searchFiles` — utilise `rg` si trouvé (`FULLER_RG` ou `PATH`, sortie `--json` streamée), sinon repli JS (regex sur chaque fichier via `fast-glob`) |
| `glob` | `pattern*`, `path?` | `search.ts:globFiles` (`fast-glob`, trié par mtime desc, 500 résultats max) |
| `todo_write` | `todos*` (array `{content*, status*, activeForm?}`) | `registry.ts:normalizeTodos` (50 items max) |
| `agent` | `description*`, `prompt*`, `subagent_type?` | `loop.ts:handleAgentTool` → `agent/subagent.ts:runSubagent` |
| `exit_plan_mode` | `plan*` | `loop.ts:handleExitPlanMode` (no-op hors plan mode) |
| `skill` | `name*`, `args?` | `skills/loader.ts:expandSkill` |
| `web_fetch` | `url*` | `tools/web.ts:webFetch` (`fetch` natif, http/https uniquement, 20 000 car. max, HTML→texte maison) |

Plus les outils MCP dynamiques `mcp__<serveur>__<outil>` (schéma converti à la volée). **Absents** confirmés par lecture exhaustive de `registry.ts` : pas d'outil `notebook_edit` (Jupyter), pas d'outil `multi_edit` distinct (un seul remplacement par appel — le modèle doit enchaîner plusieurs `edit_file`), pas d'outil de recherche web dédié (`web_search`, distinct de `web_fetch` qui ne fait que récupérer une URL donnée, sans requête moteur de recherche).

---

## 7. Tests

19 fichiers de tests trackés sous `tests/` (Vitest) + `tests/fixtures/mcp-echo.mjs` (serveur MCP factice pour les tests d'intégration) :

| Fichier | Couverture |
|---|---|
| `background.test.ts` | démarrage/streaming log/lecture incrémentale/notification fin, kill, timeout |
| `bashParser.test.ts` | `splitCommand`, `classifyCommand` (lecture/édition/exécution/danger caché), `suggestPrefix` |
| `context.test.ts` | chargement mémoire multi-niveaux + imports, limite de profondeur |
| `frameWriter.test.ts` | 1ʳᵉ frame inchangée, EL0 vs EL2, effacement après rétrécissement, ANSI ignoré dans le calcul, static non trackée, reset sur clear, mode no-reflow, `composeRepaint` |
| `hooks.test.ts` | matching event/matcher, exit 2 bloquant, contrat JSON (permission/updatedInput/context), fusion multi-hooks (deny gagne), timeouts/erreurs non bloquantes |
| `images.test.ts` | détection de chemins d'image dans un prompt, métadonnées d'attachement |
| `keys.test.ts` | parsing CSI/modificateurs/Alt/paste |
| `loop.test.ts` | le plus complet : tool calls groupés, plan mode (deny silencieux), permission ask/yes/feedback, interruption, queue, confinement workspace, todos, **tous les hooks**, plan mode complet (exit_plan_mode), MCP (permission + appel), sous-agents (permissions routées au parent), images inline |
| `mcpManager.test.ts` | connexion, listing outils, erreurs, appel d'outil |
| `mcpSchema.test.ts` | conversion JSON Schema → Gemini, noms d'outils, expansion env |
| `paths.test.ts` | confinement, évasion refusée, dossiers additionnels, symlinks évasifs, fichiers sensibles |
| `rules.test.ts` | parsing de règles, matching bash/fichiers/web, évaluation par mode, deny>allow>bypass, danger toujours ask, acceptEdits |
| `search.test.ts` | matches/gitignore/glob, regex/casse/modes de sortie, choix du backend, regex invalide |
| `skills.test.ts` | frontmatter, découverte + précédence (y compris repli Claude Code), expansion `$ARGUMENTS`/shell inline |
| `statusLine.test.ts` | payload JSON compatible Claude Code, exécution, échec/timeout |
| `subagents.test.ts` | découverte + built-ins, normalisation des noms d'outils |
| `todos.test.ts` | validation/normalisation |
| `truncate.test.ts` | tête/queue conservées, détection binaire |
| `markdown.test.tsx` | rendu titres/listes/code inline/tableaux, blocs de code avec langage, parsing/numérotation de diff |

**CI absente** : aucun répertoire `.github/workflows`, aucun `.gitlab-ci.yml` ni équivalent trouvé à la racine — `npm run typecheck`/`npm test` ne sont exécutés qu'en local (script `prepublishOnly` les enchaîne avant publication npm, mais rien ne les déclenche automatiquement sur push/PR). Pas de linter configuré (`.eslintrc*` absent), pas de `.prettierrc`.
`tests/resize.test.tsx` (untracked, ignoré comme demandé) couvre en fait un large spectre de redimensionnement (physicalRows, transformChunk, composeRepaint, installFrameWriter, renderToString, Markdown responsive, LiveArea, debounce 120ms) qui recoupe et étend `frameWriter.test.ts` — suggère un travail en cours d'une autre session sur le sujet resize.

---

## 8. Points faibles observés

1. **Incohérence variable d'environnement de reflow** : le README documente `FULLER_NO_REFLOW=1` pour désactiver le reflow sur un terminal qui ne re-replie pas, mais le code lit `FULLER_REFLOW=1` pour **activer** le reflow (`index.tsx:121`), reflow **désactivé par défaut**. La doc et le comportement réel divergent — à clarifier (README obsolète ou nommage inversé par erreur).
2. **Exécution "parallèle" trompeuse** : le README et un nom de test (« answers parallel tool calls ») laissent penser à une exécution concurrente des tool calls, alors que `loop.ts:539-556` les exécute strictement en séquence (`await` dans une boucle `for`). Pour des outils en lecture seule indépendants (plusieurs `read_file` par exemple), c'est une perte de latence potentielle par rapport à Claude Code.
3. **Description des outils dupliquée en dur dans le prompt système** : `systemPrompt.ts:45-55` recopie à la main la liste et la signature des outils intégrés, séparément de `tools/registry.ts` (source de vérité réelle envoyée à l'API). Un outil ajouté/modifié dans `registry.ts` sans mise à jour manuelle de `systemPrompt.ts` désynchronise la documentation vue par le modèle — risque de dérive silencieuse déjà latent (`agent`, `skill` sont bien documentés, mais rien ne garantit que ça reste vrai).
4. **`/context` et l'estimation de tokens système** utilisent une heuristique `caractères/4` (`commands.ts:124`) au lieu d'un tokenizer réel — imprécis, surtout pour du code ou des caractères non-ASCII (CJK, emoji) où le ratio diverge fortement.
5. **`/cost` sans coût réel** : `total_cost_usd` est codé en dur à `0` dans `useStatusLine.ts:34`, et `/cost` renvoie juste un lien vers la doc de pricing (`commands.ts:110`) — aucune table de prix par modèle n'est embarquée, contrairement à l'esprit de la fonctionnalité équivalente de Claude Code.
6. **Checkpoints ne couvrent pas le mode bash** : un `rm`/`sed -i` lancé via `!commande` (mode shell utilisateur direct) ou par le modèle via `execute_bash` ne crée **aucun** checkpoint (seuls `write_file`/`edit_file` en créent, `fileOps.ts:104,161`) — `/rewind` ne peut donc pas annuler une destruction de fichier faite en bash, ce qui est explicitement documenté dans l'UI (`RewindMenu.tsx:24`) mais reste un vrai trou de sécurité UX pour l'utilisateur qui ferait confiance à `/rewind` après un `!rm -rf` accidentel autorisé par erreur.
7. **Pas de vraie gestion de fuseau/format de date dans la mémoire projet** ni de limite de nombre total de fichiers mémoire chargés (seulement une limite de taille par fichier, 200 Ko) : un très grand nombre de sous-dossiers avec des `FULLER.local.md` pourrait gonfler le prompt système sans garde-fou global.
8. **`fuzzyFilter` (complétion `@fichier`) n'est pas un vrai algorithme fuzzy** (`fileIndex.ts:34-53`) : pas de bonus de proximité/consécutivité des caractères façon fzf, juste substring puis sous-séquence — sur de gros repos avec beaucoup de fichiers similaires, le classement sera moins pertinent que celui de Claude Code.
9. **Ctrl+R n'est qu'une recherche par sous-chaîne**, pas un vrai fuzzy/scored search — peut nécessiter plusieurs frappes pour isoler une entrée ancienne dans un historique volumineux.
10. **Pas de limite explicite sur le nombre de tool calls par tour hors `maxTurns`** : `maxTurns` (défaut 50) plafonne le nombre de **tours** (aller-retours modèle↔outils), mais un tour unique peut en théorie contenir un grand nombre de function calls simultanés sans plafond dédié (juste soumis à la troncature de sortie).
11. **`zod` déclaré en devDependency mais apparemment inutilisé** dans `src/` (aucun import trouvé) — résidu probable de la V1 pré-refonte, signalé dans le premier audit et toujours présent.
12. **Glyphes Unicode sans fallback ASCII** (§1.10) : aucune détection de terminal non-Unicode ou de `LANG=C`, risque d'affichage cassé pour des utilisateurs sur des environnements très contraints.
13. **`STARTUP_TIPS` en français alors que tout le reste de l'UI/les messages système sont en anglais** (`branding.ts:51-60`) — incohérence de langue mineure mais visible dès le premier écran.
14. **`suggestPrefix` pour les règles bash peut sur-généraliser** : pour un programme non listé dans `SUBCOMMAND_PROGRAMS`, la règle proposée est `programme:*` (tout l'outil, quelle que soit la sous-commande) — un utilisateur cliquant vite sur « don't ask again » pourrait autoriser plus large que prévu (comportement à vérifier contre Claude Code qui a une heuristique plus fine par endroits).
15. **`normalizeTodos`/`todo_write` sans dé-duplication** : rien n'empêche le modèle d'envoyer deux items strictement identiques, qui s'afficheraient deux fois dans `TodoPanel`.
16. **Pas de CI** (§7) : `typecheck`/`test` ne sont vérifiés qu'à la publication (`prepublishOnly`) ou manuellement — un `git push` cassé ne serait détecté qu'au moment de `npm publish`.
17. **`web_fetch` n'a pas de cache ni de détection de contenu déjà résumé** (pas de résumé automatique façon Claude Code pour les pages longues au-delà de la simple troncature à 20 000 caractères, `web.ts:50-51`) — un gros document HTML sera coupé brutalement au milieu plutôt que résumé intelligemment.
18. **`McpManager.callTool` timeout fixe à 120s** (`mcp/manager.ts:138`) non configurable par l'utilisateur (ni via settings ni via CLI), ce qui peut être trop court pour des outils MCP longs (génération vidéo, etc.) ou trop long pour bloquer un tour sur un outil cassé.
19. **Aucun mécanisme de nouvel essai automatique en cas d'échec d'un outil** (hors retry réseau côté modèle) : si `edit_file` échoue parce que le bloc cible n'est plus unique, le modèle doit relire le fichier et réessayer lui-même — cohérent avec Claude Code sur ce point, mais aucune assistance supplémentaire (pas de diff « fuzzy » suggéré automatiquement).

---

## 9. Tableau comparatif Claude Code → Fuller

Légende : **Présent** = équivalent fonctionnel complet ; **Partiel** = existe mais plus limité, différent, ou incomplet ; **Absent** = aucune trace dans le code.

| Fonctionnalité Claude Code | État Fuller | Notes |
|---|---|---|
| Streaming de la réponse | Présent | `ChunkBatcher` 50ms (§4.1) |
| Appels d'outils parallèles réels | Absent | Séquentiels, réponses groupées seulement (§4.2, §8.2) |
| Retry/backoff réseau | Présent | Exponentiel + jitter, 5 tentatives (§4.3) |
| Interruption (Esc) | Présent | AbortSignal propagé jusqu'aux process bash (§4.4) |
| Queue de prompts pendant un tour | Présent | (§4.5) |
| `/compact` manuel | Présent | (§4.6) |
| Auto-compaction | Présent | Seuil configurable, 85% par défaut (§4.6) |
| Sessions persistées + reprise | Présent | `--continue`/`--resume`, historique modèle réel restauré (§4.7) |
| Checkpoints / rewind fichiers | Partiel | Par outil d'édition uniquement, pas les changements bash (§4.8, §8.6) |
| `/rewind` conversation restore (pas seulement fichiers) | Absent | Seuls les fichiers sont restaurés, pas l'état de la conversation elle-même |
| Fichiers mémoire (CLAUDE.md équiv.) | Présent | `FULLER.md`/AGENTS.md/etc., imports `@chemin`, multi-niveaux (§4.9) |
| Commandes/skills custom | Présent | `.fuller/commands`, `.fuller/skills`, repli `.claude/*` (§4.10) |
| Hooks de cycle de vie | Présent | 9 events, contrat quasi identique Claude Code (§3.5, §4.11) |
| MCP (stdio) | Présent | (§3.6) |
| MCP (HTTP streamable + SSE) | Présent | Avec repli automatique (§3.6) |
| MCP OAuth | Absent | Seulement headers statiques |
| MCP resources/prompts | Absent | Seulement `tools` |
| Sous-agents custom | Présent | `.fuller/agents`, 2 built-ins (§3.7, §4.13) |
| Sous-agents : permissions héritées du parent | Présent | (§3.7) |
| Tâches en arrière-plan | Présent | `run_in_background`, log fichier, `/tasks` (§4.14) |
| Plan mode | Présent | `exit_plan_mode`, 3 options d'approbation, sauvegarde disque (§4.15) |
| Todos (`todo_write`) | Présent | Panneau dédié, persisté (§4.16) |
| Images (coller/glisser) | Présent | Ctrl+V multi-plateforme, 7 Mo max (§2.4, §4.17) |
| Usage tokens | Présent | Cumulatif, par appel (§4.18) |
| Coût en $ | Absent | `total_cost_usd` codé à 0, pas de table de prix (§8.5) |
| Modes headless (text/json/stream-json) | Présent | (§4.19) |
| Prompt système structuré | Présent | Mais description d'outils dupliquée en dur (§4.20, §8.3) |
| Commandes slash complètes | Présent | ~32 commandes (§5.1) |
| Flags CLI riches | Présent | ~18 flags (§5.2) |
| Settings user/project/local | Présent | Fusion avec précédence (§5.3) |
| Outils fichiers (Read/Write/Edit) | Présent | (§6) |
| **MultiEdit** (édition multi-blocs atomique) | Absent | Un seul remplacement par appel `edit_file` (§6, §8) |
| **NotebookEdit** (Jupyter) | Absent | Aucun outil dédié (§6) |
| Recherche (Grep/Glob) | Présent | ripgrep + repli JS (§6) |
| Bash avec sortie live | Présent | `onOutput` streaming vers l'UI (§4.14, ToolRow) |
| **Web search** (outil dédié) | Absent | Seulement `web_fetch` (URL directe, pas de requête moteur) (§6, §8) |
| Web fetch | Présent | Natif `fetch`, HTML→texte maison (§6) |
| Permissions : règles `Tool(spec)` | Présent | (§3.1) |
| Permissions : classification bash fine | Présent | 4 niveaux, très détaillé (§3.2) |
| Permissions : modes (default/acceptEdits/plan/bypass) | Présent | (§3.4) |
| `/permissions` gestionnaire UI avancé (liste interactive, édition visuelle) | Partiel | Seulement liste + add/deny/remove textuels, pas d'écran dédié navigable | 
| `/hooks` éditeur interactif | Partiel | Liste seule, pas d'édition depuis l'UI (§5.1) |
| `/config` panneau interactif | Absent | Pas de commande `/config` ; réglages seulement via fichiers JSON |
| `/agents` gestion interactive | Partiel | Liste seule, création seulement via fichiers `.md` |
| `/mcp` gestion interactive (ajout serveur) | Partiel | Liste/statut seul, ajout seulement via fichiers JSON |
| Plugins / marketplaces | Absent | Aucun système de plugin/marketplace |
| Output styles | Absent | Pas de notion d'« output style » séparée du system prompt |
| `/context` grille visuelle | Partiel | Texte seul, estimation grossière (`chars/4`) (§8.4) |
| `/cost` détails | Partiel | Pas de $ (§8.5) |
| `/usage` | Présent | Alias de `/cost` |
| `/doctor` | Présent | Diagnostic local basique (§5.1) |
| Auto-update | Absent | Aucun mécanisme de mise à jour automatique trouvé |
| Intégration IDE (VS Code, JetBrains) | Absent | Aucune trace de protocole IDE/extension |
| Worktrees git | Absent | Aucune commande `/branch` ni gestion de worktree |
| `/branch` | Absent | |
| Thinking display (raisonnement visible) | Partiel | Le SDK filtre `part.thought` et ne l'affiche jamais (`gemini.ts:190,253`) — le "thinking" de Gemini est explicitement exclu du flux affiché |
| Mode plein écran / écran alternatif | Absent | Explicitement noté "P3" dans le README, non implémenté (§1.12) |
| Souris | Absent | (§1.12, §2.13) |
| Transcript mode "less-like" paginé | Absent | Ctrl+O = bascule globale verbose, pas un pager (§1.12) |
| `keybindings.json` personnalisable | Absent | Bindings câblés en dur (§2.13) |
| Mode vim | Absent | (§2.13) |
| OSC 8 liens cliquables | Absent | (§1.7, §1.12) |
| Mode lecteur d'écran / accessibilité | Absent | (§1.12) |
| Support Windows | Partiel | Code conditionnel présent (clipboard, images, kill process) mais non testé dans la CI (absente) ; `detached` désactivé sous win32 |
| Télémétrie / analytics | Absent | Aucun envoi de métriques trouvé dans le code |
| Thèmes multiples | Présent | 9 thèmes + auto-détection (§1.9) — dépasse même Claude Code en variété (daltonisme, ansi) |
| Status line scriptée | Présent | Compatible JSON Claude Code (§1.11, §4.18) |
| Historique de prompts + recherche | Présent | Mais recherche substring seulement, pas fuzzy (§2.8, §8.9) |
| Undo de saisie | Présent | Limité à l'éditeur de saisie courant (§2.11) |
| Diff avec numéros de ligne | Présent | (§1.8) |
| Markdown riche (tableaux, code coloré) | Présent | (§1.7) |
| Rendu sans scintillement (Static/dynamic) | Présent | Avec correctifs spécifiques VTE non nécessaires sous Claude Code (autre stack de rendu) (§1.1-1.2) |

---

## Annexe — fichiers audités (liste complète)

Tous les fichiers trackés listés dans la consigne ont été lus intégralement : `README.md`, `src/agent/{contextLoader,gemini,loop,models,retry,subagent,subagents,systemPrompt,transcript,types}.ts`, `src/branding.ts`, `src/checkpoint/manager.ts`, `src/config.ts`, `src/headless.ts`, `src/hooks/runner.ts`, `src/index.tsx`, `src/mcp/{config,manager,schema}.ts`, `src/permissions/{bashParser,rules}.ts`, `src/session/{history,store}.ts`, `src/skills/loader.ts`, `src/tools/{background,bash,fileOps,paths,registry,search,truncate,web}.ts`, `src/ui/{App,Banner,commands,DiffView,Footer,frameWriter,glyphs,InputBox,LiveArea,Markdown,ModelPicker,PermissionPrompt,renderToString,RewindMenu,Select,SessionPicker,Spinner,theme,TodoPanel,ToolRow,Transcript,useRawInput,useStatusLine}.ts(x)`, `src/utils/{clipboard,fileIndex,git,imageClipboard,mentions}.ts`. `tests/*.test.ts(x)` (trackés) parcourus pour leurs intitulés (§7). `tests/resize.test.tsx` et `scratch/` explicitement exclus de l'analyse de fond (untracked, hors périmètre).
