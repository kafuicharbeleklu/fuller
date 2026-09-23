# État actuel de la codebase « gemini-code » (futur « Fuller ») — inventaire technique

> Audit statique, basé exclusivement sur le code de `/home/administrator/Desktop/gemini-code` (lecture intégrale de `src/`, `bin/`, `README.md`, `package.json`, `tsconfig.json`, `.env.example`, plus inspection de `node_modules/ink` et de `~/.gemini-code`). Aucun fichier n'a été modifié. Les références sont de la forme `fichier:ligne`.

## 0. Vue d'ensemble

- Volume : 25 fichiers source, **3 174 lignes** au total (`src/` + `bin/`). Fichiers les plus gros : `src/ui/App.tsx` (441 l.), `src/agent/loop.ts` (409 l.), `src/ui/InputBox.tsx` (395 l.), `src/tools/registry.ts` (232 l.), `src/agent/gemini.ts` (206 l.).
- Stack réellement installée (node_modules) : ink 5.2.1, react 18.3.1, @google/genai 2.24.0, ink-spinner 5.0.0, diff 5.2.2, commander 12.1.0, dotenv, typescript 5.9.3, tsx 4.23.15. Node ≥ 18 (`package.json:36`).
- Dépendances déclarées mais **jamais importées** dans `src/` : `zod`, `chalk`, `figures`, `ink-text-input` (`package.json:17,21,24,26`).
- Arborescence : `agent/` (contextLoader, gemini, loop, systemPrompt, types), `tools/` (registry, bash, fileOps, search, web), `ui/` (App, Header, InputBox, MessageList, ToolCard, PermissionModal, DiffViewer, MarkdownRenderer, theme), `session/store.ts`, `checkpoint/manager.ts`, `utils/git.ts`, `config.ts`, `index.tsx`.
- Architecture : une classe `AgentLoop` (état + boucle) pilote l'UI par callbacks (`loop.ts:13-18`) ; l'UI React garde son propre `useState<ChatMessage[]>` (`App.tsx:30`) écrasé à chaque callback (`App.tsx:52,59`).
- `tsc --noEmit` passe sans erreur (vérifié). **Aucun test**, aucun lint, aucun CI, aucun `.eslintrc`/`.prettierrc`.
- `dist/` est **obsolète** : 5 modules absents (`agent/contextLoader`, `checkpoint/manager`, `session/store`, `tools/web`, `ui/theme`) ; `dist/index.js` daté 17:38 vs `src/index.tsx` 19:40 et `src/ui/App.tsx` 20:03. `bin/gemini-code.js:2` importe `../dist/index.js` → le binaire global exécute une version antérieure du code.
- Fichier mémoire projet : `GEMINI.md` (aucun `CLAUDE.md` n'est lu). Aucun `GEMINI.md` n'existe actuellement dans le workspace ni dans ses parents.

## 1. CLI & démarrage

### 1.1 Flags Commander (`src/index.tsx`)
- `name('gemini-code')`, `version('0.1.0')` (`index.tsx:13-15`) — la version est aussi codée en dur dans `package.json:3`.
- Argument positionnel `[prompt...]` joint par espaces → `initialPrompt` (`index.tsx:16,25`), soumis automatiquement au montage de l'App (`App.tsx:67-69`).
- `-m, --model <model>` défaut `process.env.GEMINI_MODEL || 'gemini-3.6-flash'` (`index.tsx:17`).
- `-k, --key <key>` clé API en ligne de commande (`index.tsx:18`) — visible dans `ps`.
- `-d, --dir <dir>` répertoire de travail, défaut `process.cwd()` (`index.tsx:19`).
- `-y, --yes` → `autoApprove` (`index.tsx:20`).
- `-c, --continue` et `-r, --resume` : **strictement identiques** — les deux chargent `getLatestSession(workspaceDir)` (`index.tsx:55-60`) ; la description de `--resume` admet « currently loads latest » (`index.tsx:22`). Aucun sélecteur interactif. `listSessions`/`loadSession` importés (`index.tsx:7`) mais `listSessions`/`loadSession` inutilisés ici.
- `-p, --print <query>` mode non interactif (`index.tsx:23,35-52`).
- Pas de `--verbose`, `--output-format json`, `--permission-mode`, `--allowedTools`, `--max-turns`, `--system-prompt`, `--dangerously-skip-permissions`, ni de sous-commandes (`config`, `mcp`, `doctor`, `update`).

### 1.2 Configuration (`src/config.ts`)
- `dotenv.config()` au chargement du module (`config.ts:5`) : lit `.env` dans `process.cwd()` **et non** dans `--dir`.
- Priorité : override CLI > env > défaut (`config.ts:18-22`). Variables : `GEMINI_API_KEY`, `GEMINI_MODEL`, `AUTO_APPROVE=true` (`config.ts:21`).
- `permissionMode` initial = `'auto-accept'` si `autoApprove`, sinon `'default'` (`config.ts:22`). Mode `'plan'` inaccessible au démarrage.
- `.env.example:5` propose `gemini-2.0-flash`, le code par défaut `gemini-3.6-flash` (`config.ts:19`, `index.tsx:17`), l'aide `/help` cite `gemini-3.8-flash` (`App.tsx:123`) → trois valeurs incohérentes.
- Aucun `settings.json` (global/projet/local), aucune config par projet, aucune persistance sauf `~/.gemini-code/theme.json` (`theme.ts:87`).
- `AppConfig` est un objet **mutable partagé** : `config.permissionMode` et `config.model` sont réassignés depuis l'UI (`App.tsx:79,98,260`).

### 1.3 Mode `-p/--print` (`index.tsx:35-52`)
- Vérifie la clé, instancie `GeminiAgentSession`, appelle `session.oneShot(query, chunk => stdout.write)` puis `process.exit(0)`.
- `oneShot` (`gemini.ts:188-205`) utilise `ai.models.generateContentStream({ model, contents: question })` → **sans system prompt, sans outils, sans GEMINI.md, sans historique**. Le mode print n'est donc pas un agent mais un appel LLM nu. `-y`, `-d`, `-c` sont ignorés en pratique.
- Pas de lecture de stdin (pipe), pas de format JSON/stream-json, pas de code de sortie différencié autre que 0/1.

### 1.4 Écran alternatif, resize, sortie
- Entrée dans l'alternate screen buffer `\x1b[?1049h\x1b[H` si TTY (`index.tsx:64-66`) — comme vim/htop. Conséquence : **aucun scrollback** ; tout ce qui dépasse la hauteur du terminal est perdu (voir §8.1).
- `render(<App/>, { exitOnCtrlC: false })` (`index.tsx:69-71`).
- Resize : listener `stdout.on('resize')` (`index.tsx:96-98`), debounce 35 ms, puis `app.clear()` + `\x1b[2J\x1b[H` + `app.rerender(<App resizeTick={n}/>)` (`index.tsx:77-94`). `resizeTick` est consommé par un `<Text>` qui alterne `''`/`' '` pour forcer Ink à détecter un changement (`App.tsx:438`). Hack déclaré en commentaire (« without duplicate boxes or blank screen », `index.tsx:73`).
- Sortie : `cleanup()` restaure l'écran + curseur `\x1b[?1049l\x1b[?25h` sur `exit`, `SIGINT`, `SIGTERM`, `waitUntilExit` (`index.tsx:101-125`).
- **Aucun banner/splash** : pas de logo, pas de message de bienvenue, pas de tips, pas d'affichage de version dans l'UI. Le seul en-tête est le composant `Header`.
- Sans clé API : l'App rend une boîte rouge d'instructions (`App.tsx:385-408`) et reste affichée sans possibilité de saisir la clé.

## 2. Composants UI (`src/ui/*`)

### 2.1 `App.tsx` (441 l.)
- État : `messages`, `status` (`AgentStatus`), `gitInfo`, `tokenCount`, `permissionMode`, `confirmation`, `theme` (`App.tsx:30-38`) ; `agentRef` (`App.tsx:40`).
- `useEffect([config, initialPrompt])` (`App.tsx:42-70`) : `getGitInfo` (3 commandes git, `git.ts:12-42`), création de `AgentLoop` ou `AgentLoop.fromSession`, soumission de `initialPrompt`.
- Layout (`App.tsx:412-440`) : `<Box column padding=1>` → `Header` → `MessageList` → `PermissionModal` (conditionnel) → `InputBox` → `<Text>` resizeTick.
- **Pas de `<Static>`** (grep négatif sur tout `src/`), pas de `React.memo`/`useMemo`, pas de `useStdout`/`useApp`/`measureElement`.
- `isInputDisabled = status !== 'idle' || confirmation !== null` (`App.tsx:410`).
- Messages « locaux » (help, status, sessions, rewind, checkpoints, model, btw, export, theme, changement de mode) sont ajoutés via `setMessages(prev => [...prev, msg])` **uniquement dans l'état React**, jamais dans `AgentLoop.messages`. Au prochain callback `onMessagesChange` (dès la prochaine requête utilisateur, `loop.ts:217-218`), la liste UI est remplacée par celle de l'agent → **ces messages disparaissent du transcript**. Ils ne sont pas non plus sauvegardés en session (mais sont inclus dans `/export` qui lit l'état UI, `App.tsx:291`).
- `handleClearScreen` écrit `\x1b[2J\x1b[H` directement (`App.tsx:379-383`) sans `app.clear()` → Ink ne sait pas que l'écran est vide ; réaffichage seulement à la prochaine frame.

### 2.2 `Header.tsx` (106 l.)
- Boîte `borderStyle="round"` couleur `accentColor` (`Header.tsx:47-53`), 2 lignes :
  - Ligne 1 : `✦ GEMINI CODE | Terminal Agent`, badge git `git:(branche*)` en magenta (`Header.tsx:56-67`) ; à droite : badge de mode `[Auto-Accept]` vert / `[Plan]` bleu / `[Manual]` jaune (`Header.tsx:71-81`) + badge statut (`Header.tsx:25-38`) : `● Prêt` / `● Réflexion...` / `● Génération...` / `● Exécution...` / `● Approbation`.
  - Ligne 2 : `Model: <model>`, `Tokens: <n>` (format `1.2k tokens`, `Header.tsx:40-44`, masqué si 0), `Dir: <path>` avec `wrap="truncate-middle"` (`Header.tsx:99`) — seul usage d'une troncature Ink dans le projet.
- Aucune animation dans le header (le badge « Réflexion... » est statique). Pas de temps écoulé, pas de coût, pas de jauge de contexte, pas de raccourci affiché. `gitInfo` calculé une seule fois au montage (jamais rafraîchi après un commit).

### 2.3 `MessageList.tsx` (50 l.)
- `messages.map` intégral à chaque rendu (`MessageList.tsx:14`) ; pas de `<Static>`, pas de virtualisation, pas de fenêtre.
- Message user : `❯ ` cyan + contenu en `bold white`, `marginY=1` (`MessageList.tsx:15-26`).
- Message assistant : `ToolCard` pour chaque `toolCalls` **avant** le texte (`MessageList.tsx:31-37`), puis `MarkdownRenderer` (`MessageList.tsx:40-44`). Ordre réel d'apparition (texte, puis outil, puis texte) **non préservé** : le texte streamé après un outil est concaténé dans le même `content` (`loop.ts:298,338,379`) et affiché en bloc sous toutes les cartes.
- Le rôle `'system'` (`types.ts:3`) n'a pas de rendu spécifique (traité comme assistant). Le champ `thinking` (`types.ts:28`) n'est jamais renseigné ni affiché. Pas de timestamps.

### 2.4 `ToolCard.tsx` (117 l.)
- Boîte `borderStyle="single"` ; bordure rouge (failed/rejected), grise (completed), magenta sinon (`ToolCard.tsx:92-103`).
- Icône : spinner `ink-spinner` type `dots` en magenta pendant `running` (`ToolCard.tsx:14-19`, seul spinner de l'app), `?` confirming, `✔` completed, `✖` failed/rejected, `…` pending (`ToolCard.tsx:12-30`).
- `formatArgs` (`ToolCard.tsx:32-51`) : rendu dédié pour 6 outils ; `web_fetch` et `glob` tombent dans `JSON.stringify(args)` (`ToolCard.tsx:48-49`).
- Résultat (`ToolCard.tsx:54-89`) : erreur en rouge ; `edit_file` completed → `DiffViewer` (target vs replacement) ; sinon **troncature à 6 lignes** + `... (+N lines)` (`ToolCard.tsx:74-79`), texte `dimColor`. Aucune troncature en largeur, aucun mécanisme pour déplier (pas d'équivalent Ctrl+O/Ctrl+R), pas de durée affichée (`startTime/endTime` existent dans `types.ts:20-21` mais ne sont pas rendus).
- Pas de rendu spécial pour `write_file` (pas de diff après exécution, seulement `Successfully wrote N bytes`).

### 2.5 `PermissionModal.tsx` (95 l.)
- Boîte `borderStyle="double"` jaune, titre `⚠ Tool Execution Requires Permission`, `Tool: <name>` (`PermissionModal.tsx:59-78`).
- Détails (`PermissionModal.tsx:21-57`) : `edit_file` → `DiffViewer(target, replacement)` ; `write_file` → `DiffViewer("", content)` (tout le fichier en `+`, **pas de diff contre le contenu existant** en cas d'écrasement) ; `execute_bash` → `$ cmd` ; autres → `Args: JSON`.
- `useInput` (`PermissionModal.tsx:13-19`) : `y`/Enter → approve, `n`/Esc → reject. **Aucune option** « toujours autoriser », « autoriser pour cette session », « modifier », « expliquer », ni de choix numérotés.
- Le `useInput` de `InputBox` reste actif simultanément : Esc déclenche **à la fois** `onReject` (modal) et `onInterrupt` (`InputBox.tsx:147-151`, car `disabled` est vrai) ; Ctrl+C pendant la modale → `interrupt()` sans résoudre la promesse de confirmation (`loop.ts:312-324`) → la modale reste affichée, `confirmation` n'est jamais remis à `null`.

### 2.6 `DiffViewer.tsx` (83 l.)
- `createPatch(filePath, old, new)` de la lib `diff` (`DiffViewer.tsx:18-22`) → patch unifié texte.
- Affiche `Diff: <file>` puis `lines.slice(2, 25)` (**23 lignes max**, `DiffViewer.tsx:42`), coloration par préfixe : `---/+++` cyan, `@@` magenta, `+` vert, `-` rouge, contexte dim (`DiffViewer.tsx:43-76`) ; `... (+N more diff lines)` (`DiffViewer.tsx:78-80`).
- Pas de numéros de ligne réels du fichier (le patch est calculé entre `target_content` et `replacement_content`, donc les `@@` commencent à 1), pas de diff mot à mot, pas de coloration syntaxique, pas de mode côte à côte, pas de fond coloré.

### 2.7 `MarkdownRenderer.tsx` (129 l.)
- Parseur maison ligne par ligne, **sans lib markdown**. Découpe en blocs `text`/`code` sur les lignes commençant par ```` ``` ```` (`MarkdownRenderer.tsx:18-46`).
- Bloc code : boîte `round` grise, en-tête `[lang]` jaune + `N lines`, chaque ligne préfixée d'un numéro `padStart(3)` (`MarkdownRenderer.tsx:93-116`). **Aucune coloration syntaxique**, aucune troncature (un bloc de 500 lignes est rendu intégralement).
- Texte (`formatInlineText`, `MarkdownRenderer.tsx:49-88`) : `# `/`## `/`### ` → bold (+underline) mais **les `#` restent affichés** ; listes `-`/`*`/`•`/`1.` → puce `•` cyan + indentation par `paddingLeft` ; tout le reste → `<Text>` brut.
- **Non supporté** malgré le commentaire « bold, code » (`MarkdownRenderer.tsx:48`) : `**gras**`, `*italique*`, `` `code inline` ``, liens, tableaux, citations `>`, `---`, cases à cocher, titres `####+`, code indenté par 4 espaces. Les astérisques apparaissent bruts à l'écran.
- Re-parsé intégralement à chaque chunk de streaming (composant sans mémo).

### 2.8 `theme.ts` (114 l.)
- Interface `Theme` à 10 couleurs (`theme.ts:5-17`), 5 thèmes intégrés `dark`, `light`, `monokai`, `ocean`, `forest` (`theme.ts:19-85`), tous basés sur les 16 couleurs ANSI nommées.
- Persistance `~/.gemini-code/theme.json` (`theme.ts:87,104-110`) ; `loadTheme` fusionne `{...base, ...config}` (`theme.ts:96`).
- **Seul `theme.accent` est réellement utilisé** (`App.tsx:421` → `Header accentColor`). Toutes les autres couleurs sont codées en dur dans chaque composant (`cyan`, `magenta`, `yellow`, `white`…). Le thème `light` (primary `black`) n'a donc aucun effet sur la lisibilité. Aucune détection du fond du terminal, pas de `COLORFGBG`, pas de truecolor.

## 3. Saisie (`src/ui/InputBox.tsx`)

### 3.1 Modèle d'édition
- État : `lines: string[]`, `cursorLine`, `cursorCol`, `history`, `historyIndex`, `selectedCommandIndex`, `lastCtrlCTime`, `lastEscTime` (`InputBox.tsx:45-52`). Composant maison (n'utilise pas `ink-text-input` pourtant installé).
- Curseur simulé par le caractère `█` inséré dans la chaîne (`InputBox.tsx:315,336`) — nécessaire car Ink masque le curseur réel (`node_modules/ink/build/log-update.js:9`).
- Saisie caractère : insertion à `cursorCol` (`InputBox.tsx:260-266`). Backspace/Delete (les deux traités comme backspace, `InputBox.tsx:222`) avec fusion de lignes (`InputBox.tsx:228-240`). ←/→ dans la ligne (`InputBox.tsx:245-257`).
- **Absent** : Home/End, Ctrl+A/E, Ctrl+W/U/K, Alt+←/→ (mots), ↑/↓ entre lignes en multi-ligne (les flèches n'ont aucun effet quand `isMultiLine`, `InputBox.tsx:192`), Delete avant, sélection, undo, mode vim, saisie pendant que l'agent tourne (tout est ignoré quand `disabled`, `InputBox.tsx:189` ; pas de file d'attente de prompts).
- Placeholder dim `Écrivez votre prompt, ou tapez / pour les commandes...` (`InputBox.tsx:339-341`). Quand `disabled` : `❯ (Agent en cours... Esc ou Ctrl+C pour interrompre)` (`InputBox.tsx:376-383`).

### 3.2 Multi-ligne
- `Ctrl+J` insère un saut de ligne à la position du curseur (`InputBox.tsx:108-122`).
- `\` en fin de ligne + Enter → continuation (`InputBox.tsx:125-140`).
- Rendu multi-ligne : préfixe `❯ ` puis `· `, aide `Ctrl+J: nouvelle ligne | Enter: envoyer | \+Enter: continuer` (`InputBox.tsx:305-325`).
- **Shift+Enter / Meta+Enter non gérés** (aucun protocole de clavier étendu). Pas d'éditeur externe (`Ctrl+X Ctrl+E`).

### 3.3 Collage (paste)
- **Aucune gestion** : pas de bracketed paste (`\x1b[200~`), pas de détection. Ink passe un collage multi-caractères comme une seule `input` (`node_modules/ink/build/hooks/use-input.js:9`) qui est insérée telle quelle dans `lines[cursorLine]` **avec ses `\n` bruts** (`InputBox.tsx:260-266`) → le modèle ligne/colonne devient incohérent (`cursorCol += input.length`), `isMultiLine` reste faux, le curseur `█` se retrouve au mauvais endroit. Pas de repli `[Pasted text #1 +N lines]`, pas de collage d'image.

### 3.4 Historique ↑/↓
- En mémoire uniquement (`useState`, `InputBox.tsx:48`), **perdu à la sortie**, non partagé entre sessions, pas de fichier `history`. Navigation uniquement quand mono-ligne et hors slash (`InputBox.tsx:192-219`). Le brouillon courant est écrasé sans sauvegarde quand on remonte. Les commandes slash sélectionnées via le menu ne sont pas ajoutées (`InputBox.tsx:280-289` vs `299`).

### 3.5 Menu slash
- `SLASH_COMMANDS` : 16 entrées (`InputBox.tsx:9-26`). Actif si la valeur commence par `/`, sans espace, mono-ligne (`InputBox.tsx:56`) ; filtre **par préfixe** `startsWith` (`InputBox.tsx:58`) — pas de fuzzy.
- Dropdown : boîte cyan, ligne sélectionnée `❯` cyan, description dim, aide `[↑/↓] naviguer, [Tab] compléter, [Enter] exécuter` (`InputBox.tsx:349-373`).
- ↑/↓ cyclent (`InputBox.tsx:167-178`) ; Tab remplace la ligne par `name + ' '` (`InputBox.tsx:179-186`).
- **Bug** : Enter n'exécute la commande sélectionnée que si le texte tapé est **exactement** égal au nom (`InputBox.tsx:280`) ; taper `/he` + Enter envoie littéralement `/he` au modèle comme prompt (`InputBox.tsx:299-300` → `App.tsx:366`). L'aide « [Enter] exécuter » est donc trompeuse.
- Pas de commandes custom (`.claude/commands`, `~/.claude/commands`), pas d'aide sur les arguments, pas de complétion d'arguments (`/model`, `/theme`).

### 3.6 Raccourcis globaux
- `Shift+Tab` (`key.tab && key.shift` ou `\x1b[Z`) → cycle des modes (`InputBox.tsx:71-76`), même quand l'agent tourne.
- `Ctrl+C` : agent occupé → `onInterrupt` ; inactif → double appui < 1 s → `process.exit(0)` (`InputBox.tsx:79-91`), message `Ctrl+C à nouveau pour quitter` (`InputBox.tsx:388-392`, ne disparaît qu'au prochain re-render).
- `Ctrl+D` → quitte si prompt vide (`InputBox.tsx:100-105`). `Ctrl+L` → efface l'écran (`InputBox.tsx:94-97`).
- `Esc` : occupé → interrompre ; inactif → **double Esc < 500 ms → `/rewind`** (`InputBox.tsx:147-163`). Un Esc simple ne vide pas la saisie.
- `process.exit(0)` direct à 4 endroits (`InputBox.tsx:86,102,282,292`) : pas d'unmount Ink, le timer d'auto-save 2 s (`loop.ts:65-72`) est perdu → les derniers messages peuvent ne pas être persistés.
- **Absents** : `@fichier` (mentions / complétion de chemins), mode bash `!cmd`, `#` mémoire, `Ctrl+R` recherche historique, `Ctrl+O` transcript verbeux, `Ctrl+_` undo, `Ctrl+B` background, `?` aide des raccourcis, `Tab` de complétion de chemin.

## 4. Boucle agent (`src/agent/*`)

### 4.1 Client Gemini (`gemini.ts`)
- `GoogleGenAI({ apiKey })` + `ai.chats.create({ model, config: { systemInstruction, tools: [{functionDeclarations}], temperature: 0.2 } })` (`gemini.ts:27-36`). `chat` typé `any` (`gemini.ts:18`).
- `sendUserMessage` (`gemini.ts:38-100`) et `sendToolResponse` (`gemini.ts:102-176`) : code dupliqué ; streaming via `sendMessageStream`, agrégation `chunk.text`, `chunk.functionCalls`, `usageMetadata.totalTokenCount` (`gemini.ts:56-76`).
- `AbortSignal` : vérifié uniquement avant l'appel et entre deux chunks (`gemini.ts:43,57`) → **la requête HTTP n'est pas annulée** (le signal n'est pas transmis au SDK), on cesse seulement de consommer le flux.
- Réponse outil : `{ functionResponse: { name, response: { output } } }` (`gemini.ts:112-121`), sans `id`.
- Pas de `thinkingConfig`, pas de `maxOutputTokens`, pas de safety settings, pas de cache de contexte, pas de retry/backoff (grep `retry|backoff` négatif), pas de gestion 429/5xx.

### 4.2 System prompt & contexte (`systemPrompt.ts`, `contextLoader.ts`)
- Prompt statique en anglais (`systemPrompt.ts:4-26`) : identité « Gemini Code », 5 principes, liste des 8 outils. Pas d'info sur l'OS, la date, la branche git, le mode de permission, ni d'instructions sur le format de sortie terminal.
- `loadProjectContext` (`contextLoader.ts:4-24`) : cherche **uniquement `GEMINI.md`** en remontant au plus 4 niveaux depuis le workspace, s'arrête au premier trouvé (pas de fusion), injecté sous `--- Project Context (GEMINI.md) ---` (`systemPrompt.ts:28-31`). Pas de `~/.gemini-code/GEMINI.md` global, pas de `GEMINI.local.md`, pas de `@include`, pas de `.gemini/rules`, pas de rechargement à chaud (lu une fois à `initChat`).

### 4.3 Boucle (`loop.ts:205-408`)
- `handleUserInput` : refus si `isProcessing` (`loop.ts:206`), `AbortController` par tour (`loop.ts:208`), message user + placeholder assistant (`loop.ts:211-233`), `updateAssistant` immuable + `autoSave` à **chaque chunk** (`loop.ts:235-242` → `saveSession` debounced 2 s, `loop.ts:65-72`).
- Boucle `while (functionCalls)` (`loop.ts:260-388`) : pour chaque appel → `isToolDestructive` (`loop.ts:285`) → si `plan` et destructif : statut `rejected` + réponse d'erreur au modèle (`loop.ts:287-303`) ; si `default` et destructif : `awaiting_permission`, promesse résolue par la modale (`loop.ts:306-324`) ; refus → réponse `Error: Tool execution was rejected by the user.` (`loop.ts:326-343`) ; exécution `dispatchTool` (`loop.ts:352-357`) sans signal d'annulation ; renvoi du résultat (`loop.ts:374-382`).
- **Bug appels parallèles** : `for (const call of turnOutput.functionCalls)` itère le tableau initial alors que `turnOutput` est réassigné après chaque `sendToolResponse` (`loop.ts:293,333,374`). Si Gemini renvoie N appels dans un tour, on envoie N réponses **une par une**, chacune suivie d'une nouvelle réponse modèle dont les éventuels nouveaux `functionCalls` sont écrasés par l'itération suivante. L'API Gemini exige autant de `functionResponse` que de `functionCall` → erreur probable dès qu'un tour contient ≥ 2 appels.
- Résultat d'outil transmis au modèle **sans aucune troncature** (`loop.ts:374-376`) : un `read_file` de 50 000 lignes ou un `execute_bash` de 10 Mo part intégralement.
- Erreurs : `[Interrupted by user]` ou `[Agent Error: ...]` concaténés au message assistant (`loop.ts:389-402`) ; l'historique du `chat` SDK n'est pas réparé après échec.
- `interrupt()` (`loop.ts:150-164`) : `abort()` + `isProcessing = false` immédiat + `[Interrupted by user]`. Comme l'outil en cours (bash jusqu'à 60 s) n'est pas annulable, une nouvelle saisie peut lancer un second `handleUserInput` **concurrent** au premier qui se termine → deux boucles écrivent `this.messages`.

### 4.4 Permissions / modes
- `PermissionMode = 'default' | 'plan' | 'auto-accept'` (`types.ts:1`). Cycle Shift+Tab : default → auto-accept → plan → default (`App.tsx:72-93`) ; `/plan` bascule plan ↔ default (`App.tsx:95-111`).
- Règle « sensible » (`registry.ts:146-157`) : `write_file`, `edit_file` toujours ; `execute_bash` si la commande **contient** l'une des sous-chaînes `'rm '`, `'git commit'`, `'git push'`, `'kill'`, `'chmod'`, `'chown'`, `'curl'`, `'wget'`, `'sudo'` (`registry.ts:153`). Tout le reste (`read_file`, `list_directory`, `search_files`, `web_fetch`, `glob`) n'est jamais confirmé.
- Contournements évidents : `rm\t`, `rmdir`, `find -delete`, `sed -i`, `mv`, `dd`, `mkfs`, `truncate`, `> fichier`, `git reset --hard`, `git checkout .`, `npm publish`, `docker`, `python -c "os.remove(...)"`, `shred`, `crontab`. Faux positifs : `skill`, `killall -l`, `echo curl`, `ls | grep chmod`.
- `auto-accept` supprime la confirmation pour **tout** (y compris `sudo`, `rm -rf`, `git push`), contrairement à un mode « accept edits » qui ne concernerait que les fichiers.
- `plan` : renvoie une erreur au modèle par outil (`loop.ts:295`), mais le system prompt n'en parle pas ; pas de fichier de plan, pas d'outil « exit plan mode », pas de validation du plan par l'utilisateur.
- Pas d'allowlist/denylist persistante, pas de règles par motif (`Bash(npm test:*)`), pas de « toujours autoriser », pas de mode `bypassPermissions`, pas de hooks.

### 4.5 Compaction, side-chat, modèle
- `/compact` (`loop.ts:166-203`) : concatène `ROLE: content` (sans les résultats d'outils), demande un résumé en 4 puces via `ai.models.generateContent` (`gemini.ts:178-185`), remplace `this.messages` par un seul message `✦ Context compacted:`. **N'appelle pas `initChat()` et n'injecte pas le résumé dans le chat SDK** → le contexte API reste intégral : aucune économie de tokens réelle, seul le transcript UI est réduit. `tokenCount` n'est pas remis à zéro. Pas de compaction automatique à l'approche de la limite.
- `/btw` → `sideChat` (`loop.ts:97-138`) → `oneShot` sans system prompt/outils/historique ; l'échange est **ajouté à `this.messages`** (donc sauvegardé en session et exporté) bien que présenté comme « sans affecter le contexte ».
- `/model <name>` → `switchModel` (`loop.ts:92-95`) recrée `GeminiAgentSession` → **historique API perdu silencieusement**, UI conservée. Aucune validation du nom.
- `/clear` → `clearHistory` (`loop.ts:140-148`) : `initChat()` + `autoSave()` → la session existante (même `sessionId`) est **écrasée** avec 0 message : la conversation précédente disparaît du disque.

### 4.6 Tokens / coût
- `tokenCount` = `usageMetadata.totalTokenCount` de la **dernière requête** (`gemini.ts:64-66`, `loop.ts:255-257,384-386`) = taille du contexte courant (prompt + réponse), pas un cumul. Affiché tel quel dans le Header (« Tokens: 12.3k tokens »). Aucun coût en devise, aucune jauge « % du contexte », aucune limite connue par modèle, pas de `/cost`. `SessionMeta.tokenCount` toujours 0 (`loop.ts:59`), variable `tokenCount` déclarée et inutilisée (`loop.ts:49`).

## 5. Outils (`src/tools/*`)

Déclarations Gemini dans `registry.ts:8-144`, dispatch dans `registry.ts:159-232`. 8 outils :

| Outil | Paramètres | Implémentation | Limites / remarques |
|---|---|---|---|
| `execute_bash` | `command` (req.) | `exec` via `/bin/bash`, `cwd = workspaceDir`, timeout **60 s fixe**, `maxBuffer 10 Mo` (`bash.ts:12-23`) ; sortie `STDOUT:/STDERR:/Exit Code:` (`registry.ts:166-176`) | Pas de streaming, pas de tâche de fond, pas de shell persistant (chaque appel = nouveau bash, `cd` non conservé), pas de paramètre `timeout`/`description`, pas d'annulation, pas de sandbox, sortie non tronquée vers le modèle |
| `read_file` | `file_path` (req.), `start_line`, `end_line` | `fs.readFile` utf8, numérotation `N \| ligne` (`fileOps.ts:5-26`) | **Aucune limite de taille**, pas de détection binaire, pas d'images/PDF/notebooks, pas de troncature de ligne |
| `write_file` | `file_path`, `content` (req.) | checkpoint puis `mkdir -p` + `writeFile` (`fileOps.ts:28-44`) | Pas de vérification « lu avant d'écrire », pas de diff contre l'existant |
| `edit_file` | `file_path`, `target_content`, `replacement_content` (req.) | checkpoint **avant** validation (`fileOps.ts:53-55`), comptage `split(target).length-1`, erreur si 0 ou >1 (`fileOps.ts:59-69`), `raw.replace` (`fileOps.ts:71`) | Pas de `replace_all`, pas de normalisation d'indentation/CRLF ; `String.replace` avec chaîne : les motifs `$&`, `$1` dans `replacement_content` sont interprétés |
| `list_directory` | `dir_path`, `recursive` | `readdir` récursif profondeur ≤ 2 (`search.ts:19`), ignore `.*`, `node_modules`, `dist` (`search.ts:23`), **100 entrées max** (`search.ts:47`), taille en octets | Pas de `.gitignore`, pas de tri |
| `search_files` | `query` (req.) | parcours récursif complet du workspace, `line.includes(query)` (`search.ts:73`), **30 résultats max** (`search.ts:53`), ignore `.*`/`node_modules`/`dist` | **Pas de regex**, pas d'insensibilité à la casse, pas de filtre glob/type, lit chaque fichier entièrement (pas de cap de taille), pas de `.gitignore`, pas de ripgrep |
| `web_fetch` | `url` (req.) | `curl -sL --max-time 15` via shell (`web.ts:16`), `maxBuffer 5 Mo`, timeout 20 s, strip `<script>/<style>/<tags>`, **8 000 caractères max** (`web.ts:25-31`) | URL insérée avec `JSON.stringify` (pas un quoting shell) → `$(...)`/backticks dans l'URL sont exécutés ; pas de conversion markdown, pas de cache, pas de résumé par LLM ; **non « sensible »** alors que `curl` dans bash l'est |
| `glob` | `pattern` (req.) | `find . -path './<pattern>' ... \| head -200` (`web.ts:50`), repli `ls -1 ${pattern}` **non quoté** (`web.ts:63`) | Injection shell directe via `pattern` ; sémantique `find -path` ≠ glob ; exclut seulement `node_modules` et `.git` |

- **Aucun confinement au workspace** : `path.resolve(cwd, filePath)` accepte les chemins absolus et `../` (`fileOps.ts:11,37,56`, `search.ts:15`) ; `read_file`/`list_directory`/`search_files` n'étant jamais confirmés, le modèle peut lire `~/.ssh/id_rsa` ou `/etc/shadow` sans prompt.
- Pas d'outil `Grep` regex, `MultiEdit`, `NotebookEdit`, `WebSearch`, `TodoWrite`, `Task`/sous-agents, `AskUserQuestion`, `Skill`, ni d'outils MCP. Pas de mécanisme d'enregistrement dynamique (registry = tableau statique + `switch`).
- `/help` (`App.tsx:144-150`) et le README (`README.md:58-65`) ne listent que 6 outils sur 8.

## 6. Sessions & checkpoints

### 6.1 Sessions (`src/session/store.ts`)
- Emplacement : `~/.gemini-code/sessions/<id>.json` (`store.ts:6,36`), id `${Date.now()}-${6 car. aléatoires}` (`store.ts:30-32`). Vérifié sur disque : 1 session existante (`1790105972533-sy2y6z.json`, 2 messages, `tokenCount: 0`).
- Format : `{ meta: { id, name?, workspaceDir, model, createdAt, updatedAt, messageCount, tokenCount }, messages: ChatMessage[] }` (`store.ts:8-22`), JSON indenté, **résultats d'outils complets inclus** (croissance illimitée).
- `createdAt` et `updatedAt` sont tous deux `Date.now()` à chaque sauvegarde (`loop.ts:56-57`) → date de création perdue. `name` jamais renseigné.
- `saveSession` synchrone (`writeFileSync`, `store.ts:37`) appelée par debounce 2 s à chaque chunk de streaming (`loop.ts:65-72,241`) → écriture bloquante du fichier complet dans la boucle d'événements pendant le rendu.
- `listSessions` lit et parse **tous** les fichiers JSON du dossier (`store.ts:58-68`) pour filtrer par `workspaceDir` (comparaison stricte de chaîne). `deleteSession` existe (`store.ts:85-94`) mais n'est appelé nulle part. `console.error` (`store.ts:48,71,92`) corrompt l'affichage Ink.
- Restauration : `AgentLoop.fromSession` (`loop.ts:81-86`) copie `sessionId` et `messages` ; le commentaire `loop.ts:74-80` reconnaît que **le modèle n'a aucun contexte** des messages restaurés (chat SDK neuf, aucune injection d'historique). `--continue` est donc cosmétique.
- Pas de sélecteur `/resume`, pas de renommage, pas de fork, pas de transcript JSONL, pas de nettoyage.

### 6.2 Checkpoints (`src/checkpoint/manager.ts`)
- Emplacement : `~/.gemini-code/checkpoints/<md5(workspaceDir)>/checkpoints.json` (`manager.ts:23-25`), un seul tableau JSON avec le **contenu original complet** de chaque fichier (`manager.ts:48-73`), `unshift` (le plus récent en tête, `manager.ts:69`).
- Créés uniquement par `write_file`/`edit_file` (`fileOps.ts:34-36,53-55`), y compris quand l'édition échoue ensuite (target introuvable). **Les commandes bash (`rm`, `sed -i`, `git checkout`) ne créent aucun checkpoint.**
- `rewindTo(id)` (`manager.ts:79-107`) restaure tous les checkpoints de 0..idx (du plus récent au plus ancien, donc état final = plus ancien), supprime les fichiers créés (`originalContent === null` → `unlinkSync`), puis tronque la liste. `rewindLast` (`manager.ts:109-113`) = un seul pas.
- Exposé à l'UI uniquement via `/rewind` et Esc+Esc (`App.tsx:215-230`, `InputBox.tsx:154-157`) = dernier checkpoint seulement ; `/checkpoints` liste sans permettre de choisir (`App.tsx:232-247`). `rewindTo(id)` et `clear()` inaccessibles.
- **Persistants entre sessions et non liés aux messages** : `/rewind` dans une nouvelle session peut restaurer un fichier modifié lors d'une session précédente (voire après des commits). Ne restaure jamais la conversation (pas de rewind conversationnel). Pas de purge → croissance illimitée.

## 7. Commandes slash — code vs README

### 7.1 Implémentées (source de vérité : `App.tsx:113-367` + `InputBox.tsx:269-301`)
| Commande | Comportement | Réf. |
|---|---|---|
| `/help` | Message d'aide statique (14 commandes, raccourcis, 6 outils) | `App.tsx:115-155` |
| `/accept-edits` | **Cycle** des 3 modes (nom trompeur) | `App.tsx:157-160` |
| `/plan` | Bascule plan ↔ default | `App.tsx:162-165` |
| `/init` | Envoie un prompt (fr) demandant de créer `GEMINI.md` | `App.tsx:167-170` |
| `/compact` | Voir §4.5 (n'allège pas le contexte API) | `App.tsx:172-175` |
| `/status` | Modèle, répertoire, git, tokens, mode | `App.tsx:177-191` |
| `/diff` | Envoie un prompt au modèle « run git status -s and git diff » (consomme des tokens, pas de diff local) | `App.tsx:193-197` |
| `/sessions` | 5 dernières sessions du workspace, texte seul | `App.tsx:199-213` |
| `/rewind` | `rewindLast()` | `App.tsx:215-230` |
| `/checkpoints` | Liste texte | `App.tsx:232-247` |
| `/model [name]` | Affiche ou change (recrée le chat) | `App.tsx:249-270` |
| `/btw <q>` | Side-chat one-shot | `App.tsx:272-286` |
| `/export [file]` | Markdown dans le workspace (résultats tronqués à 200 car.) | `App.tsx:288-328` |
| `/theme [name]` | Liste/change le thème | `App.tsx:330-364` |
| `/clear` | Vide UI + chat API + écrase la session | `InputBox.tsx:283-286,294-297` |
| `/exit`, `/quit` | `process.exit(0)` (`/quit` absent du menu) | `InputBox.tsx:282,291-293` |

- Le matching est `===` ou `startsWith` (`App.tsx:249,272,288,330`) ; `/modelx` est accepté comme `/model`. Toute autre chaîne commençant par `/` est envoyée au modèle.

### 7.2 Écarts README ↔ code
- README (`README.md:123-130`) documente 7 commandes : `/help`, `/accept-edits`, `/clear`, `/compact`, `/status`, `/diff`, `/exit|/quit`. **Non documentées** : `/plan`, `/init`, `/model`, `/btw`, `/rewind`, `/checkpoints`, `/sessions`, `/export`, `/theme` (9 commandes).
- README `README.md:125` : `/accept-edits` « Active/désactive » → en réalité cycle 3 modes ; `README.md:133` Shift+Tab « bascule Auto-Accept » → cycle incluant Plan.
- README `README.md:129` : `/diff` « Affiche les modifications Git non indexées » → en réalité délégué au modèle.
- README `README.md:58-65` : 6 outils → 8 dans le code (`web_fetch`, `glob` manquants). Structure `README.md:24-52` omet `session/`, `checkpoint/`, `utils/`, `tools/web.ts`, `agent/contextLoader.ts`, `ui/DiffViewer.tsx`, `ui/MarkdownRenderer.tsx`, `ui/theme.ts`.
- README ne mentionne ni `--continue/--resume/--print/-k`, ni `Esc`, `Esc+Esc`, `Ctrl+D`, `Ctrl+L`, `Ctrl+J`, `\`+Enter, ni `GEMINI.md`, ni les thèmes, ni `~/.gemini-code`.
- README `README.md:16` évoque « spinners d'exécution » (un seul, dans ToolCard) et `README.md:7` « Identique à Claude Code » (voir §9).
- `/help` interne (`App.tsx:119-150`) omet `/export`, `/theme`, `/quit` et cite 6 outils.

## 8. Points faibles techniques observés

### 8.1 Rendu, scintillement, hauteur
- **Aucun `<Static>`** : tout le transcript (`MessageList`) fait partie du frame dynamique. Ink 5.2.1, quand `outputHeight >= stdout.rows`, réécrit **`clearTerminal + sortie complète` à chaque frame** (`node_modules/ink/build/ink.js:121-125`). Dès que la conversation dépasse la hauteur du terminal, chaque chunk de streaming (donc plusieurs fois par seconde) efface et redessine tout l'écran → scintillement garanti et coût CPU O(taille du transcript) par token.
- Alternate screen (`index.tsx:65`) : pas de scrollback → les messages au-dessus du haut de l'écran sont **inaccessibles** ; l'utilisateur ne peut relire ni copier l'historique. Pas de pagination, pas de mode « transcript ».
- `autoSave` + `setMessages([...newMsgs])` + re-parse markdown à chaque chunk sans mémoïsation → re-render de tous les `ToolCard`/`MarkdownRenderer` à chaque token.
- Resize : hack clear + rerender après 35 ms (`index.tsx:77-94`) ; pas de `useStdout().columns` dans les composants ; les boîtes bordées (Header, ToolCard, DiffViewer, code blocks) dépendent du wrapping Yoga par défaut.
- Ctrl+L écrit l'escape brut sans `app.clear()` (`App.tsx:379-383`).

### 8.2 Longues sorties
- Vers l'UI : ToolCard 6 lignes, DiffViewer 23 lignes, code markdown **illimité**, messages assistant illimités. Pas de troncature en largeur (une ligne de 5 000 caractères dans un résultat bash wrap sur des dizaines de lignes).
- Vers le modèle : **aucune troncature** (`loop.ts:374-376`) ; `read_file` sans cap, bash 10 Mo, `search_files` lit tout le disque du workspace.
- Vers le disque : session JSON réécrite intégralement toutes les 2 s.

### 8.3 Unicode / largeur
- Aucune bibliothèque de largeur (`string-width` absent de `src/`). Curseur `█` inséré par index de caractère JS (`InputBox.tsx:315,336`) : avec un emoji (2 unités UTF-16) ou un caractère large, `cursorCol` et l'affichage se désynchronisent ; `slice`/`length` en UTF-16 partout (`InputBox.tsx:225,262-264`). Les icônes `✦ ● ❯ ✔ ✖ ⚠ …` supposent une police Unicode.

### 8.4 TTY non interactif
- `render()` est appelé même si stdin n'est pas un TTY (seul `stdout.isTTY` est vérifié pour l'alt-screen, `index.tsx:64`) ; `useInput` d'Ink lève une erreur « Raw mode is not supported » dans ce cas. Pas de détection `CI`, pas de repli texte, pas de lecture de stdin en pipe. `-p` ne lit pas stdin.

### 8.5 Erreurs API
- Aucun retry, aucun backoff, aucune distinction 401/429/500/timeout ; le message brut du SDK est collé dans le transcript (`loop.ts:397-401`). Pas de gestion du dépassement de contexte (pas de compaction auto), pas de fallback de modèle. `console.error` dans `store.ts` écrit par-dessus l'UI Ink.

### 8.6 Sécurité
- Injection shell : `web.ts:16` (URL via `JSON.stringify` dans une commande bash) et surtout `web.ts:63` (`ls -1 ${pattern}` sans quoting) — le modèle contrôle ces paramètres.
- Aucune restriction de chemin (§5). Lecture non confirmée de n'importe quel fichier système.
- Détection « sensible » par sous-chaînes (§4.4), trivialement contournable ; `auto-accept` couvre `sudo`/`rm`.
- `-k` expose la clé dans la liste des processus ; `.env` lu depuis le cwd (un `.env` malveillant dans un dépôt cloné peut remplacer `GEMINI_MODEL`/`AUTO_APPROVE=true`, `config.ts:5,21`).
- `edit_file` utilise `String.prototype.replace(string, string)` : les séquences `$&`, `$'`, `$1` dans le remplacement sont interprétées (`fileOps.ts:71`).
- Checkpoints : contenu de fichiers copié en clair dans `~/.gemini-code` (secrets inclus), jamais purgé.

### 8.7 Cohérence d'état
- Deux sources de vérité pour les messages (UI vs `AgentLoop`) → disparition des messages locaux (§2.1).
- `interrupt()` pendant une confirmation laisse la modale bloquée (§2.5) ; double effet Esc.
- `/compact` sans effet sur l'API ; `/model` et `/clear` détruisent le contexte ou la session sans avertissement (§4.5).
- `switchModel` mute `config.model` mais `Header` lit `config.model` via props non réactives : la valeur affichée se met à jour seulement grâce au `setMessages` qui suit (`App.tsx:260-267`).

### 8.8 Build, tests, qualité
- `npm run build` = `tsc` (`package.json:12`) ; pas de bundler, pas de minification, pas de `prepublishOnly` ; `dist/` versionné ignoré (`.gitignore:2`) mais présent et périmé ; le `bin` pointe sur `dist/` → l'installation globale via `npm link` (README `README.md:116`) exécute du code obsolète tant que `build` n'est pas relancé.
- **0 test** (aucun fichier `*.test.*`, pas de framework), pas de lint, pas de `engines` vérifié, `any` sur `chat` (`gemini.ts:18`), `restoredSession: any` (`index.tsx:54`), `(c: any)` (`App.tsx:238`).
- Nom du package/binaire/UI/dossier `~/.gemini-code`/fichier `GEMINI.md`/identité du prompt : **6 endroits à renommer** pour « Fuller » (`package.json:2,7`, `index.tsx:13`, `Header.tsx:57`, `systemPrompt.ts:4`, `store.ts:6`, `manager.ts:24`, `theme.ts:87`, `contextLoader.ts:8`, `App.tsx:119-150,294,309`).

## 9. Tableau récapitulatif — Fonctionnalité → Présent / Partiel / Absent

| # | Fonctionnalité (référence Claude Code) | État | Preuve / commentaire |
|---|---|---|---|
| 1 | Boucle agent avec function calling | Présent | `loop.ts:260-388` ; bug appels parallèles |
| 2 | Streaming de la réponse texte | Présent | `gemini.ts:56-63` |
| 3 | Affichage du « thinking »/raisonnement | Absent | champ `thinking` jamais rempli (`types.ts:28`) |
| 4 | Modes de permission (default / acceptEdits / plan / bypass) | Partiel | 3 modes (`types.ts:1`) ; auto-accept trop large, pas de bypass explicite |
| 5 | Plan mode avec fichier de plan et sortie validée | Partiel | rejet des outils destructifs seulement (`loop.ts:287-303`) |
| 6 | Modale de permission avec options (oui / toujours / non) | Partiel | y/n uniquement (`PermissionModal.tsx:13-19`) |
| 7 | Règles de permission persistantes (allow/deny par motif) | Absent | — |
| 8 | Hooks (pre/post tool, notification, stop) | Absent | grep `hook` négatif |
| 9 | Serveurs MCP | Absent | grep `mcp` négatif |
| 10 | Sous-agents / Task tool | Absent | — |
| 11 | Todo list / suivi de tâches | Absent | — |
| 12 | Commandes slash intégrées | Présent | 16 (`InputBox.tsx:9-26`) |
| 13 | Commandes custom (fichiers `.md`) / skills | Absent | — |
| 14 | Autocomplétion slash (Tab) | Partiel | préfixe seulement ; Enter n'exécute pas la sélection (`InputBox.tsx:280`) |
| 15 | Mentions `@fichier` avec complétion | Absent | — |
| 16 | Mode bash `!cmd` | Absent | — |
| 17 | Historique de saisie ↑/↓ | Partiel | mémoire volatile (`InputBox.tsx:48`) |
| 18 | Saisie multi-ligne | Partiel | Ctrl+J, `\`+Enter ; pas de Shift+Enter, pas de navigation ↑/↓ |
| 19 | Collage (bracketed paste, repli « Pasted text ») | Absent | insertion brute (`InputBox.tsx:260-266`) |
| 20 | Collage / lecture d'images | Absent | — |
| 21 | Saisie pendant génération (file d'attente) | Absent | `InputBox.tsx:189` |
| 22 | Interruption (Esc / Ctrl+C) | Partiel | flux non annulé côté HTTP, outil non annulable (`gemini.ts:57`, `loop.ts:352`) |
| 23 | Rendu Markdown (gras, italique, code inline, liens, tableaux) | Partiel | titres, listes, blocs code uniquement (`MarkdownRenderer.tsx`) |
| 24 | Coloration syntaxique des blocs de code | Absent | `MarkdownRenderer.tsx:112` |
| 25 | Diff coloré des éditions | Partiel | patch texte 23 lignes, pas de numéros réels (`DiffViewer.tsx:42`) |
| 26 | Troncature / dépliage des sorties d'outils (Ctrl+O/Ctrl+R) | Partiel | 6 lignes fixes, pas de toggle (`ToolCard.tsx:75`) |
| 27 | `<Static>` / transcript stable sans scintillement | Absent | aucun `<Static>` ; alt-screen (`index.tsx:65`) |
| 28 | Scrollback / relecture de l'historique | Absent | alt-screen sans pagination |
| 29 | Spinner / indicateur d'activité animé | Partiel | seulement dans ToolCard `running` (`ToolCard.tsx:17`) ; header statique |
| 30 | Statusline personnalisable | Absent | Header fixe (`Header.tsx`) |
| 31 | Thèmes (dark/light/daltonien) + détection terminal | Partiel | 5 thèmes, seul `accent` appliqué (`App.tsx:421`) |
| 32 | Mode vim | Absent | — |
| 33 | Compteur de tokens / jauge de contexte | Partiel | taille de la dernière requête (`Header.tsx:90-95`) |
| 34 | Coût (`/cost`) | Absent | — |
| 35 | Compaction (`/compact` + auto) | Partiel | ne réduit pas le contexte API (`loop.ts:166-203`) |
| 36 | Fichier mémoire projet (`CLAUDE.md` ≈ `GEMINI.md`) | Partiel | un seul fichier, pas de global/local/imports (`contextLoader.ts`) |
| 37 | `/init` | Présent | prompt délégué au modèle (`App.tsx:167-170`) |
| 38 | Sessions persistantes + `--continue` | Partiel | UI seulement, contexte modèle non restauré (`loop.ts:74-86`) |
| 39 | `--resume` avec sélecteur | Absent | identique à `--continue` (`index.tsx:55-60`) |
| 40 | Rewind fichiers (checkpoints) | Partiel | dernier checkpoint seulement, jamais pour bash (`manager.ts:109-113`) |
| 41 | Rewind conversationnel | Absent | — |
| 42 | Export de conversation | Présent | `/export` markdown (`App.tsx:288-328`) |
| 43 | Mode non interactif `-p` avec outils / JSON | Partiel | LLM nu sans outils (`gemini.ts:188-205`) |
| 44 | Outil de recherche regex (Grep/ripgrep) | Partiel | `includes` littéral, 30 résultats (`search.ts:73`) |
| 45 | Outil web (fetch + search) | Partiel | fetch via curl 8 Ko, pas de search (`web.ts:10-37`) |
| 46 | Bash en arrière-plan / streaming / timeout paramétrable | Absent | `bash.ts:15` |
| 47 | Confinement des chemins au workspace | Absent | `fileOps.ts:11,37,56` |
| 48 | Retry / backoff API, gestion 429 | Absent | — |
| 49 | Notifications (bell, desktop) à la fin d'une tâche | Absent | grep `notif` négatif |
| 50 | Mise à jour auto / `doctor` / `config` CLI | Absent | — |
| 51 | Tests automatisés | Absent | 0 fichier de test |
| 52 | Support TTY non interactif / CI | Absent | `index.tsx:64` |
