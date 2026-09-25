# Fuller — état actuel de l'interface terminal (HEAD `4c544ba`, 25/09/2026)

Inventaire établi par lecture du code à HEAD `4c544ba` (branche `main`, arbre propre) et des documents du projet, sans modifier le dépôt. Les chemins sont relatifs à la racine du dépôt (`/home/administrator/Desktop/gemini-code`). Le 25/09/2026 à 21:45, la suite Vitest lancée à HEAD passe entièrement : **66 fichiers, 509 tests** (`npx vitest run`). L'arbre est resté propre après le passage.

Légende des états, utilisée dans toute la note :
- **[testé+CC]** : implémenté, couvert par un test Vitest ou PTY, et comparé à des captures de Claude Code 2.1.281 ou 2.1.282 dans `reports/parite-cc/` ou dans la note de passation.
- **[testé]** : implémenté et testé dans Fuller, sans comparaison capturée avec Claude Code (fait d'après la documentation de Claude Code, ou jamais comparé).
- **[non testé]** : implémenté, sans test dédié trouvé par recherche dans `tests/`.
- **[absent]** : aucune trace dans le code.

## 1. Zone de saisie : touches et comportements (InputBox, textInput, useRawInput, keybindings)

### Takeaway
La saisie couvre presque tout le clavier de Claude Code en style Emacs/readline : multiligne, collages repliés, images, `@`, mode `!`, historique et Ctrl+R (deux présentations selon le renderer), kill/yank, undo, éditeur externe, file d'attente, envoi immédiat, double Échap, accords Ctrl+X et mise de côté (stash). Il n'y a **pas de mode vim**. `keybindings.json` ne propose que 8 actions, des touches simples et aucun contexte.

### Cited Findings
**Lecture du clavier**
- [testé] Fuller lit stdin brut sans passer par la normalisation d'Ink. Il reconnaît CSI (flèches, Home/End, PgUp/PgDn, Suppr), SS3, Alt+touche, le protocole CSI-u de kitty (`CSI code;mod u`), la forme xterm modifyOtherKeys (`CSI 27;mod;code ~`), la souris SGR (`CSI < b;x;y M/m`) et le collage entre crochets, qu'il accumule même s'il arrive en plusieurs morceaux — [src/ui/useRawInput.ts:38-130, 136-188](src/ui/useRawInput.ts) ; [tests/keys.test.ts](tests/keys.test.ts) (6 cas, dont le collage et la molette SGR).
- [absent] Fuller ne demande jamais au terminal d'activer ces protocoles (aucune séquence `CSI > 1u` ou `CSI > 4;…` dans `src/`). Maj+Entrée et Ctrl+Entrée ne marchent donc que si le terminal envoie de lui-même une séquence distincte — recherche dans `src/` ; [research_notes/Fuller écarts restants vs Claude Code/etat_actuel_v2.md §2.13](research_notes/Fuller%20écarts%20restants%20vs%20Claude%20Code/etat_actuel_v2.md).

**Multiligne**
- [testé+CC] Maj+Entrée, Alt+Entrée et Ctrl+J (LF brut) insèrent un retour à la ligne. `\` suivi d'Entrée en fin de ligne fait de même. ↑/↓ changent d'abord de ligne dans le texte, puis parcourent l'historique — [src/ui/InputBox.tsx:596, 620-629, 643-649](src/ui/InputBox.tsx) ; [tests/inputParity.test.tsx](tests/inputParity.test.tsx) (« preserving Ctrl+J »).
- [testé+CC] Quand le texte a plusieurs lignes, la ligne au-dessus du prompt affiche « ctrl+g to edit in <éditeur> » — [src/ui/Footer.tsx:35-49](src/ui/Footer.tsx) ; [reports/parite-cc/1.3-pied-de-page.md:35](reports/parite-cc/1.3-pied-de-page.md).

**Collages**
- [testé+CC] Un collage de plus de 3 lignes ou de plus de 800 caractères devient `[Pasted text #N +L lines]`, où L compte les retours à la ligne. Coller à nouveau le même texte déplie le repère sur place, avec l'indication « paste again to expand ». Retour arrière efface le repère d'un coup. Le texte est déplié à l'envoi et dans l'historique. L'envoi est bloqué si le contenu d'un repère a disparu — [src/ui/InputBox.tsx:170, 215-216, 295-319, 389-391, 401-406](src/ui/InputBox.tsx) ; [tests/inputParity.test.tsx](tests/inputParity.test.tsx) (« restores pasted content from history and undo… », « counts pasted line breaks… ») ; [reports/parite-cc/1.2-zone-de-saisie.md:14](reports/parite-cc/1.2-zone-de-saisie.md).
- [testé] À l'envoi, les caractères invisibles (zéro-largeur, bidi, balises) sont retirés, avec l'avertissement « Removed N invisible characters · review and press Enter again ». Les jointures des écritures indiennes et des emoji sont conservées — [src/ui/textInput.ts:43-49](src/ui/textInput.ts) ; [src/ui/InputBox.tsx:375-386](src/ui/InputBox.tsx) ; [tests/tuiEnhancements.test.tsx](tests/tuiEnhancements.test.tsx).

**Images**
- [testé] Ctrl+V et Alt+V lisent une image du presse-papiers (wl-paste, xclip/xsel, osascript, PowerShell) et insèrent `[Image #n]` ; Retour arrière retire l'image avec son repère. Les chemins d'images tapés ou cités avec `@` sont joints automatiquement. Le transcript affiche « 🖼 [Image #i] nom · N KB » — [src/ui/InputBox.tsx:217-218, 321-335, 566, 672](src/ui/InputBox.tsx) ; [src/ui/Transcript.tsx:118](src/ui/Transcript.tsx) ; [README.md](README.md) (Images) ; [tests/images.test.ts:17-22](tests/images.test.ts).

**Mentions `@`**
- [testé+CC] `@partie` ouvre au-dessus du prompt une liste floue de 8 fichiers au plus ; Tab ou Entrée insère `@chemin `. L'index des fichiers est chargé à la première mention — [src/ui/InputBox.tsx:148-161, 452-458, 753-755](src/ui/InputBox.tsx) ; [reports/parite-cc/1.5-menu-slash-et-arobase.md](reports/parite-cc/1.5-menu-slash-et-arobase.md).
- [absent] Le menu `@` ne propose pas les ressources MCP (`◇` chez Claude Code) — [reports/parite-cc/1.5-menu-slash-et-arobase.md:68](reports/parite-cc/1.5-menu-slash-et-arobase.md).

**Menu `/`**
- [testé+CC] Le menu s'ouvre en début de prompt ou au milieu du texte, après un espace. Il trie par préfixe, puis par usage pondéré par l'ancienneté (`~/.fuller/command-usage.json`), puis par ordre alphabétique. En classique, une complétion au milieu du texte apparaît en texte fantôme « +N », et Tab ouvre la liste ; en plein écran, la liste s'affiche directement, sans sélection initiale. Une commande connue en tête du prompt est colorée — [src/ui/InputBox.tsx:138-146, 432-451, 616, 708-719](src/ui/InputBox.tsx) ; [reports/parite-cc/3f-decisions.md:59-63](reports/parite-cc/3f-decisions.md) ; [tests/inputParity.test.tsx](tests/inputParity.test.tsx) (« completes slash commands mid-prompt… »), [tests/slashMenu.test.tsx](tests/slashMenu.test.tsx), [tests/commandUsage.test.tsx](tests/commandUsage.test.tsx).

**Mode `!`**
- [testé+CC] `!` tapé sur un prompt vide passe en mode shell : `!` à la place de `❯` et bordure de couleur `bashBorder`. Retour arrière, Échap ou Ctrl+C sur un champ vide en sortent. Rappeler une entrée d'historique qui commence par `!` rétablit le mode — [src/ui/InputBox.tsx:393-399, 427, 551, 608, 666, 679-683, 705-706](src/ui/InputBox.tsx).
- [testé+CC] Après une commande `!`, le modèle répond, comme chez Claude Code. `/config` → « Reply after ! commands » (`replyAfterShell`) désactive ce comportement — [reports/parite-cc/3f-decisions.md:42-47](reports/parite-cc/3f-decisions.md) ; [src/ui/commands.ts:166](src/ui/commands.ts).

**Historique et Ctrl+R**
- [testé] ↑/↓ parcourent l'historique du projet (`~/.fuller/history.jsonl`) en gardant le brouillon — [src/ui/InputBox.tsx:413-430](src/ui/InputBox.tsx) ; [src/ui/App.tsx:151-152](src/ui/App.tsx).
- [testé+CC] Ctrl+R en plein écran ouvre le panneau `HistorySearch` : âge de chaque prompt, sélection en bas, ↑ remonte dans le temps. La portée part de « tous les projets » et Ctrl+S la fait tourner (tous → session → projet). Entrée ou Tab charge le résultat pour édition ; Échap ou Ctrl+G rétablit le brouillon — [src/ui/InputBox.tsx:461-480, 512-539, 757](src/ui/InputBox.tsx) ; [src/ui/HistorySearch.tsx](src/ui/HistorySearch.tsx) ; [reports/parite-cc/2.5-2.6-erreurs-historique-reprise.md](reports/parite-cc/2.5-2.6-erreurs-historique-reprise.md) ; [reports/parite-cc/3d-reprise-et-historique.md:24](reports/parite-cc/3d-reprise-et-historique.md) ; [tests/historySearch.test.tsx](tests/historySearch.test.tsx).
- [testé] Ctrl+R en classique affiche `(reverse-i-search)` dans le champ, et Entrée soumet. Dans les deux modes, la recherche compare des sous-chaînes, sans classement flou — [src/ui/InputBox.tsx:461-465, 516, 763-765](src/ui/InputBox.tsx) ; [tests/inputParity.test.tsx](tests/inputParity.test.tsx) (« keeps classic Enter submission… »).

**Édition, kill et yank**
- [testé] Déplacements :
  - Ctrl+A/E : début et fin de ligne ;
  - Ctrl+B/F : un graphème ;
  - Alt+B/F et Ctrl/Alt+←/→ : un mot, avec segmentation Unicode ;
  - Home/End : ligne ;
  - Ctrl+Home/End : début et fin du texte en classique, de la conversation en plein écran.

  [src/ui/InputBox.tsx:588-591, 651-663, 674-675](src/ui/InputBox.tsx) ; [src/ui/textInput.ts:20-40](src/ui/textInput.ts) ; [tests/inputParity.test.tsx](tests/inputParity.test.tsx) (« punctuation boundaries for Alt+B… »).
- [testé+CC] Suppressions et récupération :
  - Ctrl+K et Ctrl+U coupent jusqu'à la fin ou au début de la ligne ;
  - Ctrl+W coupe le mot précédent jusqu'à l'espace ;
  - Alt+Retour arrière et Ctrl+Retour arrière coupent un mot ;
  - Alt+D coupe le mot suivant ;
  - Ctrl+H vaut Retour arrière ;
  - Ctrl+Y recolle le dernier texte coupé, avec l'indication « Ctrl+Y to paste deleted text ».

  [src/ui/InputBox.tsx:236-266, 592-595, 665, 676](src/ui/InputBox.tsx) ; [src/ui/Footer.tsx:39](src/ui/Footer.tsx).
- [absent] Le kill ring n'a qu'un emplacement : pas d'Alt+Y pour remonter aux coupes plus anciennes. La branche Alt ne traite que v, p, b, f et d — [src/ui/InputBox.tsx:96, 131, 671-677](src/ui/InputBox.tsx).
- [absent] Pas de sélection de texte au clavier (Maj+flèches) : l'état de l'éditeur ne connaît que `text` et `cursor` — [src/ui/InputBox.tsx:70-73](src/ui/InputBox.tsx).

**Annulation**
- [testé] Ctrl+_ annule. La pile garde 100 états et regroupe la frappe continue par tranches de 600 ms ; elle restaure aussi les collages et les images. Il n'y a pas de rétablissement (redo) — [src/ui/InputBox.tsx:176-182, 267-275, 570](src/ui/InputBox.tsx).
- [testé+CC] Ctrl+Z suspend Fuller comme une tâche du shell (SIGTSTP, retour avec `fg`) et affiche une seule fois « Note: ctrl + z now suspends Fuller, ctrl + _ undoes input. » — [src/ui/App.tsx:574-587](src/ui/App.tsx) ; [reports/parite-cc/1.9-raccourcis.md:21](reports/parite-cc/1.9-raccourcis.md).

**Éditeur externe**
- [testé] Ctrl+G ouvre le prompt dans `$VISUAL`, sinon `$EDITOR`, sinon `code --wait` si VS Code est installé, sinon `vi` (Notepad sous Windows). Le fichier temporaire est en mode 0600 ; l'éditeur est lancé sans shell — [src/ui/externalEditor.ts:9-35](src/ui/externalEditor.ts) ; [src/ui/InputBox.tsx:337-350, 564](src/ui/InputBox.tsx).

**File d'attente et envoi immédiat**
- [testé] Les prompts tapés pendant un tour sont mis en file et listés au-dessus du prompt (`⏵ …`, 4 au plus, puis « … +N queued »). ↑ sur la première ligne reprend la file devant le brouillon, avec ses images et le mode `!` — [src/ui/InputBox.tsx:630-642, 742-748](src/ui/InputBox.tsx) ; `takeQueue` dans [src/agent/loop.ts:363](src/agent/loop.ts) ; [tests/inputParity.test.tsx](tests/inputParity.test.tsx) (« takes the queue ahead of a draft »).
- [testé] Ctrl+Entrée et l'accord Ctrl+X Ctrl+S interrompent le tour et envoient la file puis le brouillon (`sendNow`) — [src/ui/InputBox.tsx:541-546, 622](src/ui/InputBox.tsx) ; [src/agent/loop.ts:372](src/agent/loop.ts) ; [reports/Fuller écarts subtils Claude Code 2.1.280.md:118](reports/Fuller%20écarts%20subtils%20Claude%20Code%202.1.280.md).

**Échap, accords et raccourcis divers**
- [testé] Échap, par ordre de priorité : ferme l'aide `?`, puis le menu ; interrompt si un tour est en cours ; sort du mode `!` sur un champ vide. Deux Échap en moins de 600 ms vident le champ s'il contient du texte, sinon ouvrent `/rewind`, et seulement s'il existe un point de reprise — [src/ui/InputBox.tsx:604-613](src/ui/InputBox.tsx) ; [src/ui/App.tsx:573](src/ui/App.tsx).
- [testé] Accords Ctrl+X : seulement Ctrl+X Ctrl+S (envoi immédiat) et Ctrl+X B (base du panneau `/diff`) — [src/ui/InputBox.tsx:541-546](src/ui/InputBox.tsx) ; [tests/inputParity.test.tsx](tests/inputParity.test.tsx) (« cycles the /diff panel base with Ctrl+X B »).
- [testé+CC] Ctrl+S met de côté un prompt non vide, avec son curseur, ses collages et ses images, et le restitue sur un champ vide ; « › stashed » s'affiche au-dessus du prompt — [src/ui/InputBox.tsx:572-587](src/ui/InputBox.tsx) ; [src/ui/Footer.tsx:43](src/ui/Footer.tsx).
- [testé+CC] Ctrl+C :
  - interrompt si un tour est en cours ;
  - sinon vide le champ et arme la sortie : un deuxième Ctrl+C dans les 1,5 s quitte, avec l'indication « Press Ctrl-C again to exit ».

  Ctrl+D quitte sur un champ vide quand aucun tour n'est en cours, et supprime un caractère sinon — [src/ui/InputBox.tsx:549-562](src/ui/InputBox.tsx).
- [testé+CC] Autres raccourcis :
  - Ctrl+O : lecteur du transcript ;
  - Ctrl+T : liste de tâches ;
  - Ctrl+L : redessiner ;
  - `?` sur champ vide : aide ;
  - Alt+P : sélecteur de modèle ;
  - ← sur champ vide : vue des agents ;
  - Ctrl+B : passe la commande Bash en cours en arrière-plan, sinon recule d'un caractère ;
  - Tab ou → : insère la suggestion grisée. Cette suggestion est calculée localement par `suggestions.ts`, pas par le modèle.

  [src/ui/InputBox.tsx:563-568, 590, 618, 653, 658, 673, 684, 481-485](src/ui/InputBox.tsx) ; [src/ui/suggestions.ts](src/ui/suggestions.ts) ; [tests/shortcutsHelp.test.tsx](tests/shortcutsHelp.test.tsx).

**Mode vim et keybindings.json**
- [absent] Pas de mode vim : `vim` n'apparaît dans `src/` que dans la table des noms d'éditeurs — [src/ui/externalEditor.ts:16](src/ui/externalEditor.ts).
- [non testé] `~/.fuller/keybindings.json` a la forme `{"bindings": {"ctrl+g": "externalEditor"}}` :
  - 8 actions : `transcript`, `diff`, `externalEditor`, `tasks`, `redraw`, `historySearch`, `undo`, `cycleMode` ;
  - `null` désactive une touche ;
  - pas d'accord ni de contexte : la clé est une seule touche avec ses modificateurs (`keyString`) ;
  - le fichier est lu une fois au montage de la saisie et ne s'applique qu'à elle, pas aux fenêtres ;
  - `/keybindings` crée le fichier et l'ouvre.

  Les tests remplacent `loadKeybindings` par `{}` : la lecture du fichier n'est jamais testée — [src/ui/keybindings.ts:6-27](src/ui/keybindings.ts) ; [src/ui/InputBox.tsx:132, 496-508](src/ui/InputBox.tsx) ; [src/ui/commands.ts:404-411](src/ui/commands.ts) ; [tests/inputParity.test.tsx:9](tests/inputParity.test.tsx).

### Inferences
- Maj+Entrée et Ctrl+Entrée dépendent du terminal, faute de négociation de protocole. Sur un terminal qui envoie `\r` nu pour Maj+Entrée, seuls `\`+Entrée, Alt+Entrée et Ctrl+J donnent un retour à la ligne.
- `keybindings.json` couvre une petite partie de ce qu'un fichier de raccourcis complet permettrait : aucune action des fenêtres, du menu ou du lecteur de transcript n'est reconfigurable.

### Gaps
- IME et composition (touches mortes, saisie CJK en plusieurs étapes) : aucun traitement dans le code et aucun test en terminal réel trouvé ; comportement inconnu.
- La liste exacte des actions et contextes de `keybindings.json` chez Claude Code n'a pas été vérifiée ici (hors périmètre) ; l'écart fin reste à établir par la recherche côté Claude Code.

## 2. Rendu : plein écran et classique, lecteurs, souris, panneau /diff, animation, pied de page, thèmes, lecteur d'écran, titre, notifications

### Takeaway
Fuller démarre en plein écran (écran alternatif) avec une conversation virtualisée, dessinée par les mêmes composants que le mode classique. Le mode classique garde le scrollback natif et un writer qui corrige le reflow. La souris sert à la molette et au panneau `/diff` (clics, sélection de lignes), mais on ne peut ni sélectionner ni copier le texte de la conversation dans l'application, et il n'y a pas de liens OSC 8. Notifications : BEL seulement. La réflexion du modèle n'est jamais affichée.

### Cited Findings
**Deux renderers et le lecteur d'écran**
- [testé+CC] Le plein écran est le mode par défaut (`ESC[?1049h`). `--tui classic`, ou `FULLER_DISABLE_ALTERNATE_SCREEN=1`, garde le mode classique ; `--screen-reader`, ou `FULLER_SCREEN_READER=1`, lance le mode lecteur d'écran. Le collage entre crochets est activé ; la sortie remet les modes du terminal et le titre à zéro — [src/index.tsx:72-73, 197-217, 222, 250-258](src/index.tsx).

**Mode classique**
- [testé] L'historique va dans `<Static>` (scrollback natif), sous une zone vivante bornée. Le writer remplace l'effacement d'Ink et recompte les lignes physiques après un reflow, avec sortie synchronisée DEC 2026. La mise en page laisse libre une colonne à droite ; le redimensionnement attend 120 ms. `FULLER_NO_REFLOW=1` coupe le calcul du reflow — [src/ui/App.tsx:391-414, 691-693](src/ui/App.tsx) ; [src/ui/frameWriter.ts:1-40](src/ui/frameWriter.ts) ; [src/index.tsx:219-236](src/index.tsx) ; [tests/frameWriter.test.ts](tests/frameWriter.test.ts), [tests/resize.test.tsx](tests/resize.test.tsx), [tests/terminalLifecycle.test.tsx](tests/terminalLifecycle.test.tsx) (rejeu `@xterm/headless`).
- [absent, voulu] En classique, les appels d'outils ne sont pas regroupés : les lignes déjà imprimées ne peuvent plus changer — [reports/parite-cc/2.1-2.3-rendu-conversation.md](reports/parite-cc/2.1-2.3-rendu-conversation.md) (« Restant »).

**Mode plein écran**
- [testé+CC] Chaque élément est rendu par `renderToString` avec les composants du mode classique et mis en cache par élément, largeur, verbosité et thème. Le retour à la ligne se fait entre les mots (`wrap-ansi`). La vue suit le bas ; quand on remonte, la dernière ligne indique « ↓ Jump to bottom (ctrl+end) ». Défilement :
  - PgUp/PgDn : une demi-page ;
  - molette : 3 lignes ;
  - Ctrl+Home/End : début et fin.

  [src/ui/FullscreenTranscript.tsx:13-16, 33-69, 75-103](src/ui/FullscreenTranscript.tsx) ; [src/ui/InputBox.tsx:489-493, 602-603, 662-663](src/ui/InputBox.tsx) ; [tests/transcriptNavigation.test.tsx](tests/transcriptNavigation.test.tsx).
- [testé+CC] Les lectures successives sont regroupées : « Read N files, listed N directories, ran N shell commands ». Les commandes `!` de l'utilisateur ne sont pas regroupées — [src/ui/ToolGroup.tsx:20-34](src/ui/ToolGroup.tsx) ; [tests/toolGroup.test.tsx](tests/toolGroup.test.tsx) ; [reports/parite-cc/2.4-outils-et-diffs.md](reports/parite-cc/2.4-outils-et-diffs.md).
- [testé+CC] Le cadre occupe `rows - 1` lignes, avec `overflow="hidden"` ; seule la conversation rétrécit, pour ne jamais écraser les fenêtres ni la saisie — [src/ui/App.tsx:643-651, 694-729](src/ui/App.tsx).

**Lecteur du transcript (Ctrl+O)**
- [testé] Ctrl+O ouvre `Pager` avec la conversation détaillée et mise en forme. Touches :
  - ↑↓ ou j/k : une ligne ;
  - Espace/b ou PgUp/PgDn : une page ;
  - Ctrl+U/D : une demi-page ; Ctrl+F : une page ;
  - g/G ou Home/End : début et fin ;
  - `/` : recherche, puis n/N pour passer d'une occurrence à l'autre ;
  - `{` `}` : prompt précédent ou suivant ;
  - `?` : aide des touches ;
  - q, Échap, Ctrl+O ou Ctrl+C : fermer ;
  - molette : 3 lignes ;
  - en plein écran seulement : `[` copie la conversation dans le scrollback natif, `v` l'ouvre dans l'éditeur ;
  - en classique seulement : Ctrl+E bascule les détails.

  [src/ui/Pager.tsx:83-121, 133-137](src/ui/Pager.tsx) ; [src/ui/App.tsx:605-622, 715](src/ui/App.tsx) ; [tests/transcriptNavigation.test.tsx](tests/transcriptNavigation.test.tsx) ; [tests/tuiEnhancements.test.tsx](tests/tuiEnhancements.test.tsx).
- [absent] La vue Ctrl+O n'a ni la ligne heure + modèle avant chaque réponse, ni le chemin absolu souligné dans `Read(…)` que montre Claude Code. `Transcript.tsx` n'affiche aucune heure ; seul l'export texte `transcriptLines` en met une — [reports/parite-cc/2.1-2.3-rendu-conversation.md](reports/parite-cc/2.1-2.3-rendu-conversation.md) (« Restant ») ; [src/ui/viewerText.ts:40](src/ui/viewerText.ts).

**Souris**
- [testé] En plein écran, Fuller active le suivi de souris 1000 et 1006 : appuis, relâchements et molette, sans suivi du glisser (pas de 1002/1003). `FULLER_DISABLE_MOUSE=1` le coupe. En classique, la souris n'est activée que pendant le sélecteur de sessions du lancement, le sélecteur de modèle, `/rewind` ou une visionneuse (Ctrl+O, `/diff`) ; elle ne l'est ni pour `/theme` ni pour `/resume` ouvert en cours de session — [src/index.tsx:224-225](src/index.tsx) ; [src/ui/App.tsx:159-164](src/ui/App.tsx) ; [tests/keys.test.ts](tests/keys.test.ts).
- [testé] La molette fait défiler la conversation, ou le panneau `/diff` si le pointeur est au-dessus. Les clics ne servent qu'au panneau `/diff`. La molette marche aussi dans `Pager`, `DiffViewer`, `Select` et `SessionPicker` — [src/ui/App.tsx:873-900](src/ui/App.tsx) ; [src/ui/Pager.tsx:88-91](src/ui/Pager.tsx) ; [src/ui/DiffViewer.tsx:96-97](src/ui/DiffViewer.tsx).
- [absent] On ne peut ni sélectionner ni copier le texte de la conversation dans l'application, ni cliquer pour déplier une sortie. Pas de liens OSC 8 (aucune séquence `ESC]8;;` dans `src/`) — recherche dans `src/` ; [research_notes/Fuller écarts restants vs Claude Code/etat_actuel_v2.md §1.12](research_notes/Fuller%20écarts%20restants%20vs%20Claude%20Code/etat_actuel_v2.md).
- [non vérifié] La sélection native du terminal quand le suivi de souris est actif (Maj+glisser selon les terminaux) « reste à examiner » selon l'audit — [reports/Fuller écarts subtils Claude Code 2.1.280.md:88, 135](reports/Fuller%20écarts%20subtils%20Claude%20Code%202.1.280.md).

**Panneau `/diff` (plein écran, 110 colonnes au moins)**
- [testé+CC] Ouverture et fermeture :
  - `/diff` montre ou cache le panneau (« Diff panel shown » / « Diff panel hidden ») ;
  - le panneau prend 45 % à droite, et la conversation se replie à gauche ;
  - sous 110 colonnes : « Resize your terminal to at least 110 columns to show the diff panel » ;
  - il s'ouvre seul à la première édition à partir de 144 colonnes, ou dès 110 si l'utilisateur l'a déjà ouvert ; fermé, il reste fermé. Préférence `diffPanel` : `auto`, `opened` ou `closed`, dans les réglages utilisateur.

  [src/ui/App.tsx:64-73, 185-221, 265-277](src/ui/App.tsx) ; [reports/Note_de_passation_Claude.md §12](reports/Note_de_passation_Claude.md) ; [tests/diffPanel.test.tsx](tests/diffPanel.test.tsx), [tests/diffPanelAuto.test.tsx](tests/diffPanelAuto.test.tsx).
- [testé+CC] Contenu :
  - en-tête « N files changed +A -D », avec ✕ cliquable ;
  - liste des fichiers, un clic mène au diff du fichier ;
  - le diff de chaque fichier ;
  - « No changes this session » quand il n'y a rien ;
  - fichiers non suivis : « (untracked) » et « New file not yet staged… » ;
  - « +N files edited before this session (show/hide) » cliquable ;
  - mise à jour après chaque édition, commande shell ou sous-agent, et en fin de tour.

  [src/ui/DiffPanel.tsx:79-118, 146-207](src/ui/DiffPanel.tsx) ; [src/ui/App.tsx:224-236, 280-282](src/ui/App.tsx).
- [testé, non capturé CC] Ajouts de la section 20 (commits `226b951` et `e05c0b1`) :
  - les fichiers de test et générés sont sortis de la liste, derrière « +N test and generated files (show) » ;
  - Ctrl+X B fait tourner la base : cette session → uncommitted → since <branche par défaut>, avec un suffixe dans l'en-tête ; le choix est gardé par projet (`diffBase` dans `.fuller/settings.local.json`) ;
  - un appui puis un relâchement de la souris sur des lignes d'un même fichier les sélectionne. Le jeton « [N lines selected] » s'insère dans la saisie ; les lignes partent avec le prompt suivant, sauf si l'on efface le jeton.

  [src/ui/DiffPanel.tsx:28-31, 90-118](src/ui/DiffPanel.tsx) ; [src/ui/App.tsx:237-264, 534-545](src/ui/App.tsx) ; [reports/Note_de_passation_Claude.md §20](reports/Note_de_passation_Claude.md) ; [tests/gitDiff.test.ts](tests/gitDiff.test.ts), [tests/inputParity.test.tsx](tests/inputParity.test.tsx).
- [absent] Le panneau ne se commande pas au clavier : il défile à la molette seulement (`scrollDiffPanel` n'est appelé que par la molette), et PgUp/PgDn restent à la conversation — [src/ui/App.tsx:283-289, 873-878](src/ui/App.tsx).

**Visionneuse `/diff` du mode classique (et du plein écran hors dépôt git)**
- [testé, non capturé CC] Une vue « Current » montre les changements non commités, ou à défaut ce qu'ajoute la branche par rapport à la branche par défaut. Il y a aussi une vue par tour, construite à partir des `edit_file`/`write_file` du transcript. Touches : ←/→ changent de vue, ↑/↓ de fichier ; Entrée ouvre un fichier, dont le diff défile avec j/k, Espace, PgUp/PgDn, Home/End et la molette ; Échap ou q reviennent à la liste ; r recharge ; Ctrl+C ou Ctrl+O ferment — [src/ui/DiffViewer.tsx:10-30, 86-98](src/ui/DiffViewer.tsx) ; [src/ui/App.tsx:192-221, 714](src/ui/App.tsx) ; [tests/diffViewer.test.tsx](tests/diffViewer.test.tsx) ; [reports/Note_de_passation_Claude.md §20](reports/Note_de_passation_Claude.md) (« refaite d'après la documentation »).

**Animation d'attente**
- [testé+CC] Le spinner tourne toutes les 120 ms. Le verbe est tiré au hasard, change toutes les 4 s et peut être personnalisé (`settings.spinnerVerbs`) ; un reflet glisse sur le texte. États affichés : « Compacting conversation », « Waiting to retry », « Running », et « Deep in thought » après 45 s du seul appel en cours (commit `0ebba77`). À partir de 5 s s'ajoutent le compteur et « thinking » ou « ↓ N tokens ». La fin de tour affiche « ✻ <verbe au passé> for … » — [src/ui/Spinner.tsx:8-98](src/ui/Spinner.tsx) ; [src/ui/viewerText.ts:71-77](src/ui/viewerText.ts) ; [src/ui/App.tsx:731-735](src/ui/App.tsx) ; [tests/spinner.test.tsx](tests/spinner.test.tsx) ; [reports/parite-cc/1.6-animation-attente.md](reports/parite-cc/1.6-animation-attente.md).
- [absent] La réflexion du modèle n'est jamais affichée : les parties `thought` sont filtrées du flux, et seul le mot « thinking » apparaît dans le spinner — [src/agent/gemini.ts:421, 500](src/agent/gemini.ts).

**Pied de page et ligne d'état**
- [testé+CC] À gauche, le mode dans sa couleur : `⏸ manual mode on`, `⏵⏵ accept edits on`, `⏸ plan mode on`, `⏵⏵ auto mode on`, `⏵⏵ bypass permissions on`. Suivent « ? for shortcuts · ← for agents » ou « (shift+tab to cycle) », « esc to interrupt » pendant un tour, et les indications passagères. À droite :
  - « ⏵ N background tasks (/tasks) » ;
  - « Context left until auto-compact: N% » quand il reste 20 % ou moins ;
  - une barre de quota dès qu'une clé est épuisée.

  [src/ui/Footer.tsx:56-106](src/ui/Footer.tsx) ; [reports/parite-cc/1.3-pied-de-page.md](reports/parite-cc/1.3-pied-de-page.md).
- [testé+CC] La ligne au-dessus du prompt, alignée à droite, montre l'effort (« ◐ medium · /effort ») ou une indication sur la saisie — [src/ui/Footer.tsx:28-49](src/ui/Footer.tsx).
- [testé] Ligne d'état scriptée (`statusLine.command`) : elle reçoit sur stdin le même JSON que chez Claude Code, attend 300 ms après un changement, se relance selon `refreshInterval`, abandonne après 5 s, affiche 3 lignes au plus et respecte `padding`. `cost.total_cost_usd` vaut toujours 0 — [src/ui/useStatusLine.ts:19-98](src/ui/useStatusLine.ts) ; [src/ui/Footer.tsx:81-89](src/ui/Footer.tsx) ; [tests/statusLine.test.ts](tests/statusLine.test.ts).

**Thèmes**
- [testé+CC] 16 noms :
  - `auto`, qui choisit dark ou light d'après `COLORFGBG` ;
  - dark, light et leurs variantes -daltonized et -ansi ;
  - monokai, ocean, forest, lagoon, olive, amethyst, citrus.

  `/theme` ouvre le sélecteur, avec aperçu en direct ; Ctrl+T y active ou coupe la coloration syntaxique. Un fichier de thème peut surcharger des couleurs — [src/ui/theme.tsx:248-257, 266-319](src/ui/theme.tsx) ; [src/ui/ThemePicker.tsx:89](src/ui/ThemePicker.tsx) ; [tests/themes.test.tsx](tests/themes.test.tsx), [tests/themePicker.test.tsx](tests/themePicker.test.tsx), [tests/syntaxHighlighting.test.tsx](tests/syntaxHighlighting.test.tsx) ; [reports/parite-cc/3e-agents-bifurcation-rewind.md](reports/parite-cc/3e-agents-bifurcation-rewind.md) (/theme).

**Mode lecteur d'écran**
- [testé, PTY] Mode `readline` linéaire, en ajout seul : chaque élément est annoncé avec un libellé (`fuller:`, `tool:`, `result:`, `notice:`), les permissions sont numérotées et le choix de session se fait par numéro. Seules `/help`, `/diff`, `/rewind`, `/clear` et `/exit` sont reconnues. Aucun test Vitest ; un scénario PTY existe — [src/ui/screenReader.ts:33-106](src/ui/screenReader.ts) ; [scripts/tui-smoke.py:149](scripts/tui-smoke.py).

**Titre du terminal et notifications**
- [non testé] Titre OSC 0 « Fuller · <dossier » », précédé de « ⚠ » en attente de permission et de « ✻ » pendant un tour ; il est vidé à la sortie — [src/ui/App.tsx:376-382](src/ui/App.tsx) ; [src/index.tsx:257](src/index.tsx).
- [non testé] Notifications : un simple BEL (`\x07`), réglé par `notifications` (`off`, `permission` ou `all`). Pas de notification de bureau (aucun OSC 9 ou 777, aucun `notify-send`) — [src/ui/App.tsx:322-326](src/ui/App.tsx) ; [src/ui/commands.ts:201](src/ui/commands.ts) ; recherche dans `src/`.

**Bannière et conseils**
- [testé+CC] Bannière compacte : version, modèle, dossier, plus un conseil un lancement sur trois — [src/branding.ts:31-43](src/branding.ts) ; [src/ui/Banner.tsx:23-47](src/ui/Banner.tsx) ; [reports/parite-cc/1.1-banniere.md:44](reports/parite-cc/1.1-banniere.md) ; [tests/startupScreen.test.tsx](tests/startupScreen.test.tsx).
- [à corriger] Le conseil « Shift+Tab cycles modes: manual → accept edits → plan → bypass. » ne décrit plus le cycle réel, qui passe par `auto` et n'inclut `bypass` que si la session a démarré avec ce mode — [src/branding.ts:33](src/branding.ts) ; [src/ui/App.tsx:442-446](src/ui/App.tsx).

### Inferences
- Pendant le plein écran, le suivi de souris sans glisser est le prix des clics et de la sélection dans le panneau `/diff`. Pour copier du texte de la conversation, il reste la sélection native du terminal (non vérifiée), `[` vers le scrollback ou `/copy`/`/export`.
- Plusieurs éléments visibles (réflexion, liens, heures dans Ctrl+O) manquent pour des raisons de rendu ou de fournisseur, pas de saisie.

### Gaps
- Aucune capture ne compare avec Claude Code : l'aspect exact de l'indicateur « [N lines selected] », la ligne de compte des fichiers de test, le suffixe de base et la visionneuse classique. La note parle de libellés « plausibles, sans capture » — [reports/Note_de_passation_Claude.md §20](reports/Note_de_passation_Claude.md).
- Toujours à examiner, d'après l'audit : tmux/SSH, les couleurs comparées au vrai binaire et la hauteur du plein écran avec de longues fenêtres — [reports/Fuller écarts subtils Claude Code 2.1.280.md:86-88, 135, 168](reports/Fuller%20écarts%20subtils%20Claude%20Code%202.1.280.md).
- Windows : le code contient des branches conditionnelles, mais la CI ne tourne que sur `ubuntu-latest` (`.github/workflows/`, Node 20 et 22), donc sans vérification Windows.

## 3. Commandes slash et fenêtres

### Takeaway
Fuller compte **38 commandes intégrées** (6 alias) et y ajoute les commandes et skills personnalisés. Presque toutes les fenêtres de Claude Code capturées le 24/09 ont un équivalent : Help, Settings à 4 onglets, Permissions à 6 onglets, modèle, effort, thème, reprise, rewind, agents, /btw, contexte, statistiques, MCP, confiance. Il en existe aussi une propre à Fuller (quota). Plusieurs commandes courantes de Claude Code n'existent pas, par exemple `/vim`, `/terminal-setup`, `/statusline`, `/ide`, `/plugin` et `/color`.

### Cited Findings
- Liste complète, tirée du tableau `COMMANDS` ([src/ui/commands.ts:277-809](src/ui/commands.ts)) :
  - `/help` : fenêtre Help à onglets General, Commands et Custom commands [testé+CC] — `commands.ts:279` ; [src/ui/InfoDialogs.tsx:47-60](src/ui/InfoDialogs.tsx).
  - `/clear` (alias `/reset`, `/new`) : nouvelle conversation avec un contexte vide, efface l'écran et le scrollback [testé+CC] — `commands.ts:288-292`.
  - `/compact [focus]` : résume la conversation, avec « Error: No messages to compact » si elle est vide [testé+CC] — `commands.ts:294-299` ; [3b](reports/parite-cc/3b-commandes-actions.md).
  - `/status` : Settings sur l'onglet Status (version, nom et identifiant de session, cwd, modèle et fenêtre de contexte, quota, git, mode et règles, thème, fichiers de mémoire, sources de réglages) [testé+CC] — `commands.ts:301-304, 234-245`.
  - `/usage` (alias `/cost`) : onglet Usage (tokens totaux, dernière requête, appels, part du prompt servie par le cache, sorties d'outils effacées, durée, lien vers les prix, sans montant en $) [testé+CC] — `commands.ts:306-310, 248-256`.
  - `/stats` : onglet Stats (carte d'activité sur un an ; All time, 7 jours, 30 jours avec `r` ; vue Models avec `v`) [testé] — `commands.ts:312-315` ; [src/ui/StatsView.tsx](src/ui/StatsView.tsx) ; [tests/stats.test.ts](tests/stats.test.ts) ; [3f « Finitions »](reports/parite-cc/3f-decisions.md).
  - `/config` : onglet Config avec recherche. Réglages : Auto-compact, Effort, Reply after ! commands, Model fallback, Learned memory, Check work before finishing, Clear old tool output, Review changes, Verbose output, Notifications, Default permission mode, Theme, Model [testé] — `commands.ts:153-213, 317-320`.
  - `/context` : grille de 200 cases (⛀ ⛁ ⛶ ⛝) avec les catégories en couleur ; estimation à 4 caractères par token [testé+CC] — `commands.ts:322-350` ; [src/ui/ContextView.tsx](src/ui/ContextView.tsx) ; [tests/infoDialogs.test.tsx](tests/infoDialogs.test.tsx).
  - `/model [nom|list|list all]` : sélecteur alimenté par l'API ListModels ; Entrée enregistre par défaut, `s` vaut pour la session, `a` montre tous les modèles, ←/→ règlent l'effort [testé+CC] — `commands.ts:352-384` ; [src/ui/ModelPicker.tsx:87](src/ui/ModelPicker.tsx) ; [tests/overlays.test.tsx](tests/overlays.test.tsx) ; [model-selecteur.md](reports/parite-cc/model-selecteur.md).
  - `/effort [niveau|status]` : fenêtre Effort (←/→, Entrée par défaut, `s` pour la session) [testé+CC] — `commands.ts:386-402` ; [src/ui/EffortDialog.tsx](src/ui/EffortDialog.tsx) ; [3c](reports/parite-cc/3c-commandes-reglages.md).
  - `/keybindings` : crée et ouvre `~/.fuller/keybindings.json` [non testé] — `commands.ts:404-411`.
  - `/theme [nom]` : sélecteur de thème [testé+CC] — `commands.ts:413-424`.
  - `/permissions` (alias `/allowed-tools`) `[add|deny|remove <règle>]` : fenêtre Permissions ; les sous-commandes texte restent [testé+CC] — `commands.ts:426-458`.
  - `/plan` : active ou coupe le mode plan (« Enabled plan mode ») [testé+CC] — `commands.ts:460-467`.
  - `/accept-edits` : active ou coupe acceptEdits (propre à Fuller) — `commands.ts:469-472`.
  - `/mode <mode>` : fixe le mode de permission (propre à Fuller) — `commands.ts:474-482`.
  - `/init` : le modèle crée ou améliore `FULLER.md` ; le prompt envoyé est en français — `commands.ts:484-493`.
  - `/memory` : fenêtre Memory (instructions utilisateur et projet, mémoire apprise du projet et de tous les projets) ; Entrée ouvre le fichier [testé+CC] — `commands.ts:495-519`.
  - `/learn <note>` : ajoute une note à la mémoire apprise du projet (propre à Fuller) — `commands.ts:521-546`.
  - `/rewind` : menu Rewind [testé+CC] — `commands.ts:548-551` ; [tests/rewindMenu.test.tsx](tests/rewindMenu.test.tsx).
  - `/checkpoints` : liste en texte des points de reprise de fichiers (propre à Fuller) — `commands.ts:553-559`.
  - `/sessions` : liste en texte des sessions du projet (propre à Fuller) — `commands.ts:561-571`.
  - `/resume` : sélecteur de sessions et reprise sans quitter [testé+CC] — `commands.ts:573-576` ; [tests/sessionPicker.test.tsx](tests/sessionPicker.test.tsx).
  - `/diff` : panneau ou visionneuse (voir section 2) — `commands.ts:578-581`.
  - `/export [fichier]` : fenêtre Copy to clipboard / Save to file, en Markdown [testé+CC] — `commands.ts:583-613`.
  - `/doctor` (alias `/checkup`) : contrôles locaux (clé, git, TTY, truecolor, FULLER.md, `~/.fuller`) ; chez Claude Code, c'est le modèle qui mène le contrôle (écart voulu) — `commands.ts:615-635` ; [3a](reports/parite-cc/3a-commandes-fenetres.md).
  - `/btw <question>` : panneau de question à part [testé+CC] — `commands.ts:637-646`.
  - `/add-dir [chemin]` : fenêtre de saisie avec complétion par Tab [testé+CC] — `commands.ts:648-672`.
  - `/skills [reload]` : liste en texte des commandes et skills personnalisés — `commands.ts:674-687`.
  - `/copy [N]` : copie la N-ième réponse en partant de la dernière (outil du système, sinon OSC 52) [testé+CC] — `commands.ts:689-706` ; [src/utils/clipboard.ts:3-26](src/utils/clipboard.ts).
  - `/rename <titre>` : renomme la session — `commands.ts:708-717`.
  - `/agents` : message qui renvoie vers `.fuller/agents/` et `.claude/agents/`, avec la liste des agents disponibles [testé+CC] — `commands.ts:719-726`.
  - `/mcp` : fenêtre « Manage MCP servers » (✔, ✘ ou ◯, nombre d'outils ou erreur), en lecture seule — `commands.ts:728-747`.
  - `/tasks [kill <id>]` : fenêtre « Background » — `commands.ts:749-769`.
  - `/hooks` : fenêtre en lecture seule avec les 9 événements et le nombre de hooks ; Entrée affiche les hooks de l'événement [testé+CC] — `commands.ts:139-148, 771-788`.
  - `/verbose` : ouvre ou ferme le lecteur du transcript — `commands.ts:790-793`.
  - `/about` : à propos de Fuller et de Thomas Fuller — `commands.ts:795-802`.
  - `/exit` (alias `/quit`) : quitte, en rappelant `fuller --continue` — `commands.ts:804-808` ; [src/ui/App.tsx:448-456](src/ui/App.tsx).
- [testé] Commandes et skills personnalisés : `.fuller/commands/*.md`, `.fuller/skills/<nom>/SKILL.md`, avec repli sur `.claude/*`. Ils apparaissent dans le menu `/` ; frontmatter `allowed-tools`, `argument-hint`, etc. Une commande inconnue répond « Unknown command: /x » — [src/ui/App.tsx:523-532](src/ui/App.tsx) ; [src/ui/commands.ts:816-841](src/ui/commands.ts) ; [tests/skills.test.ts](tests/skills.test.ts) ; [README.md](README.md).
- [absent] Ces noms de commande ne figurent pas dans `COMMANDS` : `/vim`, `/terminal-setup`, `/statusline`, `/output-style`, `/ide`, `/plugin`, `/login`, `/logout`, `/review`, `/pr-comments`, `/release-notes`, `/feedback`, `/bug`, `/upgrade`, `/todos`, `/sandbox`, `/security-review`, `/privacy-settings`, `/install-github-app`, `/color`, `/fork`, `/branch`, `/bashes`, `/version`. La capture 3f atteste que `/color` existe chez Claude Code. `/version` n'existe pas chez Claude Code et n'a pas été ajouté, volontairement — recherche dans `src/ui/commands.ts` ; [reports/parite-cc/3f-decisions.md:63](reports/parite-cc/3f-decisions.md) ; [reports/parite-cc/3c-commandes-reglages.md:17](reports/parite-cc/3c-commandes-reglages.md).
- Fenêtres, avec leurs touches :
  - Settings (`TabbedDialog`) : onglets Status, Config, Usage, Stats ; ←/→ ou Tab changent d'onglet ; ↓ mène de la rangée d'onglets à la recherche puis à la liste ; Status et Usage défilent (↑/↓, PgUp/PgDn, Début/Fin) [testé+CC] — [src/ui/InfoDialogs.tsx:77-97](src/ui/InfoDialogs.tsx) ; [tests/infoDialogs.test.tsx](tests/infoDialogs.test.tsx).
  - Permissions : onglets Recently denied, Allow, Ask, Deny, Auto mode, Workspace ; `/` pour filtrer ; « Add a new rule… » ; suppression après confirmation ; règles soft intégrées du mode auto activables ou non [testé+CC] — [src/ui/PermissionsDialog.tsx:16-29, 199](src/ui/PermissionsDialog.tsx).
  - Reprise de session (`SessionPicker`) : recherche ; Ctrl+A pour tous les projets ; Ctrl+B pour la branche courante ; Espace pour l'aperçu ; Ctrl+R pour renommer ; Ctrl+Suppr pour supprimer avec confirmation (Y/N) ; PgUp/PgDn ; molette. Une session d'un autre dossier affiche la commande `cd … && fuller --resume <id>` et la copie [testé+CC] — [src/ui/SessionPicker.tsx:173-174](src/ui/SessionPicker.tsx) ; [src/ui/App.tsx:75-80, 799-823](src/ui/App.tsx) ; [3d](reports/parite-cc/3d-reprise-et-historique.md).
  - Rewind : prompts du plus ancien au plus récent, chacun avec « N files changed » ou « No code changes ». Actions : Restore code and conversation, Restore conversation, Restore code, Summarize from here, Summarize up to here, Never mind. Une copie de la session est gardée avant le retour (bifurcation) [testé+CC] — [src/ui/App.tsx:824-843](src/ui/App.tsx) ; [3e](reports/parite-cc/3e-agents-bifurcation-rewind.md).
  - Vue des agents (← sur un prompt vide) : groupes Needs input, Working, Completed. Entrée ouvre le rapport ou revient à la conversation ; Échap ou → revient ; Ctrl+X arrête et supprime ; deux Ctrl+C quittent ; un texte tapé lance un nouvel agent au contexte vierge [testé+CC] — [src/ui/AgentsView.tsx](src/ui/AgentsView.tsx) ; [src/ui/App.tsx:699-713](src/ui/App.tsx) ; [tests/agentsView.test.tsx](tests/agentsView.test.tsx).
  - Panneau /btw : « ↑/↓ to scroll · c to copy · f to fork · Esc to close » [testé+CC] — [src/ui/BtwPanel.tsx:66](src/ui/BtwPanel.tsx).
  - Contexte : grille (voir `/context`).
  - Statistiques : touches `r` et `v`.
  - Quota : voir la section 6.
  - Approbation des serveurs MCP d'un projet : pour un serveur, trois choix ; pour plusieurs, des cases à cocher avec Espace, « Enable selected », et Échap pour tout refuser. Les réponses sont gardées dans `~/.fuller/mcp-approvals.json` [testé+CC 2.1.282] — [src/ui/McpApprovalDialog.tsx:48, 87](src/ui/McpApprovalDialog.tsx) ; [tests/mcpApproval.test.tsx](tests/mcpApproval.test.tsx) ; [Note §12](reports/Note_de_passation_Claude.md).
  - Confiance dans le dossier : « Accessing workspace », avec « No, exit » présélectionné ou « Yes, I trust this folder » [testé] — [src/ui/TrustDialog.tsx](src/ui/TrustDialog.tsx) ; [tests/trust.test.tsx](tests/trust.test.tsx).
  - Fenêtres génériques `ListDialog` et `InputDialog` [testé] — [src/ui/InfoDialogs.tsx:218-275](src/ui/InfoDialogs.tsx).
  - Aide `?` : trois colonnes placées comme chez Claude Code, ne listant que les raccourcis que Fuller a [testé+CC] — [src/ui/ShortcutsHelp.tsx:12-16](src/ui/ShortcutsHelp.tsx) ; [tests/shortcutsHelp.test.tsx](tests/shortcutsHelp.test.tsx).
- [défaut] Dans `/tasks`, l'aide annonce « Enter to view », mais les lignes n'ont pas d'`onSelect` : Entrée ferme simplement la fenêtre. On ne peut pas lire la sortie d'une tâche depuis cette fenêtre — [src/ui/commands.ts:760-767](src/ui/commands.ts) ; [src/ui/InfoDialogs.tsx:256](src/ui/InfoDialogs.tsx).
- [absent] `/mcp` ne permet ni reconnexion, ni authentification, ni désactivation d'un serveur (lignes sans action), et n'a pas d'état « needs authentication » (pas d'OAuth) — [src/ui/commands.ts:728-747](src/ui/commands.ts) ; [reports/parite-cc/3a-commandes-fenetres.md:37](reports/parite-cc/3a-commandes-fenetres.md).

### Inferences
- Les commandes absentes relèvent surtout de fonctions que Fuller n'a pas : plugins, IDE, styles de sortie, compte, vim, réglage du terminal. Il n'y a pas d'écart de présentation sur des commandes existantes.

### Gaps
- La liste des commandes de Claude Code 2.1.28x n'a pas été rapprochée ici de sa documentation. Les absences ci-dessus sont des absences dans Fuller ; leur existence chez Claude Code reste à confirmer par la recherche côté Claude Code, sauf `/color`, capturé.

## 4. Permissions, modes plan et auto, hooks, MCP, sous-agents, liste de tâches, tâches en arrière-plan

### Takeaway
La carte de permission reprend celle de Claude Code : titre selon l'outil, diff encadré, choix numérotés, Tab pour commenter, Maj+Tab pour changer de mode. Les modes manual, acceptEdits, plan et auto tournent avec Maj+Tab. Le mode auto repose sur un appel au modèle qui joue le classificateur, et le mode plan sur une approbation en 3 options. L'interface MCP et celle des hooks sont en lecture seule. Les sous-agents et les tâches de fond sont visibles, mais `/tasks` ne permet pas d'ouvrir une sortie.

### Cited Findings
**Carte de permission**
- [testé+CC] Carte bordée en haut, dont le titre dépend de l'outil : Bash command, Edit file, Write file, Fetch, Read file, List directory, Search, « Ready to code? » pour `exit_plan_mode`, « Tool use » sinon. Une édition affiche son diff entre deux filets `╌`. Suivent ⚠ pour un danger, la question, puis les choix numérotés.

  Touches :
  - ↑/↓, Ctrl+P/N ou j/k : se déplacer ;
  - Home/End : premier ou dernier choix ;
  - 1 à 9 : choix direct ;
  - Entrée : valider ;
  - Échap ou Ctrl+C : Non ;
  - Tab : commentaire attaché à Oui ou Non, sauf pour WebFetch et les règles persistantes ;
  - Maj+Tab : choix qui change de mode.

  La carte se compacte sous 20 lignes de terminal et se réduit encore sous 16 — [src/ui/PermissionPrompt.tsx:34-164](src/ui/PermissionPrompt.tsx) ; [tests/inputParity.test.tsx](tests/inputParity.test.tsx) (5 cas de permission) ; [reports/parite-cc/2.4-outils-et-diffs.md](reports/parite-cc/2.4-outils-et-diffs.md).
- [testé] Choix selon l'outil :
  - édition : « Yes, and switch to accept edits (…) for this session (shift+tab) » ;
  - Bash : « Yes, and don't ask again for <noms> commands in <cwd> » ;
  - sudo : la commande exacte (« don’t ask again for: … ») ;
  - commande dangereuse ou composée : Oui/Non seulement ;
  - web : « don't ask again for <hôte> ».

  [src/permissions/rules.ts:319-364](src/permissions/rules.ts) ; [tests/rules.test.ts](tests/rules.test.ts).
- [testé] Un refus sans commentaire arrête le tour principal ; un refus commenté est transmis au modèle — [README.md](README.md) (« Vues et accessibilité ») ; [reports/Fuller écarts subtils Claude Code 2.1.280.md:120](reports/Fuller%20écarts%20subtils%20Claude%20Code%202.1.280.md).
- [non vérifié CC] Les outils MCP passent par la carte générique « Tool use » avec les arguments en JSON (400 caractères au plus) — [src/ui/PermissionPrompt.tsx:94-101, 204](src/ui/PermissionPrompt.tsx).
- [testé] Accès sécurisés :
  - sudo : un encadré « Password required » remplace la saisie et `sudo` lit lui-même le TTY (`useTerminalHandoff`) ;
  - hors du projet, chaque accès demande la permission ;
  - la confiance dans le dossier est demandée avant tout chargement.

  [src/ui/useTerminalHandoff.ts](src/ui/useTerminalHandoff.ts) ; [tests/nativeTerminal.test.ts](tests/nativeTerminal.test.ts), [tests/trust.test.tsx](tests/trust.test.tsx) ; [README.md](README.md).

**Modes**
- [testé+CC] Maj+Tab fait tourner manual → acceptEdits → plan → auto ; `bypassPermissions` n'entre dans le cycle que si la session a démarré avec. `/plan`, `/accept-edits`, `/mode` et `--permission-mode` règlent aussi le mode — [src/ui/App.tsx:436-446](src/ui/App.tsx) ; [reports/parite-cc/3f-decisions.md:30](reports/parite-cc/3f-decisions.md).
- [testé, choix non comparés en détail] Mode plan : `exit_plan_mode` affiche « Would you like to proceed? » avec « Yes, and auto-accept edits », « Yes, manually approve edits » et « No, keep planning ». Non ouvre un champ de commentaire. Le plan est enregistré dans `~/.fuller/plans/` — [src/agent/loop.ts:1286-1290](src/agent/loop.ts) ; [src/ui/PermissionPrompt.tsx:61, 176-178](src/ui/PermissionPrompt.tsx) ; [README.md](README.md).
- [testé+CC] Mode auto :
  - un appel au modèle, à la réflexion la plus basse, juge l'action ;
  - 12 règles soft allow, 14 soft deny, plus des hard deny ;
  - un refus s'affiche « Denied by auto mode · raison » et apparaît dans Recently denied ;
  - après 30 s ou en cas d'erreur, Fuller pose la question à l'utilisateur (« Auto mode could not decide ») ;
  - les demandes de l'utilisateur vont entières au contrôleur ; au-delà de 24 000 caractères, Fuller demande une approbation.

  [src/agent/loop.ts:1075, 1336](src/agent/loop.ts) ; [reports/parite-cc/3f-decisions.md:26-40](reports/parite-cc/3f-decisions.md) ; [tests/autoMode.test.ts](tests/autoMode.test.ts) ; [README.md](README.md).

**Hooks**
- [testé] 9 événements, au contrat de Claude Code. `/hooks` est en lecture seule. Dans le transcript, les hooks ne se voient qu'à travers des avis : « ⚠ <event> hook failed », « ⛔ Prompt blocked by hook », « ↺ Stop hook: … », « ⛔ Compaction blocked by hook » — [src/agent/loop.ts:253, 735, 930, 1566](src/agent/loop.ts) ; [src/ui/commands.ts:139-148, 771-788](src/ui/commands.ts) ; [tests/hooks.test.ts](tests/hooks.test.ts).

**MCP**
- [testé] Transports stdio et HTTP (streamable, avec repli SSE) ; outils `mcp__serveur__outil` ; approbation des serveurs d'un projet ; `/mcp` pour l'état. Aucun code OAuth ; pas de ressources ni de prompts MCP — [README.md](README.md) (MCP) ; [tests/mcpManager.test.ts](tests/mcpManager.test.ts), [tests/mcpSchema.test.ts](tests/mcpSchema.test.ts) ; recherche de « oauth » dans `src/` : aucun résultat ; [etat_actuel_v2 §3.9](research_notes/Fuller%20écarts%20restants%20vs%20Claude%20Code/etat_actuel_v2.md).

**Sous-agents**
- [testé] L'outil `agent` s'affiche `Agent(<type>: <description>)`, et la progression du sous-agent (outils lancés, refus, attente de permission) remonte en direct. Types intégrés : `general-purpose` et `Explore` ; définitions personnalisées dans `.fuller/agents/`.

  `/btw` puis `f`, ou un texte tapé dans la vue des agents, lance un agent en arrière-plan. À la fin s'affiche « ● Agent "…" finished · Ns », puis le rapport est remis au modèle principal — [src/tools/registry.ts:172-179, 516, 537](src/tools/registry.ts) ; [src/agent/subagent.ts:24, 71-139](src/agent/subagent.ts) ; [src/agent/loop.ts:1428-1505](src/agent/loop.ts) ; [tests/subagents.test.ts](tests/subagents.test.ts).
- [absent, portée différente] La vue des agents ne liste pas les autres sessions de la machine et ne permet pas d'y répondre avec Espace — [reports/parite-cc/3e-agents-bifurcation-rewind.md](reports/parite-cc/3e-agents-bifurcation-rewind.md) (« Portée »).

**Liste de tâches**
- [testé] Panneau collé au-dessus de la saisie, « Tasks d/n (ctrl+t to hide) » ; ☐ à faire, spinner en cours, ☑ fait ; de 3 à 6 éléments selon la hauteur. Il réapparaît dès qu'une tâche reste ouverte. Une ligne « Update Todos » s'ajoute au transcript à chaque mise à jour, et la liste est restaurée avec la session — [src/ui/TodoPanel.tsx:12-36](src/ui/TodoPanel.tsx) ; [src/ui/App.tsx:353, 741-743](src/ui/App.tsx) ; [tests/todos.test.ts](tests/todos.test.ts). Comparaison avec Claude Code impossible le 24/09 : dans la session capturée, Claude Code n'a pas utilisé d'outil de liste — [2.5-2.6:14](reports/parite-cc/2.5-2.6-erreurs-historique-reprise.md).

**Tâches shell en arrière-plan**
- [testé] `execute_bash(run_in_background)` et Ctrl+B, qui reprend une commande déjà lancée sans la relancer. Le pied de page affiche un compteur ; `task_output` et `task_kill` servent au modèle, `/tasks` et `/tasks kill <id>` à l'utilisateur. Une notification signale la fin dans le transcript et au modèle — [src/agent/loop.ts:652](src/agent/loop.ts) ; [src/ui/InputBox.tsx:590](src/ui/InputBox.tsx) ; [src/ui/Footer.tsx:95](src/ui/Footer.tsx) ; [tests/background.test.ts:17-79](tests/background.test.ts).

### Inferences
- Pour être au niveau de Claude Code, l'interface MCP devrait pouvoir agir sur un serveur (reconnecter, s'authentifier, désactiver) et proposer les ressources dans `@`. Aujourd'hui, elle affiche seulement l'état.

### Gaps
- Pas de capture Claude Code des choix du dialogue de plan ni de la carte d'un outil MCP ; la conformité de ces deux écrans n'est pas établie.
- Nulle part n'est dit si Claude Code affiche en direct la sortie d'un hook dans le transcript ; non comparé.

## 5. Écarts connus d'après les documents du projet : non faits, voulus, non vérifiés

### Takeaway
Dans les documents de parité récents (phase 3, 3f, section 20 de la note de passation), presque tout est marqué « Fait » : `phase3-a-faire.md` n'a plus de ligne ouverte, et la liste de parité du panneau `/diff` est vide. Il reste des écarts voulus ou imposés par Ink, des points jamais capturés, et une série d'absences de fond héritée de l'inventaire du 23/09. Cet inventaire est **en partie périmé** : le plein écran, la souris, le lecteur, `keybindings.json`, Ctrl+G, le lecteur d'écran, `/config`, la grille `/context` et la restauration de la conversation existent désormais.

### Cited Findings
**Non faits**
- [absent] L'onglet Auto mode de `/permissions` n'a pas la ligne « Environment » de Claude Code — [reports/parite-cc/3f-decisions.md:40](reports/parite-cc/3f-decisions.md).
- [absent] Pas de ressources MCP dans le menu `@` — [1.5:68](reports/parite-cc/1.5-menu-slash-et-arobase.md).
- [absent] Pas d'OAuth MCP ni d'état « needs authentication » dans `/mcp` — [3a:37](reports/parite-cc/3a-commandes-fenetres.md).
- [absent] La vue Ctrl+O n'a pas la ligne heure + modèle avant chaque réponse ni le chemin absolu souligné dans `Read(…)` — [2.1-2.3 « Restant »](reports/parite-cc/2.1-2.3-rendu-conversation.md).
- [absent] Claude Code affiche ses conseils sous l'animation pendant l'attente ; Fuller les affiche sous la bannière — [2.4 « Restant »](reports/parite-cc/2.4-outils-et-diffs.md).
- [absent] La vue des agents ne montre pas les autres sessions de la machine — [3e « Portée »](reports/parite-cc/3e-agents-bifurcation-rewind.md).
- [absent] `/theme` n'a pas « New custom theme… » — [3e « Écarts voulus »](reports/parite-cc/3e-agents-bifurcation-rewind.md).
- [absent] Toujours vrais dans le code actuel, d'après l'inventaire du 23/09 revérifié par recherche :
  - pas de mode vim ;
  - pas de liens OSC 8 ;
  - pas de sélection au clavier dans la saisie ;
  - pas de traitement de l'IME ;
  - pas de négociation du protocole clavier kitty ;
  - pas de réflexion affichée ;
  - pas de coût en $ (`total_cost_usd` vaut 0) ;
  - pas d'outils MultiEdit, NotebookEdit ni recherche web (les outils sont `execute_bash`, `task_output`, `task_kill`, `read_file`, `outline_file`, `write_file`, `edit_file`, `list_directory`, `search_files`, `glob`, `todo_write`, `agent`, `exit_plan_mode`, `skill`, `memory`, `web_fetch`) ;
  - pas de plugins, de styles de sortie, d'intégration IDE, de worktrees ni de mise à jour automatique ;
  - pas de variante ASCII des glyphes ;
  - les changements faits par Bash ne sont pas dans les points de reprise.

  [research_notes/…/etat_actuel_v2.md §1.12, §2.13, §8, §9](research_notes/Fuller%20écarts%20restants%20vs%20Claude%20Code/etat_actuel_v2.md) ; [src/tools/registry.ts:20-223](src/tools/registry.ts) ; [src/ui/glyphs.ts](src/ui/glyphs.ts) ; [src/ui/useStatusLine.ts:34](src/ui/useStatusLine.ts) ; [README.md](README.md) (Checkpoints : « Les modifications faites par Bash ne sont pas capturées »).
- [défaut] `/tasks` affiche « Enter to view » mais n'ouvre rien (voir section 3). Le conseil de démarrage décrit un cycle Maj+Tab dépassé (voir section 2) — [src/ui/commands.ts:766](src/ui/commands.ts) ; [src/branding.ts:33](src/branding.ts).

**Voulus ou imposés par Ink**
- La saisie s'arrête une ligne au-dessus du bas de l'écran, et le fond des diffs une colonne avant le bord : Ink redessine tout l'écran quand l'image fait la hauteur exacte du terminal, et la mise en page garde une colonne de marge — [2.1-2.3 « Restant »](reports/parite-cc/2.1-2.3-rendu-conversation.md) ; [2.4 « Restant »](reports/parite-cc/2.4-outils-et-diffs.md) ; [3f:54](reports/parite-cc/3f-decisions.md).
- Pas de regroupement des outils en classique (voir section 2).
- Les niveaux d'effort sont ceux de Gemini (minimal, low, medium, high), et non les six niveaux de Claude — [model-selecteur.md](reports/parite-cc/model-selecteur.md).
- Thèmes supplémentaires ; la ligne du bas dit « Syntax highlighting enabled » sans nom de thème syntaxique — [3e](reports/parite-cc/3e-agents-bifurcation-rewind.md).
- `/doctor` fait des contrôles locaux au lieu d'une requête au modèle — [3a](reports/parite-cc/3a-commandes-fenetres.md).
- `/version` n'est pas ajouté — [3c:17](reports/parite-cc/3c-commandes-reglages.md).
- La bannière ne dit plus « FULLER.md loaded » : l'information est dans `/status` et `/memory` — [1.1:36](reports/parite-cc/1.1-banniere.md).
- Le conseil de démarrage n'apparaît qu'un lancement sur trois — [1.1:44](reports/parite-cc/1.1-banniere.md).
- `/tasks kill`, `/permissions add|deny|remove` et `/export <fichier>` sont gardés en plus des fenêtres — [3a](reports/parite-cc/3a-commandes-fenetres.md), [3b](reports/parite-cc/3b-commandes-actions.md).

**Non vérifiés ou non capturés**
- Section 20 : les libellés de la ligne des fichiers de test et générés, le suffixe de base, l'aspect de l'indicateur de sélection et la visionneuse classique ont été faits d'après la documentation, sans capture — [Note §20](reports/Note_de_passation_Claude.md).
- Le message après Entrée dans `/model` (modèle par défaut) n'a pas été capturé chez Claude Code — [model-selecteur.md:69](reports/parite-cc/model-selecteur.md).
- Pendant l'exécution d'une commande, Claude Code affiche sa description puis `⎿ $ commande` : « à comparer » — [2.1-2.3](reports/parite-cc/2.1-2.3-rendu-conversation.md).
- L'erreur 429 (« API Error (429) · Retrying in 5 seconds… (attempt 4/5) ») reste à comparer — [1.6:56](reports/parite-cc/1.6-animation-attente.md).
- `/init` n'a pas été comparé — [3b:3](reports/parite-cc/3b-commandes-actions.md).
- Pas de parité visuelle établie avec le vrai binaire pour les couleurs ; pas d'essai sous tmux/SSH ; sélection native, hauteur avec de longues fenêtres et redimensionnement pendant l'authentification non vérifiés. Le sudo interactif ne vaut que pour un `sudo` visible du parseur : ni le mode headless, ni le lecteur d'écran, ni les tâches de fond n'en bénéficient — [écarts subtils:86-88, 135, 168-170](reports/Fuller%20écarts%20subtils%20Claude%20Code%202.1.280.md).
- Section 3 de la note de passation, pour mémoire (ce n'est pas de l'interface) : les rappels du lot 2 n'ont été observés qu'avec un Gemini simulé, et les seuils viennent de Gemini CLI — [Note §3](reports/Note_de_passation_Claude.md).

**Déjà corrigés, à ne plus compter comme écarts**
- FUI-01 à FUI-16 : collages, frontières de mots, envoi immédiat, Ctrl+R en plein écran, commentaires de permission, suggestion, défilement, `[` et `v`, Ctrl+B, complétion au milieu du prompt, débordement de la zone vivante, retry, sudo, trace du prompt, carte de permission, règle sudo — [écarts subtils:110-195](reports/Fuller%20écarts%20subtils%20Claude%20Code%202.1.280.md).
- Tout `phase3-a-faire.md` est à « Fait ». Seule nuance : la ligne Settings dit « pas d'onglet Stats », or cet onglet a été ajouté ensuite dans les finitions de 3f — [phase3-a-faire.md](reports/parite-cc/phase3-a-faire.md) ; [3f « Finitions »](reports/parite-cc/3f-decisions.md) ; [src/ui/InfoDialogs.tsx:77](src/ui/InfoDialogs.tsx).
- Les restes de 1.6 et de model-selecteur (en-tête « Conversation · N rows », mots coupés, retraits, fond du message utilisateur) sont corrigés par la refonte 2.1-2.3. Le code actuel de `FullscreenTranscript.tsx` n'a plus d'en-tête et coupe entre les mots — [src/ui/FullscreenTranscript.tsx:13-16, 97-101](src/ui/FullscreenTranscript.tsx) ; [2.1-2.3](reports/parite-cc/2.1-2.3-rendu-conversation.md).
- Sections 12 et 19 de la note de passation : les « pas encore fait » du panneau `/diff` (Ctrl+X B, fichiers de test et générés, sélection de lignes, visionneuse classique) sont faits en section 20. La section 19 contient des décisions hors interface : `maxTurns` passe à 200, nettoyage de `/tmp`, facturation Tier 1.

### Inferences
- Les écarts qui restent dans l'interface sont surtout :
  - des fonctions de fond absentes : vim, OSC 8, sélection dans l'application, réflexion visible, actions MCP ;
  - des détails jamais capturés, comme ceux de la section 20.

  Il ne reste pas de gros écart de disposition sur les écrans déjà comparés.

### Gaps
- `reports/Fuller TUI écarts avec Claude Code.md` et les notes plus anciennes de `research_notes/Fuller TUI écarts avec Claude Code/` n'ont pas été relus ligne à ligne : ils sont antérieurs à la refonte et au 23/09.

## 6. Ce que Fuller a en plus : fonctions propres à Gemini ou à Fuller, à ne pas compter comme écarts

### Takeaway
Fuller ajoute toute une couche de gestion du fournisseur Gemini : plusieurs clés avec rotation, ordonnanceur de quotas par clé et par modèle, fenêtre de bascule de modèle, barre de quota, liste des modèles gratuits, `--check-keys`. Il ajoute aussi des garde-fous d'agent réglables dans `/config`, et des commandes et thèmes supplémentaires.

### Cited Findings
- Clés et quotas :
  - plusieurs clés (`GEMINI_API_KEYS`) avec rotation silencieuse ;
  - une clé refusée est écartée 24 h ;
  - attente sur une limite par minute (« Rate limit reached · continuing in 34s ») ;
  - chaîne de modèles de repli (`--fallback-model`, réglage `Model fallback` : ask, auto ou off) ;
  - `fuller --check-keys` et `--list-models [--all]`.

  [README.md](README.md) (« Clés et quotas ») ; [src/index.tsx:67-70](src/index.tsx) ; [src/ui/commands.ts:171](src/ui/commands.ts) ; [tests/keyPool.test.ts](tests/keyPool.test.ts), [tests/keyCheck.test.ts](tests/keyCheck.test.ts), [tests/modelFallback.test.ts](tests/modelFallback.test.ts).
- Fenêtre de quota (`QuotaDialog`) :
  - trois cas : « Usage limit reached for X », « X is overloaded (high demand) », « This conversation is too long for X » ;
  - choix : Keep trying (surcharge seulement), Switch to Y, Switch to Y and don't ask again, Stop ;
  - une barre d'usage cumulée sur toutes les clés.

  Barre du pied de page : `quota █████░░░░░ 50% · resets in …`, en couleur d'alerte à partir de 80 % ; ligne Quota dans `/status` — [src/ui/QuotaDialog.tsx](src/ui/QuotaDialog.tsx) ; [src/ui/Footer.tsx:99-102](src/ui/Footer.tsx) ; [src/ui/commands.ts:240](src/ui/commands.ts) ; [tests/quotaDialog.test.tsx](tests/quotaDialog.test.tsx).
- Autour du modèle :
  - niveau d'effort `minimal` (◌), propre à Gemini ;
  - sélecteur alimenté par l'API ListModels, filtré sur les modèles gratuits, avec `a` pour tout afficher ;
  - `/model list` ;
  - ligne « Cached prompt » (cache implicite de Gemini) dans Usage.

  [src/ui/Footer.tsx:28-29](src/ui/Footer.tsx) ; [src/ui/commands.ts:252](src/ui/commands.ts) ; [README.md](README.md) (Modèles).
- Garde-fous de l'agent, réglables dans `/config` : Check work before finishing, Review changes (risky, always ou off), Clear old tool output, Learned memory (`/learn`), Reply after ! commands — [src/ui/commands.ts:166-195](src/ui/commands.ts) ; [README.md](README.md) (« Mémoire, garde-fous et banc d'essai »).
- Commandes et touches en plus :
  - `/learn`, `/checkpoints`, `/sessions`, `/about`, `/mode`, `/accept-edits`, `/verbose`, alias `/checkup` ;
  - Ctrl+Suppr pour supprimer une session dans `/resume`, repris d'Antigravity (commit `b6065d8`) ;
  - Ctrl+E dans le lecteur du transcript classique ;
  - `--tui classic|fullscreen` ;
  - thèmes monokai, ocean, forest, lagoon, olive, amethyst et citrus.

  [src/ui/commands.ts](src/ui/commands.ts) ; [README.md](README.md) (Commandes slash) ; [3e « Écarts voulus »](reports/parite-cc/3e-agents-bifurcation-rewind.md).

### Inferences
- Ces fonctions sont des ajouts pour le fournisseur ou pour la robustesse de l'agent. Un comparatif avec Claude Code devrait les classer à part, et non comme des différences à corriger.

### Gaps
- `--screen-reader`, `/skills`, `/stats` et `--tui` ont peut-être un équivalent chez Claude Code : ce n'est pas vérifié ici, donc ils ne sont classés ni en ajouts ni en écarts.
