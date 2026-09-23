# Claude Code TUI (v2.x, sept. 2026) — saisie, clavier, navigation, feedback

État de référence : docs officielles code.claude.com (anciennes URLs docs.claude.com redirigent en 301) et CHANGELOG jusqu'à **v2.1.280** (dernière entrée au 22/09/2026). Les numéros de version entre crochets `[vX.Y.Z]` indiquent la version d'apparition d'après le CHANGELOG ou la doc. Termes techniques laissés en anglais.

Sources principales (abrégées ci-dessous) :
- IM = https://code.claude.com/docs/en/interactive-mode
- KB = https://code.claude.com/docs/en/keybindings
- TC = https://code.claude.com/docs/en/terminal-config
- SL = https://code.claude.com/docs/en/statusline
- FS = https://code.claude.com/docs/en/fullscreen
- CP = https://code.claude.com/docs/en/checkpointing
- CM = https://code.claude.com/docs/en/commands
- SR = https://code.claude.com/docs/en/settings-reference
- PM = https://code.claude.com/docs/en/permission-modes
- SE = https://code.claude.com/docs/en/sessions
- MC = https://code.claude.com/docs/en/model-config
- CL = https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md

---

## Question 1 — Saisie du prompt, clavier et navigation (input & keyboard)

### Takeaway
Claude Code expose une saisie readline-like (Ctrl+A/E/K/U/W/Y, Alt+B/F/D), un mode vim optionnel très complet (NORMAL/INSERT/VISUAL, text objects, `f/t`, `.`), quatre méthodes de multiligne (`\`+Enter, Ctrl+J, Shift+Enter, Option+Enter), trois préfixes (`/`, `!`, `@`, plus `#` historique et `:` emoji), une file d'attente de messages (queue) avec envoi immédiat (Ctrl+Enter), un historique persistant par répertoire avec recherche inverse Ctrl+R, et un système de keybindings JSON par contexte avec chords `ctrl+x …` — le tout documenté avec des libellés d'écran exacts.

### Cited Findings

#### 1.1 Contrôles généraux (tableau officiel « General controls »)
- `Ctrl+C` : « Interrupt, or clear input » — interrompt l'opération en cours ; si rien ne tourne, 1er appui vide le prompt, 2e appui quitte Claude Code.
- `Ctrl+D` : quitte ; 1er appui affiche un hint de confirmation, 2e appui **dans les 800 ms** quitte. Si le prompt contient du texte, `Ctrl+D` supprime le caractère après le curseur.
- `Ctrl+X Ctrl+K` : stoppe tous les subagents en arrière-plan (2 appuis en 3 s pour confirmer) et coupe les auto-replies d'artifacts.
- `Ctrl+G` ou `Ctrl+X Ctrl+E` : ouvre le prompt dans l'éditeur externe (`$VISUAL`/`$EDITOR`). Option `/config` → « Show last response in external editor » préfixe la dernière réponse de Claude en commentaires `#`, retirés à la sauvegarde `[v2.1.110]`. `Ctrl+X Ctrl+E` ajouté en `[v2.1.83]`, Ctrl+G ajouté au menu d'aide en `[v2.1.20]`.
- `Ctrl+L` : « Redraw the screen » — redessine sans perdre l'input ni la conversation (avant v2.1.238, double Ctrl+L en 2 s lançait `/clear` ; entre v2.1.260 et v2.1.280, Ctrl+L effaçait l'écran en fullscreen ; reverti en v2.1.280).
- `Ctrl+O` : « Toggle transcript viewer » — mode verbose avec timestamp et modèle par message, déplie les lignes repliées (« Called slack 3 times », « Message from @<sender> »). Historique : c'était `Ctrl+R` jusqu'à `[v1.0.113]` (« Move Ctrl+R keybinding for toggling transcript to Ctrl+O »).
- `Ctrl+R` : recherche inverse dans l'historique `[v1.0.117 / v2.0.0]`.
- `Ctrl+V` (ou `Cmd+V` sur iTerm2, `Alt+V` sur Windows/WSL) : colle une image du presse-papiers, insère un chip `[Image #N]` à la position du curseur pour référence positionnelle ; sur WSL, `Ctrl+V` et `Alt+V` sont tous deux liés.
- `Ctrl+B` : « Background running tasks » — envoie la commande Bash/agent en arrière-plan ; sous tmux appuyer 2 fois (préfixe). Chord alternatif `Ctrl+X Ctrl+B`. `[v1.0.71]`.
- `Ctrl+T` : affiche/masque la to-do checklist de Claude (≤ 5 tâches affichées, état restauré au `--resume` ; distinct de `/tasks`). Dans le picker `/theme`, `Ctrl+T` bascule la coloration syntaxique `[v2.0.74]`.
- `Ctrl+S` : « Stash or restore prompt » — avec du texte : stash + vide ; sur prompt vide : restaure texte, position du curseur et contenu collé.
- `Ctrl+Z` : suspend le process (Unix), `fg` pour reprendre `[v1.0.44]`.
- `Left/Right` : change d'onglet dans les dialogues (permissions, menus).
- `Tab` : accepte la suggestion d'autocomplétion ; sur un prompt de permission avec Yes/No focalisé, ouvre un champ commentaire.
- `Up/Down` ou `Ctrl+P`/`Ctrl+N` : déplace le curseur dans un input multi-lignes ; une fois sur la 1re/dernière ligne visuelle, navigue l'historique. `Up` depuis la 1re ligne avec des messages en queue les « reprend ».
- `Esc` : interrompt Claude (le travail déjà fait est conservé) ou ferme un dialogue ; sur un prompt de permission = « No » sans commentaire. Si des messages sont en queue, ils partent ensuite.
- `Esc` + `Esc` : si l'input contient du texte → vide le brouillon (sauvegardé dans l'historique, rappel avec `Up`) ; si vide → ouvre le menu **rewind**.
- `Ctrl+Enter` ou `Ctrl+X Ctrl+S` : « Send queued messages now » `[v2.1.275]`.
- `Shift+Tab` (ou `Alt+M` sur Windows sans mode VT) : cycle des modes de permission.
- `Option+P` / `Alt+P` : change de modèle sans vider le prompt `[v2.0.65]`.
- `Option+T` / `Alt+T` : bascule l'extended thinking (aucun effet sur Opus 5.5/Fable) ; c'était `Tab` jusqu'à `[v2.0.72]` (« Changed thinking toggle from Tab to Alt+T to avoid accidental triggers »).
- `Option+O` / `Alt+O` : bascule le fast mode.
- Sur macOS, les raccourcis Alt (`Alt+B/F/D/Y/P`) nécessitent « Use Option as Meta Key » ; `/terminal-setup` l'active dans Apple Terminal ; iTerm2 : « Esc+ » ; VS Code : `terminal.integrated.macOptionIsMeta: true`.
— Sources : [IM](https://code.claude.com/docs/en/interactive-mode), [TC](https://code.claude.com/docs/en/terminal-config), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 1.2 Édition de texte (readline)
- `Ctrl+A` / `Ctrl+E` : début / fin de la ligne logique courante.
- `Ctrl+K` : supprime jusqu'à fin de ligne (kill ring) ; `Ctrl+U` : supprime jusqu'au début de ligne (répéter pour remonter en multiligne ; `Cmd+Backspace` mappé dessus par iTerm2/Terminal.app) ; `Ctrl+W` : supprime jusqu'à l'espace précédent (ignore la ponctuation : un `src/utils/foo.ts` entier disparaît) ; `Ctrl+Y` : recolle le dernier texte supprimé ; `Alt+Y` après `Ctrl+Y` : cycle l'historique des suppressions.
- `Alt+B` / `Alt+F` : mot précédent / suivant ; `Alt+D` : supprime jusqu'à fin de mot ; `Option+Delete` (macOS) / `Ctrl+Backspace` (Windows) : supprime le mot précédent. Frontière de mot = lettres+chiffres (`_`, `.`, `/` séparent).
- `Ctrl+_` ou `Ctrl+Shift+-` : « Undo last input edit » (restaure texte + curseur). Historique : undo était `Ctrl+Z` `[v1.0.33]`, puis `Ctrl+U` `[v1.0.44]`, puis `Ctrl+_` `[v1.0.45]` « matching zsh's undo shortcut ».
- Ces conventions readline sont fixes depuis `[v2.1.261]` (setting `keybindingFlavor` déprécié) et **non remappables** via keybindings.json.
- Windows : un Backspace arrivant en `^H` est lu comme Ctrl+Backspace (supprime un mot) sauf mintty/cygwin ; env `CLAUDE_CODE_BS_AS_CTRL_BACKSPACE=0` pour corriger.
— Sources : [IM](https://code.claude.com/docs/en/interactive-mode), [TC](https://code.claude.com/docs/en/terminal-config)

#### 1.3 Multiligne
- Tableau officiel « Multiline input » : `\` + `Enter` (tous terminaux) ; `Option+Enter` (macOS après Option-as-Meta) ; `Shift+Enter` (natif iTerm2, WezTerm, Ghostty, Kitty, Warp, Apple Terminal, Windows Terminal) ; `Ctrl+J` (tout terminal) ; collage direct.
- Support Shift+Enter par terminal : natif sans setup pour Ghostty/Kitty/iTerm2/WezTerm/Warp/Apple Terminal/Windows Terminal ; autres terminaux kitty-protocol (foot, Alacritty ≥ 0.16) natif depuis `[v2.1.269]` ; VS Code/Cursor/Devin Desktop/Alacritty < 0.16/Zed : lancer `/terminal-setup` une fois ; gnome-terminal et JetBrains : « Not available; use Ctrl+J or `\` then Enter ».
- `/terminal-setup` écrit un keybinding Shift+Enter dans la config du terminal ; messages exacts : « Installed VSCode terminal Shift+Enter key binding » ou « VSCode terminal Shift+Enter key binding already configured ». Sur VS Code il règle aussi `terminal.integrated.gpuAcceleration: "off"` et `mouseWheelScrollSensitivity`. Sur Zed, il fusionne `keymap.json` avec backup `keymap.json.<hash>.bak`. Support Kitty/Alacritty/Zed/Warp ajouté en `[v2.0.74]`, WezTerm en `[v1.0.110]` ; Shift+Enter « out of the box » pour iTerm2/WezTerm/Ghostty/Kitty depuis `[v2.1.0]`.
- Sous tmux : ajouter `set -g allow-passthrough on`, `set -s extended-keys on`, `set -as terminal-features 'xterm*:extkeys'`.
- Pour inverser Enter/Shift+Enter : remapper `chat:newline` et `chat:submit` dans keybindings.json.
- Kitty keyboard protocol : Claude Code interroge le terminal (« terminals that answer kitty keyboard query ») pour améliorer le support clavier via SSH/terminaux inconnus `[v2.1.269–2.1.271]` ; `Ctrl+[` reconnu comme Escape sous kitty-protocol depuis `[v2.1.242]` ; correction F1/F2/F4 sous kitty-protocol `[v2.1.269]` ; matching des Ctrl+lettre par position US sous layout cyrillique via kitty-protocol `[v2.1.247]`.
— Sources : [IM](https://code.claude.com/docs/en/interactive-mode), [TC](https://code.claude.com/docs/en/terminal-config), [KB](https://code.claude.com/docs/en/keybindings), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 1.4 Collage long, images, drag & drop
- Collage > **800 caractères ou > 3 lignes** → repli en placeholder `[Pasted text #1 +120 lines]` (texte complet envoyé à la soumission). Le marqueur « +N lines » est une règle pleine largeur depuis `[v2.1.111]`. Backspace supprime le placeholder comme un seul token `[v2.1.14]` ; `Ctrl+W`/`Ctrl+K`/`df]` qui atteignent un placeholder le retirent entier ; `Ctrl+Y` / `p` (vim) le restaurent.
- Contenu conservé sous `~/.claude/paste-cache/` ; un prompt rappelé par l'historique renvoie le contenu complet, même dans une session ultérieure ; si le cache a été purgé (`cleanupPeriodDays`), Claude Code n'envoie jamais la chaîne littérale et affiche une notification ; en shell mode ou commande `/`, la soumission est annulée.
- Le contenu collé est marqué comme « pasted » vers Claude (instructions dedans à suivre seulement si demandé) — uniquement dans les sessions avec feature flags.
- Caractères invisibles Unicode (tags, bidi, zero-width) supprimés à l'Enter ; notice exacte : « Removed 3 invisible characters · review and press Enter to send », l'Enter suivant envoie.
- Collage d'images : `[v0.2.59]` « Copy+paste images directly into your prompt » ; `[v0.2.75]` « Drag in or copy/paste image files directly into the prompt » ; `[v2.1.2]` métadonnées de chemin source pour les images glissées ; redimensionnement automatique avant upload `[v1.0.28]` ; drag & drop de 0 octet corrigé `[v2.1.77]` ; l'état intermédiaire s'affiche « Pasting text… » `[v2.1.128]`.
- Coller un texte commençant par `!` dans un prompt vide entre automatiquement en shell mode.
— Sources : [TC](https://code.claude.com/docs/en/terminal-config), [IM](https://code.claude.com/docs/en/interactive-mode), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 1.5 Préfixes rapides : `/`, `!`, `@`, `#`, `:`, `?`
- Tableau « Quick commands » : `/` en début = commande/skill ; `!` en début = shell mode ; `@` = mention de fichier (autocomplétion de chemins ; depuis `[v2.1.232]` suggère aussi les autres sessions live après ≥ 1 lettre) ; `:` = emoji shortcode `[v2.1.217]` (`:heart:` → ❤️ ; `:` + ≥ 2 caractères ouvre un popup, `Tab`/`Enter` insère ; désactivable `emojiCompletionEnabled:false`) ; `?` sur input vide = bascule le panneau d'aide raccourcis (avec du texte, insère `?`).
- `#` : « Quickly add to Memory by starting your message with '#' » `[v0.2.54]` ; rendu avec fond `memoryBackgroundColor` dans le transcript (token de thème). Aucune page doc 2026 dédiée trouvée décrivant le dialogue de choix du fichier mémoire (voir Gaps).
- `@` : `[v0.2.75]` @-mention de fichiers ; dossiers et images `[v0.2.102]` ; ressources MCP `[v1.0.27]` ; typeahead pour agents custom `@<agent>` `[v1.0.62]` ; fuzzy finder natif Rust `[v2.0.34]`, fuzzy amélioré `[v2.0.55]` ; respecte `.gitignore` (`respectGitignore`, défaut true) ; source custom via setting `fileSuggestion` (commande) ; fix « suggestions enfouies sous les ressources MCP » `[v2.1.275]`. `Tab` pour compléter noms de fichiers/dossiers dès `[v0.2.47]`.
- Shell mode `!` : sort avec `Escape`, `Backspace` ou `Ctrl+U` sur prompt vide `[v2.1.69]` ; autocomplétion par historique des commandes `!` du projet avec `Tab` `[v2.1.14]` ; autocomplétion live de chemins (token contenant `/`, `./src/`, `~/`) `[v2.1.193]` ; Tab completion en bash mode dès `[v2.0.10]` ; bordure de l'input colorée `bashBorder` ; sortie ajoutée au contexte, Claude y répond automatiquement depuis `[v2.1.186]` (`respondToBashCommands:false` pour l'ancien comportement) ; `Ctrl+B` pour backgrounder ; commandes exécutées hors sandbox ; `defaultShell` = `bash`|`powershell`.
- Menu slash : liste built-ins, skills bundled/user, plugins (`/plugin-name:skill`), prompts MCP (`/mcp-server:prompt`, listés alphabétiquement après les skills) ; matching = préfixe du nom/alias ou d'un mot interne en ignorant `:`/`_`/`-` (`/adddir` → `/add-dir`, `/new` → `/clear` via alias) `[v2.1.236]` ; après une faute, rien n'est surligné, `Enter` soumet tel quel → « Unknown command » ; message « No commands match "/name" » ; commandes cachées (`/heapdump`) n'apparaissent qu'au nom complet ; fuzzy pour /commands dès `[v0.2.21/0.2.26]`, amélioré `[v2.0.35]`.
- Complétion mid-prompt : `/` après un espace + lettres (« run the tests, then /com ») ; fullscreen : liste sans ligne surlignée, `Tab` insère le top match ; classique : ghost text à la position du curseur avec compteur `+2`, `Tab` insère ou ouvre la liste ; `Tab` sur un `/` nu liste tout. Skill de plugin matché par nom nu (`/deploy` → `/myplugin:deploy-app`).
- Chaînage de skills : jusqu'à 6 skills inline (`/skill-a /skill-b do XYZ`) `[v2.1.199]`.
- Accessibilité clavier/lecteur d'écran des menus `/` et `@` améliorée `[v2.1.274]` ; en fullscreen, clic souris sur une ligne du menu `/` ou `@` l'accepte, hover la surligne.
— Sources : [IM](https://code.claude.com/docs/en/interactive-mode), [CM](https://code.claude.com/docs/en/commands), [SR](https://code.claude.com/docs/en/settings-reference), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 1.6 Queue de messages (taper pendant que Claude travaille)
- `[v0.2.75]` « Hit Enter to queue up additional messages while Claude is working ». Les entrées en attente sont listées au-dessus de l'input ; messages envoyés/queued affichés **en gris** jusqu'à ce que Claude commence à y répondre.
- Timing : un message queued pendant des tool calls est transmis dès la fin de ces tool calls, dans le même tour ; commandes `/` et `!` retenues jusqu'à la fin du tour, exécutées une par une dans l'ordre. Exceptions exécutées immédiatement : `/status`, `/tasks`, `/usage`, `/model`, `/effort`, `/fast` ; en fullscreen aussi les dialogues `/theme`, `/help` `[v2.1.234]`.
- `Ctrl+Enter` (ou `Ctrl+X Ctrl+S`) interrompt le tour et envoie immédiatement queue + brouillon ; en shell mode, queue la commande sans interrompre `[v2.1.275]`. `Esc` interrompt sans soumettre le brouillon mais envoie la queue.
- `Up` depuis la 1re ligne d'un input : reprend les messages queued dans l'input, un par ligne ; les commandes `!` ne sont reprises que si l'input est vide et rien d'autre en queue (bascule en shell mode).
- Action `chat:queueSubmit` (`Ctrl+X Enter`) `[v2.1.247]` : soumet en le marquant « attend son tour », même si une suggestion d'autocomplétion est surlignée.
- Un message queued qui rejoint un tour en cours **n'a pas de checkpoint** et n'apparaît pas dans le menu rewind.
— Sources : [IM](https://code.claude.com/docs/en/interactive-mode), [KB](https://code.claude.com/docs/en/keybindings), [CP](https://code.claude.com/docs/en/checkpointing), [CM](https://code.claude.com/docs/en/commands), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 1.7 Historique des prompts et Ctrl+R
- Historique stocké **par répertoire de travail**, `Up` atteint les prompts des sessions précédentes du même projet ; `/clear` démarre une nouvelle session (prompts de la nouvelle listés d'abord) ; doublons consécutifs = une seule entrée ; expansion `!` désactivée par défaut ; env `CLAUDE_CODE_SKIP_PROMPT_HISTORY`.
- `Up` après interruption restaure le prompt interrompu et rembobine en un geste `[v2.1.73]`.
- Ctrl+R (renderer classique, inline) : 1) Ctrl+R active, 2) taper (terme surligné), 3) Ctrl+R à nouveau cycle vers les plus anciens, 4) portée = tous les projets, 5) `Tab`/`Esc` accepte et continue l'édition, `Enter` accepte et exécute, 6) `Ctrl+C` annule et restaure, `Backspace` sur recherche vide annule. Doublons repliés sur l'occurrence la plus récente.
- Fullscreen : Ctrl+R ouvre un **dialogue** ; `Up/Down` navigue, `Ctrl+S` cycle la portée « this session / this project / all projects » (`historySearch:cycleScope`) ; `Enter`/`Tab` place le match dans l'input, `Esc` annule. Historique `[v2.1.129]` : « Ctrl+R history picker now defaults to searching all prompts across all projects… Press Ctrl+S to narrow ».
- En vim NORMAL, `/` ouvre la même recherche (hint sur prompt vide : « press Esc then i then / to open the command menu instead »).
— Sources : [IM](https://code.claude.com/docs/en/interactive-mode), [KB](https://code.claude.com/docs/en/keybindings), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 1.8 Suggestions de prompt (ghost text) et complétion Tab
- À l'ouverture, un exemple grisé tiré de l'historique git du projet ; après une réponse, suggestion du prochain prompt (requête background réutilisant le prompt cache). `Tab` ou `Right` place la suggestion, `Enter` envoie, taper la rejette. Désactivation : `/config` → « Prompt suggestions », `promptSuggestionEnabled:false`, env `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`. Suggestions sautées si cache froid, erreur précédente, plan mode, proche de la limite d'usage, sessions teammates.
- Spellcheck optionnel (aspell/hunspell/ispell) soulignant les fautes dans l'input `[v2.1.235]`, setting `spellcheck: {enabled, checker, language, color}`.
— Source : [IM](https://code.claude.com/docs/en/interactive-mode)

#### 1.9 Esc Esc / rewind (checkpointing)
- `/rewind` (alias `/checkpoint`, `/undo` `[v2.1.108]`) ou double `Esc` sur input vide ouvre le menu listant chaque prompt envoyé. Options exactes : **Restore code and conversation**, **Restore conversation**, **Restore code**, **Summarize from here**, **Summarize up to here**, **Never mind**. Les deux options code n'apparaissent que si des edits sont trackés. Après restore conversation / Summarize from here, le prompt original est remis dans l'input. Marqueur **Summarized conversation** inséré. Pour guider un résumé : surligner l'option, taper dans « add context (optional) », `Enter` ; choisir par touche numérique résume sans instruction.
- Entrée supplémentaire après `/clear` : `/resume <session-id> (previous session)` en tête de liste `[v2.1.191]`.
- Checkpoint à chaque prompt qui démarre un tour ; 100 checkpoints max ; snapshots purgés ~30 jours ; les modifications par Bash, subagents background, symlinks/hardlinks ne sont pas restaurées (warning « Restored the code, but skipped N files »).
- Navigation du sélecteur (contexte `MessageSelector`) : `Up/K/Ctrl+P`, `Down/J/Ctrl+N`, top `Ctrl+Up/Shift+Up/Meta+Up/Shift+K`, bottom `Ctrl+Down/…/Shift+J`, `Enter`.
- `[v2.0.0]` « /rewind a conversation to undo code changes » ; fix régression Esc Esc `[v2.1.196]`.
— Sources : [CP](https://code.claude.com/docs/en/checkpointing), [KB](https://code.claude.com/docs/en/keybindings), [CM](https://code.claude.com/docs/en/commands), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 1.10 Shift+Tab et modes de permission
- Cycle CLI : depuis `auto` le 1er appui va à `default` ; puis `default` → `acceptEdits` → `plan` → `default`. Modes optionnels insérés après `plan` : `bypassPermissions` d'abord (si lancé avec `--permission-mode bypassPermissions`, `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`), `auto` en dernier ; `dontAsk` jamais dans le cycle.
- Libellés exacts de la barre d'état : gris `⏸ manual mode on` pour `default` (nommé **Manual** dans l'UI), `⏵⏵ accept edits on`, `⏸ plan mode on`, `⏵⏵ auto mode on`, `⏵⏵ don't ask on`, `⏵⏵ bypass permissions on`.
- Tokens de thème associés : `planMode` (accent + dialogues plan), `autoAccept` (accent accept-edits), `warning` (indicateur auto mode), `promptBorder` (bordure input), `bashBorder` (bordure en mode `!`), `effortUltra` (tag `ultracode` sur la bordure).
- Dialogue d'approbation de plan : **Yes, and use auto mode** (ou **Yes, auto-accept edits** si auto indisponible, ou **Yes, and switch to BYPASS PERMISSIONS (no further prompts) for this session** si bypass activé), **Yes, manually approve edits**, **No, keep planning**. `Shift+Tab` dans le plan mode sélectionne rapidement « auto-accept edits » `[v2.1.2]`. `/plan [description]` entre en plan mode.
- Historique : `[v0.2.47]` « Press Shift + Tab to toggle auto-accept for file edits » ; Windows : `alt+m` remplacé par shift+tab en natif `[v2.0.31]` ; `Alt+M` reste le défaut sans mode VT (Node < 24.2.0/22.17.0, Bun < 1.2.23).
- Sur un prompt de permission de fichier, `Shift+Tab` ferme un champ commentaire ouvert, sinon sélectionne l'option « allow for the rest of the session ». Prompt Bash : option **Yes, and switch to auto mode** `[v2.1.247]`.
— Sources : [PM](https://code.claude.com/docs/en/permission-modes), [IM](https://code.claude.com/docs/en/interactive-mode), [TC](https://code.claude.com/docs/en/terminal-config), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 1.11 Mode vim (`/config` → Editor mode ; `/vim` supprimé en v2.1.92)
- Activation : `/config` → Editor mode ou `editorMode: "vim"` ; `/vim` « Removed in v2.1.92 ». Origine `[v0.2.34]` « Vim bindings for text input - enable with /vim or /config ». Indicateur `-- INSERT --` sous le prompt (masquable via `statusLine.hideVimModeIndicator`), champ `vim.mode` = `NORMAL`|`INSERT`|`VISUAL`|`VISUAL LINE` dans le JSON statusline.
- Mode switching : `Esc`/`Ctrl+[` → NORMAL ; `i`, `I`, `a`, `A`, `o`, `O`, `v`, `V`. `Enter` soumet même en INSERT (contrairement à vim) ; newline via `o`/`O` ou Ctrl+J.
- Navigation NORMAL : `h/j/k/l`, `Space`, `w`, `e`, `b`, `0`, `$`, `^`, `gg`, `G`, `f{c}`, `F{c}`, `t{c}`, `T{c}`, `;`, `,`, `/` (history search). En bord d'input, `j/k`/`↑/↓` naviguent l'historique ; `←` sur prompt vide ouvre agent view.
- Édition NORMAL : `x`, `dd`, `D`, `dw/de/db`, `df{c}/dt{c}`, `cc`, `C`, `cw/ce/cb`, `s` et `S` `[v2.1.211]`, `yy/Y`, `yw/ye/yb`, `p`, `P`, `>>`, `<<`, `J`, `u`, `.`.
- Text objects : `iw/aw`, `iW/aW`, `i"/a"`, `i'/a'`, `i(/a(`, `i[/a[`, `i{/a{`.
- VISUAL : `d/x`, `y`, `c/s`, `p`, `r{char}`, `~/u/U`, `>/<`, `J`, `o`, text objects, `v/V` toggle/exit. **Block-wise `Ctrl+V` non supporté.**
- `vimInsertModeRemaps: {"jj": "<Esc>"}` `[v2.1.208]` : séquence de 2 caractères imprimables, fenêtre 1 s, `<Esc>` seule cible ; lu uniquement depuis user/`--settings`/managed (jamais projet).
- Le mode et la position du curseur persistent quand on ouvre `Ctrl+O` ou `/config`. Vim et keybindings sont indépendants ; les touches vim ne sont pas remappables via keybindings.json ; `?` en NORMAL = aide, `/` = history search.
- Menus navigables `j/k` ou `Ctrl+n/p` dès `[v0.2.61]`.
— Sources : [IM](https://code.claude.com/docs/en/interactive-mode), [KB](https://code.claude.com/docs/en/keybindings), [TC](https://code.claude.com/docs/en/terminal-config), [CM](https://code.claude.com/docs/en/commands), [SL](https://code.claude.com/docs/en/statusline), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 1.12 keybindings.json (`~/.claude/keybindings.json`) `[v2.1.18]`
- `/keybindings` crée/ouvre le fichier ; rechargement automatique sans redémarrage ; schéma `https://www.schemastore.org/claude-code-keybindings.json` ; structure `{ "$schema", "$docs", "bindings": [ { "context": "Chat", "bindings": { "ctrl+e": "chat:externalEditor", "ctrl+u": null } } ] }`.
- 22 contextes : `Global`, `Chat`, `Autocomplete`, `Settings`, `Confirmation`, `Tabs`, `Help`, `Transcript`, `HistorySearch`, `Task`, `ThemePicker`, `Attachments`, `Footer`, `MessageSelector`, `DiffDialog`, `DiffPanel`, `ModelPicker`, `EffortSlider`, `Select`, `Plugin`, `Agents`, `Scroll` (ancien `Doctor` retiré en v2.1.205).
- Actions et défauts, Global : `app:interrupt` Ctrl+C, `app:exit` Ctrl+D (2× en 800 ms), `app:redraw` (unbound), `app:toggleTodos` Ctrl+T, `app:toggleTranscript` Ctrl+O ; History : `history:search` Ctrl+R, `history:previous` Up, `history:next` Down.
- Chat : `chat:cancel` Escape ; `chat:clearInput` Ctrl+L ; `chat:clearScreen` Cmd+K ; `chat:killAgents` Ctrl+X Ctrl+K ; `chat:cycleMode` Shift+Tab ; `chat:modelPicker` Meta+P ; `chat:fastMode` Meta+O ; `chat:thinkingToggle` Meta+T ; `chat:submit` Enter ; `chat:queueSubmit` Ctrl+X Enter ; `chat:sendNow` Ctrl+Enter / Ctrl+X Ctrl+S ; `chat:newline` Ctrl+J ; `chat:undo` Ctrl+_ / Ctrl+Shift+- ; `chat:externalEditor` Ctrl+G / Ctrl+X Ctrl+E ; `chat:stash` Ctrl+S ; `chat:imagePaste` Ctrl+V (Alt+V Windows/WSL) ; `voice:pushToTalk` Space.
- Autocomplete : `accept` Tab, `dismiss` Escape, `previous` Up, `next` Down. Confirmation : `confirm:yes` Enter, `confirm:no` Escape, `previous/next` Up/Down, `nextField` Tab, `toggle` Space, `cycleMode` Shift+Tab (`y`/`n` n'étaient plus liés par défaut depuis v2.1.280 ; `confirm:toggleExplanation` Ctrl+E retiré en v2.1.257).
- Transcript : `toggleShowAll` Ctrl+E (classique seulement), `exit` q/Ctrl+C/Escape. HistorySearch : `next` Ctrl+R, `accept` Escape/Tab, `cancel` Ctrl+C, `execute` Enter, `cycleScope` Ctrl+S. Task : `task:background` Ctrl+B / Ctrl+X Ctrl+B. ThemePicker : `theme:toggleSyntaxHighlighting` Ctrl+T. Help : `help:dismiss` Escape. Tabs : `next` Tab/Right, `previous` Shift+Tab/Left. Attachments : Right/Left, `remove` Backspace/Delete, `exit` Down/Escape. Footer : Right/Left/Up/Down, `openSelected` Enter, `clearSelection` Escape, `dismiss` Backspace/Delete `[v2.1.217]`.
- Select (listes génériques) : `next` Down/J/Ctrl+N, `previous` Up/K/Ctrl+P, `pageUp/pageDown` PageUp/PageDown, `first/last` Home/End (respectés dans `/skills`, `/model`… depuis v2.1.280), `accept` Enter, `cancel` Escape. Settings : `settings:search` `/`, `settings:retry` R, `select:accept` Enter/Space, `confirm:no` Escape (changements déjà sauvés). ModelPicker : `decreaseEffort` Left, `increaseEffort` Right, `thisSessionOnly` s. EffortSlider : `thisSessionOnly` s. Plugin : `toggle` Space, `install` I, `favorite` F. Agents : `switchView` Ctrl+S, `togglePin` Ctrl+T. DiffDialog : `dismiss` Escape, `previousSource/nextSource` Left/Right, `previousFile/nextFile` Up/K, Down/J, `viewDetails` Enter, plus pager `scroll:*`. DiffPanel : `app:cycleDiffBase` Ctrl+X B, `app:diffFileListUp/Down` Ctrl+Up/Meta+Up, Ctrl+Down/Meta+Down.
- Scroll (fullscreen) : `lineUp/lineDown` wheelup/wheeldown, `pageUp/pageDown` PageUp/PageDown (demi-écran), `top/bottom` Ctrl+Home/Ctrl+End, `halfPage*`/`fullPage*` unbound, `selection:copy` Ctrl+Shift+C / Cmd+C, `selection:clear` unbound `[v2.1.234]`, `selection:extendLeft/Right/Up/Down` Shift+flèches, `extendLineStart/End` Shift+Home/End.
- Syntaxe : modificateurs `ctrl|control`, `shift`, `alt|opt|option|meta`, `cmd|command|super|win` (cmd seulement sous kitty-protocol/modifyOtherKeys) ; touches `escape|esc`, `enter|return`, `tab`, `space`, `up/down/left/right`, `pageup/pagedown`, `home/end`, `backspace/delete`, `wheelup/wheeldown` ; insensible à la casse (`shift+k` pour majuscule) ; chords séparés par espace (`ctrl+k ctrl+s`), **3 s** entre touches sinon annulé avec notice. Chords par défaut sur préfixe `ctrl+x` : `ctrl+k`, `ctrl+e`, `enter`, `ctrl+a`, `ctrl+s`, `tab` (Chat), `ctrl+b` (Task), `b` (DiffPanel).
- Unbind : valeur `null`. Réservés non remappables : Ctrl+C, Ctrl+D, Ctrl+M (=Enter), Ctrl+[ (=Escape), Ctrl+I (=Tab), Ctrl+H (backspace byte), Caps Lock. Conflits : Ctrl+B (tmux), Ctrl+A (screen), Ctrl+Z (SIGTSTP).
- Validation : erreurs de parse, contexte inconnu, action inconnue (binding ignoré, défaut conservé depuis v2.1.246), conflits réservés, doublons → warnings au chargement + debug log (`--debug`).
— Source : [KB](https://code.claude.com/docs/en/keybindings)

### Inferences
- Le modèle mental de Claude Code = « readline + vim optionnel + contextes UI nommés » ; pour Fuller, reproduire la table des contextes (`Chat`, `Autocomplete`, `Confirmation`, `Select`, `Transcript`, `HistorySearch`, `Footer`, `Scroll`) est le squelette naturel d'un système de keybindings.
- Plusieurs comportements sont conditionnés par le terminal (Shift+Enter, Ctrl+Enter, Cmd, Option-as-Meta) : Claude Code fournit toujours une alternative universelle (`Ctrl+J`, `Ctrl+X Ctrl+S`, `\`+Enter) — pattern à copier.
- Le seuil de repli des collages (800 chars / 3 lignes) et le cache `paste-cache/` sont des détails concrets facilement reproductibles.

### Gaps
- Le contenu exact du panneau d'aide `?` (liste et ordre des lignes) n'est pas reproduit dans la doc ; seules les entrées de footer `? for shortcuts`, `esc to interrupt`, `hold space to speak` sont citées.
- Le comportement précis du préfixe `#` en 2026 (dialogue de choix entre CLAUDE.md projet/utilisateur, libellés) n'est pas documenté dans les pages consultées (interactive-mode ne liste plus `#` dans « Quick commands » ; seul le CHANGELOG v0.2.54 et le token de thème `memoryBackgroundColor` l'attestent).
- L'algorithme exact de fuzzy matching des `@` (score, nombre de lignes affichées) n'est pas documenté au-delà de « native Rust-based fuzzy finder » (v2.0.34).

---

## Question 2 — Statut & feedback (status line, spinner, indicateurs, titre, notifications, thèmes, splash)

### Takeaway
Le footer de Claude Code combine : un mode indicator (`⏸ manual mode on`…), des hints (`esc to interrupt`, `? for shortcuts`), un badge PR/MR cliquable, un avertissement « Context left until auto-compact: X% », et optionnellement une **status line scriptée** recevant un JSON riche sur stdin (modèle, cwd, coût, context %, rate limits, prompt cache, vim mode, PR) ; le spinner tire un verbe aléatoire (~187 dans le code fuité, « Accomplishing », « Baking »…) avec shimmer, temps écoulé, tokens et tips ; la fin de tour affiche `✻ Sautéed for 23s · done 6:05 PM`.

### Cited Findings

#### 2.1 Status line personnalisée (`/statusline`) `[v1.0.71]`
- `/statusline <description en langage naturel>` génère un script dans `~/.claude/` et met à jour settings ; sans argument, « auto-configure from your shell prompt » ; suppression via `/statusline delete|clear|remove it`.
- Config : `"statusLine": { "type": "command", "command": "~/.claude/statusline.sh", "padding": 2, "refreshInterval": N, "hideVimModeIndicator": true }` (padding défaut 0 ; refreshInterval min 1 s ; hideVimModeIndicator masque `-- INSERT --`).
- Rendu : ligne(s) propre(s) **au-dessus des badges du footer**, ne les remplace pas ; avec une status line, Claude Code cesse d'afficher la plupart des hints clavier (`esc to interrupt`, `? for shortcuts`, `hold space to speak`) (fix v2.1.169 : les hints étaient absents pour les utilisateurs avec statusline custom). Multi-lignes (chaque `echo` = une ligne), couleurs ANSI, liens OSC 8 cliquables. Masquée temporairement pendant autocomplete, menu d'aide, prompts de permission. `COLUMNS`/`LINES` fournis en env (pas de `tput cols`).
- Déclencheurs : au démarrage/resume, nouveau message assistant, fin de `/compact`, changement de mode de permission, toggle vim, changement de `command`, timer `refreshInterval`, passage d'un `resets_at` ou `expires_at`. Debounce **300 ms** ; script en cours annulé si nouveau trigger.
- JSON stdin (schéma complet) : `cwd`, `session_id`, `session_name`, `prompt_id` `[v2.1.196]`, `transcript_path`, `model.{id,display_name}`, `workspace.{current_dir,project_dir,added_dirs,git_worktree,repo.{host,owner,name}}`, `version`, `output_style.name`, `cost.{total_cost_usd,total_duration_ms,total_api_duration_ms,total_lines_added,total_lines_removed}`, `context_window.{total_input_tokens,total_output_tokens,context_window_size,used_percentage,remaining_percentage,current_usage.{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}}`, `exceeds_200k_tokens`, `prompt_cache.{warm,caching_observed,ttl,expires_at,requests,misses,expected_rebuilds,hit_ratio,cache_write_tokens,miss_recache_tokens,last_miss_at,last_miss_cause,miss_causes,recache_tokens_if_cold}` `[v2.1.251/2.1.260]`, `fast_mode`, `effort.level` (`low|medium|high|xhigh|max`), `thinking.enabled`, `rate_limits.{five_hour,seven_day,spend_limit}.{used_percentage,resets_at}`, `vim.mode`, `agent.name`, `pr.{number,url,review_state,kind}`, `worktree.{name,path,branch,original_cwd,original_branch}`. Note : **la branche git n'est pas fournie** — les exemples officiels l'obtiennent via `git branch --show-current`. `used_percentage` = input + cache_creation + cache_read (sans output). `cost.total_cost_usd` remis à 0 au `/clear` depuis v2.1.211.
- Historique : coût ajouté `[v1.0.85]`, `exceeds_200k_tokens` `[v1.0.88]`, context window `[v2.0.65]`.
- `footerLinksRegexes` (user/managed) : transforme des IDs en badges cliquables sous l'input sans script.
— Sources : [SL](https://code.claude.com/docs/en/statusline), [CM](https://code.claude.com/docs/en/commands), [SR](https://code.claude.com/docs/en/settings-reference), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 2.2 Spinner, verbes, temps écoulé, tokens, tips, durée de tour
- Doc officielle : « While a turn is in progress, the spinner shows a rotating verb such as "Accomplishing", "Architecting", or "Baking" ». Setting `spinnerVerbs: { "mode": "append"|"replace", "verbs": ["Pondering","Crafting"] }` `[v2.1.23]` ; les verbes custom ne s'appliquent pas au message de fin de tour (past-tense built-ins « Worked for 5s » restaurés v2.1.144).
- Fuite du source map (v2.1.88, 1er avril 2026, fichier `.map` de 59,8 Mo) : **187 verbes** ; extraits cités par Wes Bos : « Accomplishing, Actioning, Actualizing, Architecting, Baking, Beaming, Beboppin', Befuddling, Billowing, … Clauding, Combobulating, Discombobulating, … Zesting, Zigzagging », plus « Hullaballooing », « Flibbertigibbeting », « Razzle-dazzling », « Photosynthesizing », « Quantumizing », « Reticulating ». ⚠️ Le dépôt « claude-spinner-simulator » (atalovesyou) affiche une liste de 187 mots en minuscules génériques (« thinking », « analyzing », « processing » ×2, « calibrating » ×2) qui **ne correspond pas** aux verbes capitalisés cités par Wes Bos ni aux exemples de la doc — liste à considérer comme non fiable.
- Spinner : « New shimmering spinner » `[v1.0.83]` ; « Updated spinner to indicate tokens loaded and tool usage » `[v0.2.72]` ; niveau d'effort affiché dans le logo et le spinner (« with low effort ») `[v2.1.69]` ; statut de thinking : « thinking » → « still thinking »/« almost done thinking » (fix v2.1.152), « deep in thought » après **45 s**, « picking the thought back up » lors d'une récupération de limite d'output `[v2.1.271]` ; la ligne de thinking se re-rend « every few seconds to update elapsed time and token counts » (v2.1.217, mode lecteur d'écran) ; pendant un hook SessionStart/UserPromptSubmit/PreToolUse/SessionEnd, le spinner l'indique `[v2.1.279]`. Tokens de thème : `claude`/`claudeShimmer` pour le spinner, `prefersReducedMotion` coupe spinner/shimmer/flash.
- Tips dans le spinner : `spinnerTipsEnabled` (défaut true) `[v1.0.112]`, `spinnerTipsOverride: { tips: [string | {id,text,cooldownSessions,priority}], tipsFile, label (défaut "Tip"), excludeDefault }` `[v2.1.45 ; objets v2.1.247]`, ≤ 200 tips ; affichage `Tip: …` ou `Acme tip: …`.
- Fin de tour : message de durée type « Cooked for 1m 6s » (`showTurnDuration`, `[v2.1.7]`, toggle `/config` « Show turn duration » v2.1.79) ; format actuel `✻ Sautéed for 23s · done 6:05 PM` `[v2.1.246]` (heure via `timeFormat` : `auto|12-hour|24-hour|24-hour-utc|strftime`).
- Hints du footer : `esc to interrupt` (masqué à tort à côté de `esc to clear` en cas de sélection, fix v2.1.92), `? for shortcuts`, `hold space to speak` ; notice « Update installed » (restart) après auto-update en arrière-plan `[v2.1.235]` ; « Usage limit reached · continuing automatically at 3:45pm · esc to cancel » ; sélection IDE affichée comme pill `[⧉ …]` `[v2.1.273]`.
— Sources : [SR](https://code.claude.com/docs/en/settings-reference), [IM](https://code.claude.com/docs/en/interactive-mode), [SL](https://code.claude.com/docs/en/statusline), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [Wes Bos](https://wesbos.com/tip/claude-code-source-leaked), [claudefa.st](https://claudefa.st/blog/guide/mechanics/claude-code-source-leak), [spinner-simulator](https://github.com/atalovesyou/claude-spinner-simulator)

#### 2.3 Indicateur « Context left until auto-compact »
- Texte exact « Context left until auto-compact: X% » dans le footer ; bug de rendu vertical documenté (issue #22156) ; fix « warning not disappearing after running /compact » `[v2.1.15]` ; seuil d'alerte passé de 60 % à 80 % `[v1.0.51]` ; compaction instantanée `[v2.0.64]` ; `/autocompact [auto|<tokens>]` règle la fenêtre (hint footer ←/→ v2.1.280) ; `autoCompactEnabled` (défaut true) ; `/context` = grille colorée d'usage.
— Sources : [GitHub issue #22156](https://github.com/anthropics/claude-code/issues/22156), [CM](https://code.claude.com/docs/en/commands), [SR](https://code.claude.com/docs/en/settings-reference), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 2.4 Titre du terminal et progress bar OSC
- Titre mis à « Claude Code » au démarrage `[v2.1.6]` ; animation braille à largeur fixe dans le titre pendant le travail `[v2.1.7]` ; nom d'agent dans le titre avec `--agent` `[v2.1.69]` ; titre généré depuis la conversation, remplacé par le nom `/rename`/`--name` (`terminalTitleFromRename`, défaut true) ; désactivation totale `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` (fixes v2.1.72/2.1.79).
- Progress bar de terminal (OSC 9;4) `[v2.0.56]` : `terminalProgressBarEnabled` (défaut true, `/config` « Terminal progress bar ») ; supporté par ConEmu, Ghostty ≥ 1.2.0, iTerm2 ≥ 3.6.6 ; reste visible tant que des subagents background tournent ; passe tmux avec `allow-passthrough`.
— Sources : [SR](https://code.claude.com/docs/en/settings-reference), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 2.5 Notifications
- Événement Notification déclenché quand Claude termine ou attend une permission et que l'utilisateur semble absent. `preferredNotifChannel` (dans `/config` : **Local notifications**), valeurs : `"auto"` (défaut : desktop notif sur iTerm2/Ghostty/Kitty, bell sur Terminal.app seulement si bell audible off, rien ailleurs), `"terminal_bell"`, `"iterm2"`, `"iterm2_with_bell"`, `"kitty"`, `"ghostty"`, `"notifications_disabled"`.
- iTerm2 : Settings → Profiles → Terminal → « Notification Center Alerts » + « Send escape sequence-generated alerts » ; tmux : `allow-passthrough on` ; hook `Notification` (ex. `afplay /System/Library/Sounds/Glass.aiff`) en complément. Fix « excessive iTerm notifications » `[v2.0.54]`.
— Sources : [TC](https://code.claude.com/docs/en/terminal-config), [SR](https://code.claude.com/docs/en/settings-reference), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 2.6 Thèmes (`/theme`)
- Valeurs `theme` : `"auto"` (détecte fond clair/sombre, suit l'OS), `"dark"` (défaut), `"light"`, `"dark-daltonized"`, `"light-daltonized"`, `"dark-ansi"`, `"light-ansi"`, `"custom:<slug>"` / `"custom:<plugin>:<slug>"`. ANSI theme dès `[v0.2.30]` ; picker amélioré et `/theme` ouvre directement le picker `[v2.0.73]` ; `Ctrl+T` dans le picker = syntax highlighting.
- Thèmes custom : `~/.claude/themes/<slug>.json` `{ name, base, overrides }`, entrée **New custom theme…** en fin de liste, `Ctrl+E` pour éditer, hot-reload du dossier. Couleurs `#rrggbb`, `#rgb`, `rgb()`, `ansi256(n)`, `ansi:<name>`.
- Tokens notables : `claude` (accent/spinner), `text`, `inactive`, `subtle`, `suggestion` (autocomplete + sélection), `permission` (bordures de dialogues), `remember` (mémoire/CLAUDE.md), `success/error/warning/merged`, `promptBorder`, `planMode`, `autoAccept`, `bashBorder`, `ide`, `fastMode`, `effortUltra`, `diffAdded/Removed(+Dimmed, +Word)`, `userMessageBackground`, `bashMessageBackgroundColor`, `memoryBackgroundColor`, `selectionBg`, `rate_limit_fill/empty`, `briefLabelYou/Claude`, `*Shimmer`, `<color>_FOR_SUBAGENTS_ONLY` (8 couleurs), `rainbow_<color>` pour le mot `ultrathink` (dégradé 7 couleurs dans l'input).
- `/color [red|blue|green|yellow|purple|orange|pink|cyan|default]` : couleur de la prompt bar pour la session.
— Sources : [SR](https://code.claude.com/docs/en/settings-reference), [TC](https://code.claude.com/docs/en/terminal-config), [CM](https://code.claude.com/docs/en/commands), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 2.7 Écran d'accueil, tips de démarrage, onboarding
- Bannière « welcome banner/splash » contenant logo (« welcome splash art » pouvant déborder en 80×24, fix v2.1.191), modèle + effort (« with low effort », v2.1.69), cwd (masquable `CLAUDE_CODE_HIDE_CWD` v2.1.119), type de facturation/fournisseur (« API Usage Billing » ou nom du provider, v2.1.141), au plus un bandeau promo (v2.1.179), splash de release notes après upgrade (v2.1.121), texte « Welcome back! » et « Tips for getting started » (cours CodeSignal). Le header se met à jour au changement de modèle (fix v2.1.75).
- Guide débutant officiel : « Press Esc to interrupt », « Type exit or press Ctrl + D twice on an empty prompt to leave », « Type /help ». Le prompt de première exécution propose `/terminal-setup` (Apple Terminal : Option-as-Meta + bell off).
- Dialogue de démarrage proposant le fullscreen (« Not now » ; au plus 3 affichages) ; recap de session au retour après ≥ 3 min d'absence (≤ 400 caractères, `/recap`, toggle `/config` « Session recap »).
- `/release-notes` : picker de versions interactif ; `/powerup` : leçons interactives animées ; `/buddy` : « terminal companion pet » (cheat sheet Blake Crosley, non retrouvé dans la table officielle consultée).
— Sources : [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [CodeSignal](https://codesignal.com/learn/courses/foundation-getting-started-with-claude-code/lessons/starting-claude-code-sessions), [TG](https://code.claude.com/docs/en/terminal-guide), [TC](https://code.claude.com/docs/en/terminal-config), [FS](https://code.claude.com/docs/en/fullscreen), [IM](https://code.claude.com/docs/en/interactive-mode), [CM](https://code.claude.com/docs/en/commands), [Blake Crosley](https://blakecrosley.com/guides/claude-code-cheatsheet)

#### 2.8 Boîte d'input, footer, badges
- Bordure de l'input colorée par `promptBorder` (shimmer), `bashBorder` en mode `!`, tag `ultracode` sur la bordure ; nom de session `/rename` affiché « on the prompt bar » ; fix « prompt box's top border splitting into extra lines » (v2.1.269/271).
- Footer : badge PR « PR #446 » (souligné vert approved / jaune pending / rouge changes requested / gris draft), `MR !N` GitLab `[v2.1.234]`, hints `install gh for PR status` / `gh auth login for PR status`, `/rc active` (Remote Control, masqué sur terminaux étroits, v2.1.172), panneau d'agents sous le prompt navigable via contexte `Footer` (Left/Right/Up/Down/Enter/Escape/Backspace), liens issue `owner/repo#123` cliquables (`FORCE_HYPERLINK`).
- Rendu des messages : fond `userMessageBackground` ; `Ctrl+O` ajoute timestamp + modèle ; `/focus` (vue réduite), `viewMode` = `default|verbose|focus`, `verbose` setting ; `showThinkingSummaries`.
— Sources : [TC](https://code.claude.com/docs/en/terminal-config), [IM](https://code.claude.com/docs/en/interactive-mode), [SR](https://code.claude.com/docs/en/settings-reference), [KB](https://code.claude.com/docs/en/keybindings), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

### Inferences
- Le JSON de status line est un bon contrat à imiter tel quel (noms de champs stables, absence explicite de `git_branch` compensée par le script) ; un clone compatible permettrait de réutiliser les scripts `statusline.sh` existants de la communauté.
- La logique « hints du footer disparaissent quand une status line est configurée » et « status line masquée pendant autocomplete/aide/permission » évite les collisions verticales — à reproduire.
- Le spinner combine 4 informations (verbe aléatoire + ellipsis, temps écoulé, compteur de tokens, tip) et change de texte selon la phase (thinking/tool/hook) ; la valeur ajoutée est surtout le changement de message après 45 s.

### Gaps
- Liste complète et exacte des 187 verbes : non disponible dans une source fiable accessible (Medium bloqué en 403 ; le simulateur GitHub est douteux). Seuls les extraits de Wes Bos et de la doc sont sûrs.
- Format précis de la ligne du spinner (ordre « verbe… (12s · ↓ 1.2k tokens · esc to interrupt) », caractères d'animation, intervalle) : non décrit textuellement dans les docs ; seules les composantes sont attestées séparément.
- Contenu exact des « Tips for getting started » 2026 et de la bannière (mise en page du logo) : non trouvé dans les docs officielles (seule mention indirecte via cours tiers et changelog).

---

## Question 3 — Autres widgets interactifs (dialogues, pickers, auto-updater, /doctor, resize, fullscreen)

### Takeaway
Claude Code s'appuie sur des listes/sélecteurs génériques (contexte `Select` : ↑/↓, j/k, Ctrl+N/P, PageUp/Down, Home/End, Enter, Esc, clic souris en fullscreen), un picker `/resume` avec recherche par saisie et portées Ctrl+A/Ctrl+W/Ctrl+B, un picker `/model` avec slider d'effort et touche `s` « session only », un panneau `/config` avec recherche `/`, et un renderer fullscreen (alt-screen) optionnel qui apporte souris, sélection, scroll interne et une gestion explicite du resize.

### Cited Findings

#### 3.1 Dialogues de confirmation / permission
- Contexte `Confirmation` : `Enter` = oui, `Esc` = non/décline, ↑/↓ options, `Tab` = champ suivant (ouvre le champ commentaire sur Yes/No), `Space` = toggle, `Shift+Tab` = cycle mode / sélectionne « allow for session ». Depuis v2.1.280, un `y`/`n` isolé ne confirme/ferme plus les dialogues ; Ctrl+C/Ctrl+D ×2 ferment le dialogue au lieu de quitter (v2.1.280). Bordures = token `permission`. Une explication de commande (Ctrl+E) a existé jusqu'à v2.1.257.
- Multi-select : clic pour toggler, bouton submit, ligne « Other » à saisie libre (fullscreen ≥ v2.1.208). AskUserQuestion : notes de preview attachées à l'option surlignée (fix v2.1.274) ; Ctrl+G dans le champ « Other » `[v2.1.9]`.
- `/btw` overlay : `Space/Enter/Esc` ferme, ↑/↓ scroll, `Shift+Left/Right` ou `[`/`]` ou `Tab/Shift+Tab` entre réponses, `c` copie, `f` fork en subagent, `x` vide l'historique.
— Sources : [KB](https://code.claude.com/docs/en/keybindings), [IM](https://code.claude.com/docs/en/interactive-mode), [FS](https://code.claude.com/docs/en/fullscreen), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 3.2 Picker `/resume` (et `claude --resume`)
- Touches : `↑/↓` naviguer ; `→/←` déplier/replier les groupes (forks) ; `Enter` reprendre ; `Space` (ou `Ctrl+V`) prévisualiser ; `Ctrl+R` renommer ; `/` ou tout caractère imprimable = mode recherche (filtre ; coller une URL de PR/MR GitHub/GitLab/Bitbucket retrouve la session) ; `Ctrl+A` = tous les projets ; `Ctrl+W` = tous les worktrees (repos multi-worktree seulement) ; `Ctrl+B` = filtre branche git courante ; `Esc` quitte.
- Chaque ligne : nom/titre IA/résumé/premier prompt, temps depuis dernière activité, branche git, taille du fichier ; `bg` pour les sessions background ; chemin projet en mode Ctrl+A. Sessions `-p`/SDK exclues. Sessions ambiguës par nom → picker pré-rempli. Fix « only 1–2 sessions in fullscreen on short terminals » (v2.1.271) ; sélection souris copiable (v2.1.275).
- Historique : `/resume` `[v1.0.27]` ; groupes de forks + raccourcis P (preview) et R (rename) `[v2.0.64]` ; `/rename` et sessions nommées `[v2.0.64]`.
- Dialogue « Resume from summary » (Pro/Max, session > 100k tokens inactive > 1 h) : **Resume from summary**, **Resume full session as-is**, **Don't ask me again**.
— Sources : [SE](https://code.claude.com/docs/en/sessions), [CM](https://code.claude.com/docs/en/commands), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 3.3 Picker `/model`, slider `/effort`, `/fast`
- `/model` sans argument ouvre le picker : lignes = nom (« Opus 5.5 », « Sonnet 5 »), description, prix (API Anthropic seulement), labels **Org default**, **Requires usage credits**, **Set by ANTHROPIC_DEFAULT_MODEL**, **(auto-updated)**, lignes grisées avec raison. `Enter` = change et sauvegarde comme défaut ; `s` = session seulement `[v2.1.257]` ; `Left/Right` = effort inline (« with high effort »). Avertissement de cache avant application mid-session. Alias : `default`, `best`, `fable`, `opus`, `sonnet`, `haiku`, `opus[1m]`, `sonnet[1m]`, `opusplan`. `Alt+P/Option+P` ouvre le picker sans vider le prompt.
- `/effort` sans argument = slider `low/medium/high/xhigh/max/ultracode` (Left/Right, Enter, `s`), touches Left/Right/Enter/Esc non remappables. `/fast` : footer nomme `Space` comme touche de toggle (v2.1.280).
- Thinking : `Alt+T` ; blocs de thinking en gris italique, `Ctrl+O` pour déplier.
— Sources : [MC](https://code.claude.com/docs/en/model-config), [KB](https://code.claude.com/docs/en/keybindings), [CM](https://code.claude.com/docs/en/commands), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 3.4 `/config`, `/permissions`, `/skills`, `/copy`, `/export`, `/tasks`
- `/config [key=value …]` : panneau de settings (onglets ; `/status` ouvre l'onglet Status) ; `/` = recherche, `R` = retry usage, `Enter/Space` = change/ouvre sous-menu, `Esc` = ferme (déjà sauvé), Home/End (v2.1.280), `Tab` ne change plus la valeur (v2.1.280), molette + clic en fullscreen (v2.1.271). Entrées nommées : Editor mode, Theme, Time format, Prompt suggestions, Show turn duration, Session recap, Terminal progress bar, Local notifications, Copy on select, Auto-scroll, Show last response in external editor, Continue automatically at usage limit, Reduce motion.
- `/permissions` : onglets (←/→ et Tab changent d'onglet, v2.1.280), règles allow/ask/deny par scope, focus revenant à la liste après action.
- `/skills` : filtre par saisie, `t` tri par tokens, `Space`/`Enter` cycle visibilité, `Esc` sauve ; molette (v2.1.280), PgUp/PgDn ne bouclent plus.
- `/copy [N]` : picker de blocs de code, `w` pour écrire dans un fichier ; `/export [filename]` : dialogue clipboard/fichier ; `/tasks` (alias `/bashes`) : travaux background ; `/diff` : viewer (classique : Left/Right sources, Up/Down fichiers, Enter, Esc) ou panneau latéral fullscreen (≥ 110 colonnes, auto-ouverture ≥ 144 colonnes, `✕` pour fermer, `Ctrl+X B` cycle la base) `[v2.1.260]`.
— Sources : [KB](https://code.claude.com/docs/en/keybindings), [CM](https://code.claude.com/docs/en/commands), [IM](https://code.claude.com/docs/en/interactive-mode), [SR](https://code.claude.com/docs/en/settings-reference), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 3.5 Auto-updater et `/doctor`
- Auto-update en arrière-plan ; notice « Update installed » dans le footer du prompt invitant à redémarrer (fix v2.1.235) ; `autoUpdatesChannel` = `"stable"`|`"latest"` (défaut latest) ; env `DISABLE_AUTOUPDATER` ; `/doctor` (alias `/checkup`, skill bundled) diagnostique installation, PATH, settings invalides, skills/MCP inutilisés, et affiche la section « Updates » (canal + versions npm stable/latest) `[v2.1.6]` et la raison d'une désactivation de l'auto-updater `[v2.0.67]`. Les agents background se mettent à jour seuls après une mise à jour (v2.1.206).
— Sources : [SR](https://code.claude.com/docs/en/settings-reference), [CM](https://code.claude.com/docs/en/commands), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 3.6 Fullscreen rendering (`/tui fullscreen`) et gestion du resize
- Renderer alternatif sur l'alternate screen buffer (comme vim/htop) : input fixé en bas, seuls les messages visibles sont rendus (mémoire constante), pas de flicker ; activation `/tui fullscreen|default` (setting `tui`), `CLAUDE_CODE_NO_FLICKER=1`, `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` ; défaut fullscreen pour les comptes créés après le 6 mai 2026 (ou première install ≥ v2.1.239 sans feature flags) ; relance de la session intacte lors du switch ; détection des démarrages échoués (messages « Claude Code's fullscreen renderer didn't finish starting last time on this machine » / « …has repeatedly failed to start… »).
- Souris : clic pour positionner le curseur, clic sur suggestion `/`/`@`, clic sur option de select (v2.1.187), clic pour déplier un tool result, `Cmd`/`Ctrl`+clic sur URL/chemin, drag pour sélectionner (double-clic mot, triple-clic ligne), copie auto au relâchement (`copyOnSelect`), `Ctrl+Shift+C`/`Cmd+C`, molette (vitesse `CLAUDE_CODE_SCROLL_SPEED`, `/scroll-speed` avec règle : ←/→, `r` reset, Enter), `CLAUDE_CODE_DISABLE_MOUSE=1`, `CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1` (v2.1.195). Toast après chaque copie indiquant le canal (pbcopy, wl-copy/xclip/xsel, Set-Clipboard, tmux buffer, OSC 52).
- Scroll clavier : `PgUp/PgDn` (demi-écran), `Ctrl+Home/Ctrl+End`, `Fn+flèches` sur MacBook ; auto-follow avec bouton flottant `Jump to bottom` + « 3 new messages » ; ligne d'en-tête dim montrant le dernier prompt sorti de la vue ; `/config` → Auto-scroll off.
- Transcript mode (`Ctrl+O`) less-like : `/` recherche, `n/N`, `j/k`, `g/G`, `{`/`}` (prompt précédent/suivant), `Ctrl+u/d`, `Ctrl+b/f`, `Space`/`b`, `[` (écrit la conversation dans le scrollback natif), `v` (ouvre dans `$EDITOR`), `?` (aide), `q`/`Esc`/`Ctrl+O` sortie.
- Resize : bannière d'accueil recalculée après resize largeur+hauteur (fix v2.1.212), rangées haut/bas blanches après resize corrigées (v2.1.269), duplication de scrollback en mode classique lors des resizes corrigée (v2.1.120), diff view mise à jour au resize (v2.0.70), crash RangeError sur terminaux très étroits corrigé (v2.1.229), hint transcript qui wrappait < 104 colonnes (v2.1.216), `/diff` panel conditionné à ≥ 110/144 colonnes, `Ctrl+L` pour repeindre. `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT=1` pour Windows Terminal/ConPTY. Synchronized output sondé au démarrage (`CLAUDE_CODE_FORCE_SYNC_OUTPUT=1`).
— Sources : [FS](https://code.claude.com/docs/en/fullscreen), [IM](https://code.claude.com/docs/en/interactive-mode), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

#### 3.7 Voice, accessibilité, divers
- Voice dictation : maintenir/taper `Space` (`/voice hold|tap|off`), rebindable `voice:pushToTalk` `[v2.1.71]`, hint footer `hold space to speak`.
- Screen reader mode (`axScreenReader`) : texte plat sans bordures ni animations, renderer classique forcé ; `prefersReducedMotion`.
- Attente de limite d'usage : ligne « Usage limit reached · continuing automatically at 3:45pm · esc to cancel », puis « continuing shortly », « Usage limit reset · continuing automatically », « Your usage limit has reset · press enter to continue » `[v2.1.234]`.
— Sources : [IM](https://code.claude.com/docs/en/interactive-mode), [SR](https://code.claude.com/docs/en/settings-reference), [CL](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

### Inferences
- Le contexte `Select` unique (↑/↓, j/k, Ctrl+N/P, PageUp/Down, Home/End, Enter, Esc) réutilisé par `/model`, `/config`, `/resume`, permissions donne une cohérence facile à répliquer dans Ink avec un seul composant.
- Le picker `/resume` combine « search-as-you-type » (tout caractère imprimable) et des filtres de portée par Ctrl+lettre — un pattern plus riche qu'un simple fuzzy finder.
- Le fullscreen étant devenu le défaut pour les nouveaux utilisateurs depuis mai 2026, un concurrent devrait prévoir dès le départ un mode alt-screen avec souris et sélection interne.

### Gaps
- Aucune source consultée ne décrit le rendu exact de l'auto-updater (texte complet de la notice, emplacement) au-delà de « "Update installed" restart notice » ; le workflow `claude update` n'a pas été exploré.
- Le libellé exact du dialogue de confiance de dossier (trust dialog) et du dialogue de sélection de thème au premier lancement n'a pas été retrouvé dans les pages consultées.
- Le contenu exact du panneau `/doctor` (sections, libellés) n'est décrit que par fragments de changelog.
