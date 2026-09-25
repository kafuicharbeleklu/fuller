# Claude Code (TUI, v2.1.282/2.1.283, fin septembre 2026) : permissions, sécurité et extensibilité telles que l'utilisateur les voit

Portée : prompts de permission, modes, plan mode, sandbox, trust/onboarding, hooks, MCP, subagents/teams, skills, plugins, mémoire, sessions, IDE, tâches de fond. Fuller n'est pas étudié ici.

Méthode et sources :
- **Binaire local `claude` v2.1.282** (installé le 24/09/2026), chaînes extraites avec `strings` : c'est la source la plus fiable pour le texte exact des libellés. Citée comme [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282). Le code est minifié (React/Ink compilé), donc l'ordre des options se déduit de l'ordre des `push()` ; ces cas sont signalés.
- **Documentation officielle** `https://code.claude.com/docs/en/<page>` (versions `.md` téléchargées le 25/09/2026).
- **CHANGELOG officiel** ([CHANGELOG.md](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)), dont la dernière entrée est **2.1.283**.
- Les notes du 22/09 (`research_notes/Fuller TUI écarts avec Claude Code/claude_code_rendu_outils_permissions.md`) couvraient déjà une partie de ce sujet. Ce document les complète avec les libellés exacts tirés du binaire et corrige ce qui a changé depuis.

---

## Q1. Prompts de permission : mise en page par outil, libellés des options, commentaire via Tab, astuce auto mode, persistance des règles, dialogue /permissions

### Takeaway
En 2.1.282, un prompt de permission se compose d'un cadre titré par outil (« Bash command », « Edit file », « Create file », « Overwrite file », « Fetch », « Tool use », « Network request outside of sandbox »), d'une question (« Do you want to proceed? », « Do you want to make this edit to <fichier>? », « Do you want to allow Claude to fetch this content? ») et d'une liste d'options numérotées : `Yes`, une ligne « Yes, and don't ask again for … » calculée à partir de la règle réellement proposée, parfois « Yes, and switch to auto mode », puis `No`. Sur Yes ou No, `Tab` ouvre un champ de commentaire. Ses placeholders sont « and tell Claude what to do next » pour Yes et « and tell Claude what to do differently » pour No. Les règles « don't ask again » vont dans `.claude/settings.local.json`, à la racine du dépôt. **L'ancien libellé « Yes, allow all edits during this session (shift+tab) » n'existe plus dans le binaire.** La ligne de session d'un prompt de fichier s'écrit maintenant « Yes, and switch to **accept edits (…)** for this session (shift+tab) ».

### Cited Findings

**Titres et questions par outil (texte exact)**
- Bash : titres « Bash command », « Bash command (unsandboxed) » et « Bash command (runs on <machine> » ; PowerShell : « PowerShell command », « PowerShell command (unsandboxed) ». Question générique : « Do you want to proceed? ». Le composant de liste générique a `question="Do you want to proceed?"` par défaut. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Un Bash qui tourne hors sandbox est titré « Bash command (unsandboxed) » au lieu de « Bash command ». — [Docs Sandboxing](https://code.claude.com/docs/en/sandboxing)
- Fichiers : titres « Edit file », « Create file », « Overwrite file », « Write file », « Edit notebook ». La question se compose ainsi : `"Do you want to " + verbPhrase + " " + <fileName en gras> + "?"`, avec pour Edit `verbPhrase: "make this edit to"`. Le contenu est `kind: "file-edit-diff"`, ou `"no-changes"` quand l'édition ne change rien. Pour les notebooks, on trouve aussi « insert this cell into », « delete this cell from » et « the current cell contents cannot be shown in full ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- WebFetch : titre « Fetch », question « Do you want to allow Claude to fetch this content? ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Outils MCP et outils génériques : titre « Tool use », avec le suffixe ` (MCP)` sur le nom de l'outil. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Skill : « Use skill "<nom>" » ou « Use this skill? », suivi de « Claude may use instructions, code, or files from this Skill. » — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Le prompt Edit rend un diff. Les correctifs récents le concernent directement : diff coupé sans indication (2.1.259), largeur des emoji (2.1.257), aperçu montrant un autre emplacement dans un fichier multi-octets (2.1.274), césure des tabulations (2.1.238), rendu Unicode inhabituel (2.1.282), lecture en mode lecteur d'écran (2.1.283). — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- 2.1.257 : « Removed the Ctrl+E command explanation on Bash and PowerShell permission prompts ». La doc Security décrit toujours des « Natural language descriptions: Complex bash commands include explanations ». — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [Docs Security](https://code.claude.com/docs/en/security)

**Options, dans l'ordre de construction du code**
- Options d'un prompt Bash : 1) `Yes` ; 2) la ligne « don't ask again » (valeur `yes-apply-suggestions`) ; 3) quand auto mode est disponible, `U3n.workflow` = **« Yes, and switch to auto mode »** (valeur `yes-enable-auto-mode`, accompagnée d'une description) ; 4) `No`. Quand le commentaire est activé, `No` devient un champ `type:"input"` avec le placeholder « and tell Claude what to do differently ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Variantes exactes de la ligne « don't ask again », générées depuis la règle proposée :
  - « Yes, and don't ask again for **`<préfixe>:*`** commands in **`<dossier>`** » (règle de préfixe Bash)
  - « Yes, and don't ask again for `<tool>` commands in `<dossier>` » (repli tronqué selon la largeur disponible)
  - « Yes, and don't ask again for `<cmd1>` and `<cmd2>` … » (plusieurs sous-commandes)
  - « Yes, and don’t ask again for: `<règle>` » et « Yes, and don’t ask again for any `<tool>` command » (apostrophe typographique)
  - WebFetch : « Yes, and don't ask again for **`<domaine>`** » (règle `domain:<host>`)
  - Skill : « Yes, and don't ask again for **`<skill>`** in **`<dossier>`** »
  — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Le prompt de fichier (fonction `l5e`) : 1) « Yes » (champ `input` possible, placeholder « and tell Claude what to do next », option `accept-once`) ; 2) la ligne de session (`accept-session`), à laquelle s'ajoute ` (shift+tab)` en gras quand la valeur est `yes-session` et que l'opération n'est pas une lecture ; 3) « No » (champ `input` possible, placeholder « and tell Claude what to do differently », option `reject`). Le raccourci affiché vient du binding `confirm:cycleMode` (défaut `shift+tab`). — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Composition de la ligne de session d'un fichier : `ice("acceptEdits")`, qui donne « Yes, and switch to **accept edits (auto-approve file edits and common file commands)** for this session ». Elle se combine au besoin avec « Yes, and always allow access to **`<dossiers>`** for this session » (ajout de répertoires) et avec des règles. Les libellés de mode viennent de la table `mr` : `default (ask each time)`, `accept edits (auto-approve file edits and common file commands)`, `auto (no routine prompts; a reviewer model screens actions)`, `don't ask (auto-deny anything that would prompt)`, `plan mode (research and propose changes without making them)`, `BYPASS PERMISSIONS (no further prompts)`. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Écritures dans `.claude/` : « Yes, and allow Claude to edit files in this project's .claude folder for this session » et « Yes, and allow Claude to edit files in its ~/.claude folder for this session ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Lecture hors workspace : « Yes, allow reading from `<dossiers>` during this session », « Yes, and always allow access to `<dossiers>` from this project », « Yes, and don't ask again for `<cmd>` commands in|on `<…>` ». La question liée à `blockReadsOutsideWorkingDirectories` propose : « Yes, keep allowing reads outside the working directories » / « No, block reads outside the working directories from now on » / « No, ask again next time ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- WebFetch et réseau sandbox : `Yes`, « Yes, and don't ask again for <hôte> », puis **« No, and tell Claude what to do differently (esc) »**, où « (esc) » est en gras. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Les prompts de computer use et d'apps utilisent « Deny, and tell Claude what to do differently (esc) » et « Allow for this … ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- La doc fixe le principe : un prompt n'offre « don't ask again » ou « allow for the session » que quand il peut afficher tout ce que l'option autoriserait. Sinon, seule l'approbation ponctuelle est proposée. Ce comportement existe depuis 2.1.235 (« display text and "don't ask again" options now always match what a grant would cover »). — [Docs Permissions](https://code.claude.com/docs/en/permissions), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Un outil MCP marqué `_meta["anthropic/requiresUserInteraction"]: true` affiche son prompt à chaque appel, dans tous les modes, sans « don't ask again ». Ce comportement vaut à partir de v2.1.199 ; le correctif 2.1.246 a retiré l'option qu'il proposait encore par erreur. — [Docs MCP](https://code.claude.com/docs/en/mcp), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

**Tip auto mode et lignes d'explication**
- Tip affiché sur les prompts Bash (ajouté en 2.1.247), en gras : **« Tip: auto mode handles these prompts for you — choose "switch to auto mode" below »**. Une variante courte existe : « · auto mode handles these prompts for you ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282), [CHANGELOG 2.1.247](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- « Yes, and switch to auto mode » n'apparaît qu'en mode Manual ou acceptEdits, avec auto mode disponible. L'option est absente des prompts PowerShell et des prompts forcés par une règle `ask` ou par un hook. — [Docs Permission modes](https://code.claude.com/docs/en/permission-modes)
- Lignes qui expliquent pourquoi le prompt apparaît : « Auto mode classifier requires confirmation for this <tool> », « Classifier <…> requires confirmation for this <tool> », « Ask rule <règle> overrides auto mode for this <tool> » suivi de « /permissions to let auto mode decide », « Permission rule <règle> … » suivi de « /permissions to update rules », et « … to update hooks » pour un hook. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Autres tips du même registre : « Tip: auto mode could have handled up to ~N permission prompts across M of your recent sessions — press Shift+Tab until the mode indicator shows auto. » (/insights, 2.1.281) et « Tip: you already use auto mode — run /auto-mode-setup once to teach it your environment and improve its decisions. » — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282), [CHANGELOG 2.1.281](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

**Commentaire avec Tab**
- « move to **Yes** or **No** and press `Tab` to open a comment field ». `Enter` envoie. `Tab` referme le champ en gardant le texte. `Shift+Tab` sur un prompt de fichier referme aussi le champ (depuis 2.1.235). Un commentaire sur Yes est envoyé après le résultat ; un commentaire sur No sert de motif du refus et Claude continue. Un No sans commentaire dans la conversation principale arrête le tour. Les prompts WebFetch et navigateur n'ont pas ce champ, pas plus que les options de session ou de règle. — [Docs Permissions](https://code.claude.com/docs/en/permissions)
- Le pied du prompt affiche le raccourci `chord:"tab", action:"amend"` quand le curseur est sur Yes ou No et que le champ est fermé. Autre indice : `Esc` déclenche `tengu_permission_request_escape`. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

**Persistance et syntaxe des règles**
- Le tableau « "Yes, and don't ask again" behavior » donne : Bash « Permanently per repository and command », fichiers « Until session end », WebFetch « Permanently per repository and domain », WebSearch « Permanently per repository ». La règle est écrite dans `.claude/settings.local.json` à la racine git, résolue vers le checkout principal pour les worktrees depuis v2.1.211. — [Docs Permissions](https://code.claude.com/docs/en/permissions)
- Dans le code, la règle Bash est `{toolName, ruleContent: "<préfixe>:*"}` et elle est écrite avec `destination: "localSettings"`. Les grants de session utilisent `destination: "session"`. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Syntaxe `Tool` / `Tool(specifier)` ; évaluation dans l'ordre deny → ask → allow ; un deny sur un nom d'outil nu retire l'outil du contexte. — [Docs Permissions](https://code.claude.com/docs/en/permissions)

**Dialogue /permissions**
- Onglets, dans l'ordre du code : **« Recently denied »** (id `recent`), **« Allow »**, **« Ask »**, **« Deny »**, **« Workspace »**, auxquels s'ajoute l'onglet **Auto mode** quand auto mode est disponible. Listes vides : « No allow rules », « No ask rules », « No deny rules », « No additional working directories ». Première entrée d'une liste de règles : « Add a new rule… ». Texte de l'onglet Workspace : « Claude Code can read files in the workspace, and make edits when auto-accept edits is on. », avec « Add directory » et « (Original working directory) ». Ajout d'une règle : titre « Add <allow|ask|deny> permission rule(s) », question « Where should this rule be saved? » ou « Where should these rules be saved? ». Onglet Auto mode : « Extra rules for the auto mode classifier. Rules are plain sentences; new rules are saved to your user settings. », avec les sections « Soft deny » et « Hard deny ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Le dialogue peut s'ouvrir pendant que Claude travaille, et les changements s'appliquent dès l'appel d'outil suivant (2.1.234). L'onglet Auto mode date de 2.1.246. En 2.1.280, le focus revient à la liste, les confirmations de suppression sont réglées sur No par défaut, et ←/→/Tab changent d'onglet depuis la liste. En 2.1.281, ↑/↓ passent de la rangée d'onglets au contenu, et un `1` sur un pointeur placé sur No ne valide plus. — [Docs Permissions](https://code.claude.com/docs/en/permissions), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Notification quand auto mode refuse une action (clé `auto-mode-denied`, type warning, priorité immediate) : **« `<outil en minuscules>` denied by auto mode · `<raison tronquée à 80 caractères>` · /permissions »**, le premier segment en rouge et les autres en dim. L'action refusée est ensuite listée dans l'onglet Recently denied, où `r` la relance avec approbation manuelle. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282), [Docs Permission modes](https://code.claude.com/docs/en/permission-modes)

### Inferences
- Le libellé historique « Yes, allow all edits during this session (shift+tab) » a disparu du binaire 2.1.282. La ligne de session des fichiers se construit désormais avec `ice("acceptEdits")`. Le libellé probable est donc « Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab) », à confirmer par une capture réelle.
- Les « don't ask again » sont des rendus d'une « suggestion de règle ». Un clone doit calculer la règle d'abord, puis le libellé, et masquer la ligne si le libellé déborde de la largeur disponible (`maxLabelWidth`, minimum 24).
- Le pied du prompt affiche probablement « Esc to cancel · Tab to amend ». Le format exact des raccourcis n'a pas été capturé.

### Gaps
- Pas de capture d'écran 2.1.28x d'un prompt Bash complet (bordure, couleurs, position du tip) : la mise en page vient seulement du code.
- La description (texte secondaire) de l'option « Yes, and switch to auto mode » n'a pas été extraite.

---

## Q2. Modes de permission : affichage, cycle Shift+Tab, plan mode (dialogue d'approbation, ultraplan), auto mode et ses refus

### Takeaway
La table interne des modes (`Ws`) donne pour chacun un titre, un indicateur, un symbole et une couleur : Manual (`⏸ manual mode`, inactive), Plan (`⏸ plan mode`, planMode), Accept edits (`⏵⏵ accept edits`, autoAccept), Auto (`⏵⏵ auto mode`, warning), Bypass Permissions et Don't Ask (`⏵⏵`, error). Le pied de page affiche « <symbole> <indicateur> on ». Le plan mode présente un dialogue « Ready to code? » avec « Here is Claude's plan: », puis les options Yes (qui changent de mode) et « No, keep planning » (champ de saisie). L'option « No, refine with Ultraplan in a cloud session » existe encore dans le code, mais le changelog annonce « Removed ultraplan feature » en 2.1.222.

### Cited Findings
- Table des modes : `default` : title « Manual », indicator « manual mode », symbol `⏸` (U+23F8), color `inactive` ; `plan` : « Plan », « plan mode », `⏸`, `planMode` ; `acceptEdits` : « Accept edits » (court « Accept »), « accept edits », `⏵⏵` (U+23F5 ×2), `autoAccept` ; `bypassPermissions` : « Bypass Permissions », « bypass permissions », `⏵⏵`, `error` ; `dontAsk` : « Don't Ask », « don't ask », `⏵⏵`, `error` ; `auto` : « Auto », « auto mode », `⏵⏵`, `warning`. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- La doc confirme l'affichage : « a gray `⏸ manual mode on` for `default`, or as `⏵⏵ accept edits on`, `⏸ plan mode on`, `⏵⏵ auto mode on`, `⏵⏵ don't ask on`, or `⏵⏵ bypass permissions on` ». Cycle : depuis `auto`, la première pression passe à `default`, puis `default → acceptEdits → plan → default`. Les modes optionnels s'insèrent après `plan`, `bypassPermissions` en premier et `auto` en dernier. `dontAsk` n'entre jamais dans le cycle. — [Docs Permission modes](https://code.claude.com/docs/en/permission-modes)
- Tip de rotation : « Hit shift+tab to cycle between manual mode, auto-accept edit mode, and plan mode ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Mode de départ : en 2.1.283, une session interactive sur un fournisseur tiers ou avec la télémétrie désactivée démarre en auto mode quand aucun mode n'est configuré. Sur Pro, Max et Team, le mode intégré de départ est déjà auto. — [CHANGELOG 2.1.283](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [Docs Permission modes](https://code.claude.com/docs/en/permission-modes)
- **Dialogue d'approbation du plan (texte exact)** : cadre de couleur `planMode` titré **« Ready to code? »**, ligne « Here is Claude's plan: », plan rendu en markdown, puis, en dim, « Claude has written up a plan and is ready to execute. Would you like to proceed? ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Options du plan, dans l'ordre du code (fonction `HYe`) :
  1. Si `showClearContextOnPlanAccept` est actif : « Yes, clear context (N% used) and bypass permissions », « Yes, clear context (N% used) and use auto mode » ou « Yes, clear context (N% used) and auto-accept edits », selon les modes disponibles.
  2. « Yes, and switch to BYPASS PERMISSIONS (no further prompts) for this session » quand bypass est disponible, sinon **« Yes, and use auto mode »** (`U3n["exit-plan-resume"]`), sinon « Yes, auto-accept edits ».
  3. « Yes, manually approve edits ».
  4. Quand `showUltraplan` est vrai : « No, refine with Ultraplan in a cloud session ».
  5. **« No, keep planning »** : un champ de saisie avec le placeholder « Tell Claude what to change » et la description « shift+tab to approve with this feedback ».
  — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- La doc confirme les trois options principales, l'ouverture du plan dans l'éditeur avec `Ctrl+G`, et le titre de session généré à l'acceptation. `/plan [open|<description>]` est décrit comme « Enable plan mode or view the current session plan ». — [Docs Permission modes](https://code.claude.com/docs/en/permission-modes), [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Ultraplan : « 2.1.222 — Removed ultraplan feature ». Avant cela, « Refine with Ultraplan » était une option du plan mode (2.1.101, 2.1.113). **Conflit** : le binaire 2.1.282 garde l'option derrière un drapeau, mais la doc actuelle du plan ne la mentionne pas. Elle doit être considérée comme non affichée. — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Auto mode : quand le classifieur bloque une action, Claude reçoit la raison (souvent la règle correspondante, par exemple `[Data Exfiltration]`). Après 3 blocages consécutifs ou 20 au total, auto mode se met en pause et revient aux prompts. `/auto-mode-setup` a pour description « Teach auto mode about your environment, plus optional rule tweaks ». — [Docs Permission modes](https://code.claude.com/docs/en/permission-modes), [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- 2.1.281 : le prompt `rm` dangereux, en bypass et en auto, attend 2 minutes puis refuse avec un conseil de réécriture. Depuis 2.1.277, ce prompt nomme la commande `rm` signalée et suggère une garde `${VAR:?}`. — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

### Inferences
- Le pied de page combine sans doute symbole, indicateur et « on », suivis de « (shift+tab to cycle) », sur le modèle des notes précédentes. La couleur est `inactive` (gris) pour Manual.
- « No, keep planning » est un champ dans la liste. Shift+Tab y approuve en transmettant le texte comme retour. Fuller doit reproduire ce comportement, sans ajouter d'option ultraplan.

### Gaps
- Aucune capture 2.1.28x du dialogue « Ready to code? » : la bordure (haut seulement ? le code montre `borderRight:!1,borderBottom:!1`) et l'espacement ne sont pas vérifiés visuellement.

---

## Q3. Sandbox : /sandbox, sandbox Bash, prompts d'autorisation réseau

### Takeaway
`/sandbox` ouvre un panneau à onglets : Mode, Overrides, Config, plus Dependencies sous Linux quand seccomp manque. Le mode propose « Sandbox BashTool, with auto-allow », « Sandbox BashTool, with regular permissions » ou « No Sandbox ». Un accès réseau non autorisé déclenche un prompt titré « Network request outside of sandbox » : « Do you want to allow this connection? », avec Yes (pour la session), « Yes, and don't ask again for <hôte> » (règle `WebFetch(domain:…)` dans les settings locaux) et « No, and tell Claude what to do differently (esc) ».

### Cited Findings
- Onglets : « **Mode** », « **Overrides** » (`allowUnsandboxedCommands`, affiché comme **Strict sandbox mode**), « **Config** » (réglages résolus), et « **Dependencies** » sous Linux quand seccomp manque. Si seul Dependencies s'affiche, un paquet requis manque. Choisir un mode l'écrit dans `.claude/settings.local.json`. — [Docs Sandboxing](https://code.claude.com/docs/en/sandboxing)
- Libellés du mode : « Sandbox BashTool, with auto-allow », « Sandbox BashTool, with regular permissions », « Sandbox BashTool », « No Sandbox ». L'onglet « Overrides » affiche aussi, pour les sessions cloud : « Commands Claude runs on this computer use this sandbox; the cloud session's own sandbox, in its conta[iner]… ». Diagnostics présents : « TLS inspection CA: », « not trusted », « run /sandbox install ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Prompt réseau : titre « Network request outside of sandbox », question « Do you want to allow this connection? » dans une marge haute, options `yes`, `yes-dont-ask-again-domain` et « No, and tell Claude what to do differently (esc) ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Sémantique : Yes autorise l'hôte pour le reste de la session ; « Yes, and don't ask again » enregistre une règle `WebFetch(domain:...)` dans les settings locaux. Avec `strictAllowlist` ou `allowManagedDomainsOnly`, les hôtes hors liste sont refusés sans prompt. En auto mode, Claude déclare les hôtes nécessaires directement sur la commande (liste par commande, 2.1.271) au lieu de déclencher un prompt réseau. — [Docs Sandboxing](https://code.claude.com/docs/en/sandboxing)
- Relance hors sandbox : Claude peut relancer avec `dangerouslyDisableSandbox`, ce qui déclenche le prompt normal titré « Bash command (unsandboxed) ». Les violations sont reportées dans le résultat de la commande, avec le chemin ou l'hôte refusé. Si le sandbox ne peut pas démarrer, Claude Code affiche un avertissement et exécute sans sandbox, sauf si `sandbox.failIfUnavailable` est actif. — [Docs Sandboxing](https://code.claude.com/docs/en/sandboxing)
- 2.1.281 : ←/→ et Tab changent d'onglet depuis la liste dans `/sandbox`. En 2.1.246, le hook `Notification` se déclenche de nouveau pendant le prompt « Network request outside of sandbox ». — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

### Inferences
- La commande `/sandbox` n'apparaît pas comme `name:"sandbox"` dans l'extraction de commandes. Elle est sans doute déclarée autrement, par exemple chargée seulement si la plateforme la supporte.

### Gaps
- Libellés exacts des options de l'onglet Overrides (hormis « Strict sandbox mode ») et contenu de l'onglet Config : non extraits.

---

## Q4. Dialogue de confiance du dossier et onboarding au premier lancement

### Takeaway
Le trust dialog s'intitule « Accessing workspace: », suivi du chemin (depuis 2.1.218, la racine du dépôt couverte), puis de « Quick safety check: … ». Il liste ce que le dossier pré-approuve (règles allow, répertoires, headersHelper), affiche un lien « Security guide » et propose « Yes, I trust this folder » / « No, exit », avec le focus initial sur le refus. L'onboarding enchaîne : vérification réseau, thème (« Let's get started. » / « Choose the text style that looks best with your terminal »), connexion ou clé API, « Security notes: », puis « Use Claude Code's terminal setup? ».

### Cited Findings
- Texte du trust dialog : « Accessing workspace: » puis « Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what's in this folder first. » puis un fragment « …ll be able to read, edit, and execute files here. ». Ajouts conditionnels : « This folder pre-approves N tool permission(s) … » (ou « (rule names contain unprintable characters) »), « This folder adds N directory/directories to the workspace in <sources>: », en avertissement « This folder runs commands to mint HTTP headers (headersHelper), declared in … », et en dim « These will apply without asking. Only proceed if you trust this configuration. ». Lien : « Security guide » vers `https://code.claude.com/docs/en/security`. Boutons : `confirmLabel: "Yes, I trust this folder"`, `cancelLabel: "No, continue without these permissions"` dans une variante, `"No, exit"` sinon. `cancelFirst:!0, focus:"cancel"`, sans numéros d'index. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Télémétrie `tengu_trust_dialog_shown` avec les champs `isHomeDir`, `hasMcpServers`, `hasBashExecution`, `hasProjectAllowRules`, `hasProjectAddDirs`, `hasApiKeyHelper`, `hasAwsCommands`, `hasGcpCommands`, etc., qui indiquent ce que le dialogue peut signaler. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Règles de confiance : la confiance est attachée à la racine git, ou au dossier de lancement hors dépôt. Dans le home, elle ne vaut que pour la session et le dialogue revient à chaque lancement. Aucun dialogue en `-p` ni dans le SDK. Les règles `permissions.allow`, `additionalDirectories` et `headersHelper` du projet attendent la confiance, et le dialogue réapparaît pour les lister. — [Docs Permissions](https://code.claude.com/docs/en/permissions), [Docs Security](https://code.claude.com/docs/en/security)
- 2.1.218 : « Improved trust dialogs to name the repository root the grant covers ». 2.1.238 : `headersHelper` et les serveurs MCP inline des agents projet exigent la confiance, y compris en `-p`. 2.1.248 : `claude agents` affiche de nouveau le prompt de confiance quand `CI` est défini. — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Étapes d'onboarding, dans l'ordre du tableau `C` : `preflight` (connectivité), `theme`, `api-key`/`oauth`, `security`, puis `terminal-setup` si le terminal le justifie. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Thème : « Let's get started. » et, en gras, « Choose the text style that looks best with your terminal ». Aperçu par un diff `demo.js` (`function greet() {` / `-  console.log("Hello, World!");` / `+  console.log("Hello, Claude!");`), lignes « Syntax highlighting enabled|disabled (…) », « Syntax theme: », puis « To change this later, run /theme ». `Ctrl+T` bascule la coloration syntaxique dans le picker. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282), [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Security notes, en liste numérotée : titre en gras « Security notes: » ; 1. « Claude can make mistakes. », avec en dim « You're responsible for Claude's actions and should always / review them, especially when running code. » ; 2. « Due to prompt injection risks, only use it with code you trust » et un lien vers la doc Security. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Terminal setup : en gras « Use Claude Code's terminal setup? », puis « For the optimal coding experience, enable the recommended settings / for your terminal: » avec, selon le terminal, « Option+Enter for newlines », « Option+Enter for newlines and no audible bell » ou « Shift+Enter for newlines ». Options : « Yes, use recommended settings » / « No, maybe later with /terminal-setup ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

### Inferences
- Le focus initial sur « No » (cancelFirst) est un choix de sécurité à reproduire. Le dialogue n'a pas d'index numérotés.

### Gaps
- Le début exact de la phrase « …ll be able to read, edit, and execute files here. » (probablement « Claude Code'll be able to… ») n'a pas été extrait en entier.
- Le texte de l'écran de connexion (choix du compte ou de la clé API) n'a pas été extrait.

---

## Q5. Hooks : ce que l'utilisateur voit quand un hook s'exécute ou bloque, dialogue /hooks, affichage de la sortie

### Takeaway
`/hooks` est un navigateur en lecture seule : les événements avec leur nombre de hooks, puis les matchers, puis le détail. Chaque hook porte un préfixe `[type]` et une source (User Settings, Project Settings, Local Settings, Plugin Hooks, Session Hooks). Dans le transcript, un blocage s'affiche en rouge « <hook> hook returned blocking error », suivi de la raison ; une erreur non bloquante s'affiche « <hook> hook error », suivi de « Failed with non-blocking status code: <stderr> ». Pendant l'exécution, le spinner dit « Running SessionStart hooks… » (ou l'équivalent pour d'autres événements), avec le temps écoulé depuis 2.1.271.

### Cited Findings
- `/hooks` : « View hook configurations for tool events ». Menu « read-only browser », « shows every hook event with a count of configured hooks, lets you drill into matchers, and shows the full details of each hook handler ». Cinq types (`command`, `prompt`, `agent`, `http`, `mcp_tool`), chacun préfixé `[type]` ; sources `User Settings`, `Project Settings`, `Local Settings`, `Plugin Hooks`, `Session Hooks`. Le détail montre l'événement, le matcher, le type, le fichier source et la commande, le prompt ou l'URL. — [Docs Hooks](https://code.claude.com/docs/en/hooks)
- 2.1.281 : l'écran de détail d'un hook dit quel type de hook c'est et où le modifier, au lieu de toujours renvoyer à settings.json. Les avis « hooks-disabled », « safe mode » et « managed-hooks-only » tiennent chacun en une phrase. 2.1.283 : touches de page, molette et clics dans la liste. — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Messages du transcript : `${hookName} hook returned blocking error` (ton rouge, sous-lignes = raison), `${hookName} hook error`, « … hook warning », « … hook stopped continuation: », « timed out », « Failed with non-blocking status code: <stderr ou "No stderr output"> », « Hook failed to run ( », « Operation stopped by hook », « UserPromptSubmit hook error: », « Stop hook error: », « compaction blocked by PreCompact hook; continuing uncompacted », « … blocked by UserPromptExpansion hook ». Pour un hook de plugin : « If this is a plugin hook, check the plugin install (run /plugin). » — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Spinner : « Running SessionStart hooks… », « Running PreCompact hooks… », « Running PostCompact hooks… », « Running PreModelSwitch hooks… » (annulable). 2.1.271 : « while a SessionStart, UserPromptSubmit, PreToolUse or SessionEnd hook runs, the spinner says so with elapsed time, and Esc cancels a prompt waiting on a SessionStart hook ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Règles d'affichage : le stdout d'un hook en exit 0 va dans le log de debug, sauf pour `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart` et `PostModelSwitch`, où il devient du contexte. Un JSON invalide ou un texte brut en code ≠ 0 et ≠ 2 affiche « `<hook name> hook error` » et la première ligne de stderr préfixée « Failed with non-blocking status code: ». Le code 2 bloque avec stderr ou la raison JSON. `systemMessage` est affiché à l'utilisateur. `terminalSequence` permet d'émettre des notifications OSC 0/1/2/9/99/777 et BEL. — [Docs Hooks](https://code.claude.com/docs/en/hooks)
- Un hook `PermissionRequest` ou `PreToolUse` qui renvoie une réponse invalide est nommé, avec l'erreur de schéma, sur la ligne de la session dans `claude agents` (2.1.248). — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

### Inferences
- Pour Fuller : il faut une ligne rouge par blocage (nom du hook, puis raison en sous-lignes indentées) et une ligne d'erreur non bloquante distincte. `/hooks` peut rester en lecture seule, et la création de hooks passe par l'édition du JSON ou par Claude.

### Gaps
- Mise en page exacte de `/hooks` (glyphes, colonnes, compteur) : non capturée.

---

## Q6. MCP : dialogue /mcp, approbation des serveurs du projet, ressources dans les @-mentions, prompts MCP en slash commands, élicitation

### Takeaway
`/mcp` (« Manage MCP servers », arguments `[reconnect <server>|enable|disable [<server>|all]]`) regroupe les serveurs par portée : Local, Project, User, Enterprise, Managed, Active agent et Built-in MCPs. Chaque serveur affiche un statut (connected, connecting, reconnecting, failed, needs authentication, disabled, not configured, cached) et le nombre d'outils. Son menu propose View tools, Authenticate, Re-authenticate, Clear authentication, Reconnect et Enable/Disable. Un serveur `.mcp.json` nouveau déclenche « New MCP server found in this project: <nom> », avec trois choix.

### Cited Findings
- Sections de `/mcp` : « Local MCPs », « Project MCPs », « User MCPs », « Enterprise MCPs », « Managed MCPs » (« provided by your organization »), « Active agent MCPs » (frontmatter), « Built-in MCPs » (« always available »). Statuts et fragments : « connected », « connecting », « reconnecting ( », « not configured », « needs authentication », « may need authentication », « not connected (agent-only) », « connected · session token rejected », « tools fetch failed », « no tools », « config issue ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Menu d'un serveur : « Enable » (si désactivé), « View tools », « Authenticate », « Re-authenticate », « Clear authentication », « Reconnect ». Lignes du détail : « Issue: », « Protocol: », « Managed: … by your organization », « Config location: », « Tools: ». Écran de connexion : « Connecting to **<nom>**… », un spinner avec « Establishing connection to MCP server », puis en dim « This may take a few moments. ». Authentification : « If your browser doesn't open automatically, copy this URL manually », « Return here after authenticating in your browser. Press <touche> when done. ». Succès : « Authentication successful for … », « Successfully reconnected to … ». Pour claude.ai : « claude.ai rejected the session token. Run /login, then reconnect. ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Statut `cached` : « cached 2h ago · connects on first use · 5 tools » (v2.1.221+). « No URL configured for this server » s'affiche pour une URL vide. Avertissements dans `/mcp` : espaces cachés (« Leading or trailing whitespace in: headers.Authorization »), même nom dans plusieurs portées, noms réservés, variables d'environnement manquantes. Chaque serveur connecté affiche son nombre d'outils. Un interrupteur désactive un serveur (listes `disabledMcpServers`/`enabledMcpServers` dans `~/.claude.json`). — [Docs MCP](https://code.claude.com/docs/en/mcp)
- 2.1.283 : la liste d'outils de `/mcp` montre plus d'outils à la fois, défile, et marque d'une icône d'avertissement les outils bloqués par l'organisation. Authenticate n'est plus proposé pour un serveur sans URL valide. — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Statuts dans le CLI (`claude mcp list`) : « ✔ Connected », « ! Needs authentication », « ✘ Failed to connect », « ⏸ Pending approval (run `claude` to approve) », « ✘ Rejected (see disabledMcpjsonServers in settings) », « ⊘ Disabled for this project (re-enable via /mcp) ». — [Docs MCP](https://code.claude.com/docs/en/mcp)
- **Approbation des serveurs `.mcp.json`** : pour un seul serveur, « New MCP server found in this project: <nom> » avec « Use this MCP server » / « Use this and all future MCP servers in this project » (valeur `yes_all`) / « Continue without using this MCP server ». Pour plusieurs, « N new MCP servers found in this project », « Select any you wish to enable. », « Enable selected » / « reject all ». Note en bas : « MCP servers may execute code or access system resources. All tool calls require approval. Learn more in the MCP documentation. ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Un dépôt cloné ne peut pas approuver ses propres serveurs : `enableAllProjectMcpServers` est ignoré dans un dossier non approuvé (v2.1.196+). — [Docs MCP](https://code.claude.com/docs/en/mcp)
- Ressources : taper `@` affiche les ressources de tous les serveurs mêlées aux fichiers, avec la syntaxe `@server:protocol://resource/path` et une recherche floue. Le transcript affiche « Read MCP resource … ». — [Docs MCP](https://code.claude.com/docs/en/mcp), [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Prompts : « Claude Code lists each MCP prompt as `/servername:promptname (MCP)`. Typing `/mcp__servername__promptname` also runs it. » Les arguments sont séparés par des espaces. — [Docs MCP](https://code.claude.com/docs/en/mcp)
- Élicitation : en mode formulaire, un dialogue affiche les champs définis par le serveur ; en mode URL, le navigateur s'ouvre et on confirme ensuite dans le CLI. Une URL trop longue ne peut être que refusée. Un hook `Elicitation` peut répondre automatiquement. Depuis 2.1.281, l'élicitation en mode URL fonctionne aussi sur les connexions au protocole 2026-07-28. — [Docs MCP](https://code.claude.com/docs/en/mcp), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

### Inferences
- Le groupement par portée avec en-têtes, le compteur d'outils et le menu d'actions par serveur forment la structure minimale à reproduire. L'approbation `.mcp.json` intervient après le trust dialog.

### Gaps
- Glyphes exacts des statuts dans `/mcp` (✔/✘/△ ?) : seuls ceux du CLI sont documentés.
- Mise en page du dialogue d'élicitation (champs, boutons Accept/Decline) : non extraite.

---

## Q7. Subagents et agent teams : /agents, affichage des subagents en cours, agents de fond, agent view (←), teammates

### Takeaway
**Le wizard `/agents` a été supprimé en v2.1.198.** Taper `/agents` affiche seulement un rappel : demander à Claude, ou éditer `.claude/agents/`. L'entrée « (removed) » a disparu du menu en 2.1.281. Les subagents de fond apparaissent dans un panneau sous le prompt : ↑/↓, Enter pour ouvrir le transcript, x pour arrêter. Leurs demandes de permission remontent dans la session principale, avec le nom du subagent. L'agent view (`claude agents`, ou ← deux fois) regroupe les sessions de fond par état.

### Cited Findings
- « Removed the `/agents` wizard; ask Claude to create or manage subagents, or edit `.claude/agents/` directly » (2.1.198). « Removed the leftover "(removed)" `/agents` entry from the command menu and `/help`; typing `/agents` still explains where the wizard went » (2.1.281). Avant la suppression, `/agents` avait des onglets Running et Library et affichait « ● N running ». — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [Docs Commands](https://code.claude.com/docs/en/commands)
- Subagents de fond : une demande de permission atteint la session principale « and names the subagent that is asking » ; `Esc` refuse cet appel seul sans arrêter le subagent. Un subagent terminé retire sa ligne du panneau et affiche « `/tasks to see subagents` » pendant 30 s ; un subagent en échec ou arrêté garde sa ligne 30 s (`x` pour la retirer). `Ctrl+B` met une tâche en cours en arrière-plan. Le fork mode est actif par défaut en interactif (v2.1.232+). — [Docs Sub-agents](https://code.claude.com/docs/en/sub-agents)
- Panneau des forks : « one row for the main session and one for each fork ». Touches : ↑/↓, Enter (ouvre le transcript et permet d'y écrire), x (arrête ou retire la ligne), Esc (retour au prompt). Pendant qu'un transcript d'agent est ouvert, `/model` et `/fast` affichent un avis indiquant qu'ils portent sur la conversation principale. — [Docs Sub-agents](https://code.claude.com/docs/en/sub-agents)
- Placeholder « Message @name… » quand on regarde le transcript d'un subagent ou d'un fork (2.1.251). `/tasks` et les dialogues de détail affichent le modèle et l'effort de chaque subagent (2.1.243). — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Commandes associées : `/subtask <task>` (« Send a subagent off with your full context; its result comes back here »), `/fork [prompt]` (« Copy this conversation into a new background session and keep working here »), `/background` (alias `/bg`), `/stop` (« Stop this background session; transcript and worktree are kept »). — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282), [Docs Agent view](https://code.claude.com/docs/en/agent-view)
- Agent view (research preview) : groupes Pinned, Ready for review, Needs input, Working, Completed. Icônes : `✻`/`✽` animé (processus vivant), `∙` (processus terminé), `✢` (`/loop` en attente). Couleurs par état : Working animé, Needs input jaune, Idle dim, Completed vert, Failed rouge, Stopped gris. Titre d'onglet : « 2 awaiting input · claude agents ». Touches : ↑/↓, Enter, Space (aperçu), →, Alt+1..9, Tab, Ctrl+S (regroupement), Ctrl+T (épingler), Ctrl+R (renommer), Ctrl+G, Ctrl+X (arrêter, deux fois pour supprimer), Shift+↑/↓, Esc, `?`. Depuis la session, `←` affiche « Press ← again to open agents » ou « Press ← again to go back to agents ». En quittant avec du travail de fond, un dialogue « Background work is running » propose « Move to background and exit ». — [Docs Agent view](https://code.claude.com/docs/en/agent-view)
- Agent teams : deux modes d'affichage, « In-process » (↑/↓ dans le panneau d'agents, Enter pour voir un teammate et lui écrire, `x` pour l'arrêter, Ctrl+T pour la liste de tâches) et « Split panes » (tmux ou iTerm2 via `it2`). Réglage `teammateMode` (`in-process` par défaut, `auto`, `tmux`, `iterm2`). Les plans d'un teammate sont approuvés automatiquement par le lead. — [Docs Agent teams](https://code.claude.com/docs/en/agent-teams)

### Inferences
- Pour Fuller : ne pas recréer un wizard `/agents`. `/agents` doit afficher un message de redirection. La vraie surface est le panneau d'agents sous le prompt, avec son indice `/tasks to see subagents` en pied de page.

### Gaps
- Libellé exact du badge qui identifie le subagent sur un prompt de permission (composant `WorkerBadge`) : non extrait.

---

## Q8. Skills et slash commands personnalisées : menu /, /skills, argument-hint, frontmatter

### Takeaway
Les commandes personnalisées sont fusionnées dans les skills (`.claude/commands/x.md` et `.claude/skills/x/SKILL.md` créent tous deux `/x`). Le menu `/` affiche nom, description et `argument-hint`. `/skills` (« List available skills ») affiche une ligne par skill, le nom d'abord, avec ✔ ou ◯. `Space` y fait tourner l'état on, name-only, user-only et off, et `Esc` enregistre le choix dans `settings.local.json`.

### Cited Findings
- Frontmatter qui agit sur l'interface : `name` (nom affiché), `description` et `when_to_use` (tronqués ensemble à 1 536 caractères), `argument-hint` (« Hint shown during autocomplete », par exemple `[issue-number]`), `user-invocable: false` (masqué du menu `/`), `disable-model-invocation`, `allowed-tools` (pré-approbation pour le tour en cours), `model`, `effort`, `context: fork`, `agent`, `paths`, `hooks`. — [Docs Skills](https://code.claude.com/docs/en/skills)
- `/skills` : « highlight a skill and press `Space` to cycle states, then `Esc` to save to `.claude/settings.local.json` ». États : `on`, `name-only`, `user-invocable-only` (affiché `user-only`), `off`. Les skills de plugin se gèrent via `/plugin`. — [Docs Skills](https://code.claude.com/docs/en/skills)
- 2.1.281 : « `/skills`: each row now leads with the skill's name, with ✔ or ◯ alone showing on or off, and stays on one line in narrow terminals ». Le menu `/`, `/skills`, `/context` et `/plugin` montrent les skills synchronisées sous leur nom court. 2.1.282 et 2.1.283 : corrections de focus entre la zone de recherche et la liste. — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Espaces de noms dans le menu : les skills de plugin s'appellent `/plugin-name:skill-name`, les prompts MCP `/server:prompt (MCP)`. `/reload-skills` : « Pick up skills added or changed on disk during this session ». `/skill-doctor` : « Show which loaded skills are unused and costing context », dont le rapport s'ouvre dans l'onglet **Stats** de `/plugin`. — [Docs Skills](https://code.claude.com/docs/en/skills), [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Prompt de permission d'une skill : « Use this skill? » avec « Claude may use instructions, code, or files from this Skill. », règle `Skill(<nom>)`. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282), [Docs Permissions](https://code.claude.com/docs/en/permissions)

### Inferences
- Le menu `/` doit afficher les commandes intégrées, les skills (personnelles, projet, plugin avec préfixe) et les prompts MCP suffixés `(MCP)`, tous avec leur `argument-hint`.

### Gaps
- Mise en colonnes exacte du menu `/` (largeur du nom, séparateur de description) : couverte par un autre chercheur (saisie et navigation).

---

## Q9. Plugins et marketplaces : interface /plugin

### Takeaway
`/plugin` (alias `/plugins` et `/marketplace`, « Manage Claude Code plugins ») est un dialogue à onglets : Discover, Installed, Marketplaces, Errors et Stats. L'installation passe par un volet de détails (Will install, Last updated, Context cost), puis par un choix parmi trois portées.

### Cited Findings
- Onglets : **Discover** (plugins de toutes les marketplaces, saisie pour rechercher, Enter pour les détails), **Installed**, **Marketplaces**, **Errors** (2.1.281) et **Stats** (`/skill-doctor`). — [Docs Plugins install](https://code.claude.com/docs/en/plugins/install), [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), [Docs Skills](https://code.claude.com/docs/en/skills)
- Volet de détails : « **Will install** » (commandes, agents, skills, hooks, serveurs MCP et LSP), « **Last updated** », « **Context cost** » (**Every turn** / **When invoked**), ou « Components will be discovered at installation ». Portées : « **Install for you (user scope)** », « **Install for all collaborators on this repository (project scope)** », « **Install for you, in this repo only (local scope)** ». Fin du résumé d'installation : « Plugin is now active. ». — [Docs Plugins install](https://code.claude.com/docs/en/plugins/install)
- Onglet Installed : saisie pour filtrer, **Space** pour activer ou désactiver, **f** pour mettre en favori, Enter pour ouvrir un menu (« Disable plugin »/« Enable plugin », « Update now », « Uninstall », « Configure options »). Les plugins désactivés sont regroupés sous un en-tête replié ; les plugins « Managed » ne se modifient pas. À la fermeture, `/reload-plugins` s'exécute, ou un avertissement apparaît si le cache de prompt serait invalidé. Pour les plugins synchronisés : « Plugins changed. Run /reload-plugins to activate. ». Désinstaller un plugin activé par le projet propose « Disable for me » (**y**) ou « Uninstall for everyone » (**u**). — [Docs Plugins install](https://code.claude.com/docs/en/plugins/install)
- Onglet Marketplaces : chaque entrée permet de parcourir, mettre à jour, activer ou désactiver l'auto-update, supprimer. Avant de confirmer une suppression, l'onglet nomme les plugins qui seront désinstallés. Prompts « Add marketplace? » et « Run this command? » dans le cadre standard (2.1.281). — [Docs Plugins install](https://code.claude.com/docs/en/plugins/install), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

### Inferences
- Pour un clone sans marketplace réelle, Discover et Marketplaces peuvent rester vides. Installed et le volet de détails sont le minimum.

### Gaps
- Ordre exact des onglets à l'écran : Discover est le premier (le panneau s'ouvre dessus) ; l'ordre des autres n'est pas vérifié.

---

## Q10. Mémoire : hiérarchie CLAUDE.md, dialogue /memory, auto memory, raccourci #

### Takeaway
`/memory` (« Edit CLAUDE.md files and memory settings ») liste les fichiers CLAUDE.md et CLAUDE.local.md des portées utilisateur et projet, y compris ceux qui n'existent pas encore (ils sont créés à la sélection). Il contient deux interrupteurs, « Auto-memory: » et « Auto-dream: », et les entrées « Open auto-memory folder » et « Open team memory folder ». **Le raccourci `#` a été supprimé en 2.0.70.**

### Cited Findings
- `/memory` : « lists your CLAUDE.md, CLAUDE.local.md, and other memory file locations across user and project scopes, including user and project CLAUDE.md entries for files that don't exist yet. It also lets you toggle auto memory on or off and provides an option to open the auto memory folder. » L'éditeur GUI s'ouvre sans bloquer la session (depuis 2.1.216). — [Docs Memory](https://code.claude.com/docs/en/memory)
- Lignes du dialogue : « Auto-memory: » et « Auto-dream: » (interrupteurs avec texte d'état : « off while auto-memory is off », « last ran … », « unavailable for current model », « off in safe mode », « (value set by your organization) »), « Open auto-memory folder », « Open team memory folder », « CLAUDE.local.md », « agent memory ». Mémoire de projet synchronisée : « Synced project memory: », « Sync memories from: », « Write to synced project memory: ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Messages de l'auto memory : « When you see messages like "Saved 2 memories" or "Recalled 2 memories" in the Claude Code interface… ». `MEMORY.md` n'est chargé que sur ses 200 premières lignes ou 25 Ko. Emplacement : `~/.claude/projects/<project>/memory/`. Types de mémoire : `user`, `feedback`, `project`, `reference`. — [Docs Memory](https://code.claude.com/docs/en/memory)
- « Removed # shortcut for quick memory entry (tell Claude to edit your CLAUDE.md instead) » (2.0.70). — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

### Inferences
- Le binaire contient aussi une commande décrite « Pause automemory for this session » (alias `memory-pause`, `toggle-memory`), mais son nom exact n'est pas clair : l'extraction l'a mêlée à l'entrée `memory`.

### Gaps
- Nom et disponibilité exacts de la commande « Pause automemory for this session ».

---

## Q11. Sessions : sélecteur /resume, --continue, nommage, /export, /rename, forks

### Takeaway
Le sélecteur (`/resume`, alias `/continue`, ou `claude --resume`) s'intitule « Resume session ». Il propose une recherche (« Type to Search »), un aperçu (Space), le renommage (Ctrl+R, « Rename session: »), toutes les sorties (Ctrl+A), les worktrees (Ctrl+W) et la branche courante (Ctrl+B), et regroupe les entrées d'une même session (→/←). Aucune touche de suppression n'est documentée.

### Cited Findings
- Touches : ↑/↓, →/← (déplier ou replier un groupe), Enter, Space (aperçu ; Ctrl+V aussi), Ctrl+R (renommer), `/` ou tout caractère imprimable (recherche, y compris par URL de PR ou MR), Ctrl+A (tous les projets), Ctrl+W (tous les worktrees), Ctrl+B (branche git courante), Esc. Chaque ligne montre le nom (ou titre IA, résumé, premier prompt), le temps depuis la dernière activité, la branche git et la taille. — [Docs Sessions](https://code.claude.com/docs/en/sessions)
- Libellés : « Resume session », « No sessions match "… », « ctrl+a » avec « show all projects », « No conversations found. », « No conversations found in this project. », « Rename session: », « Enter new session name », « Type to Search ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- Le sélecteur charge plus de 50 sessions au défilement (2.1.243). Une session `/fork` est listée sous son nom de fork `⑂` (2.1.268). — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Nommage : `claude -n <nom>`, `/rename <nom>` (alias `/name` ; le nom s'affiche dans la barre du prompt), Ctrl+R dans le sélecteur, titre généré à l'acceptation d'un plan. Nom par défaut du type `my-app-3f` (v2.1.196+). En cas de collision, un suffixe de deux mots est ajouté (par exemple `auth-refactor-graceful-unicorn`). — [Docs Sessions](https://code.claude.com/docs/en/sessions)
- `/branch [name]` : « Create a branch of the current conversation at this point ». La confirmation affiche deux IDs. `--fork-session` fait de même depuis le CLI. `/export [filename]` : « Export the current conversation to a file or clipboard ». `/clear [name]` : « Start a new session with empty context; previous session stays on disk (resumable with /resume) ». `/rewind` (alias `/checkpoint`, `/undo`). — [Docs Sessions](https://code.claude.com/docs/en/sessions), [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- `claude --continue` rouvre la conversation la plus récente du répertoire. Si elle tourne en arrière-plan, la commande sort avec « Your most recent conversation is running in the background ». — [Docs Sessions](https://code.claude.com/docs/en/sessions)

### Inferences
- `Ctrl+B` a deux sens selon le contexte : filtre de branche dans le sélecteur, mise en arrière-plan dans la session. Un clone doit gérer ces raccourcis par contexte.

### Gaps
- Aucune suppression de session depuis `/resume` n'est documentée ni visible dans les libellés extraits. La suppression existe dans `claude agents` (Ctrl+X deux fois).

---

## Q12. Intégration IDE : /ide, diff dans l'IDE, partage de sélection, indicateur ⧉

### Takeaway
`/ide [open]` (« Manage IDE integrations and show status ») connecte le CLI à VS Code ou JetBrains via un serveur MCP local caché nommé `ide`. La sélection de l'éditeur est jointe à chaque prompt. Le transcript affiche « ⧉ Selected N lines from <fichier> », et le prompt affiche depuis 2.1.271 une pastille `[⧉ …]` qu'on retire avec Backspace. Les diffs s'ouvrent dans l'IDE, selon le réglage **Diff tool** de `/config`.

### Cited Findings
- « The transcript shows a `⧉ Selected N lines from <file>` line when this happens. » Une règle de deny `Read` bloque la sélection et l'avis du fichier ouvert. Le serveur `ide` est masqué de `/mcp`. Outils visibles par le modèle : `mcp__ide__getDiagnostics` et `mcp__ide__executeCode` (Jupyter, confirmation Quick Pick). — [Docs VS Code](https://code.claude.com/docs/en/vs-code), [Docs JetBrains](https://code.claude.com/docs/en/jetbrains)
- Rendu dans le binaire (`selected_lines_in_ide`) : « ⧉ » (aria-hidden), puis le nombre de lignes en gras, puis le chemin en gras. La pastille du prompt correspond au motif `[⧉ …]`. — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)
- 2.1.271 : « Changed the IDE selection indicator in the prompt to a `[⧉ …]` pill that wraps with the text instead of squeezing multi-line prompts; delete it with Backspace to leave the selection out ». 2.1.280 et 2.1.281 : la sélection est conservée lors d'une réédition, d'un rewind ou d'un message en file d'attente. **Attention** : depuis 2.1.281, `⧉ name`/`⧉ N` désigne aussi la pastille « artifacts » du pied de page, qui ouvre `/artifacts`. — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Messages : « Connected to IntelliJ IDEA. », « No available IDEs detected », « Tip: You can enable auto-connect to IDE in /config or with the --ide flag », « …e Code instance can be connected to VS Code at a time. ». Raccourcis : Cmd+Esc/Ctrl+Esc (lancement rapide), Cmd+Option+K/Alt+Ctrl+K (référence `@src/auth.ts#L1-99`). — [Docs JetBrains](https://code.claude.com/docs/en/jetbrains), [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

### Inferences
- L'ancien indicateur « ⧉ In <fichier> » du pied de page, cité dans la question, n'apparaît ni dans la doc actuelle ni dans les chaînes extraites. Il a été remplacé par la pastille `[⧉ …]` dans le prompt (2.1.271).

### Gaps
- Pas d'information sur l'affichage de la pastille quand un fichier est ouvert sans sélection (Attach Open File).

---

## Q13. Tâches de fond : Ctrl+B, /tasks, notifications

### Takeaway
`Ctrl+B` met en arrière-plan les commandes Bash et les agents en cours (deux fois sous tmux). `/tasks` (alias `/bashes`, « View and manage everything running in the background ») liste les shells, subagents, workflows et monitors, avec en 2.1.283 une icône d'état, des touches de page, la molette et les clics. `x` arrête une tâche. Une ligne signale qu'une mise à jour attend quand une tâche finit pendant qu'un panneau est ouvert.

### Cited Findings
- `Ctrl+B` : « Background running tasks — Backgrounds Bash commands and agents. Tmux users press… » ; `Ctrl+T` : « Toggle Claude's task checklist » ; `Ctrl+O` : transcript. — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- Les tâches de fond reçoivent un ID, leur sortie va dans un fichier lu par Read (l'outil TaskOutput a été retiré en 2.1.277), elles sont nettoyées à la sortie et tuées au-delà de 5 Go de sortie. `/tasks` s'exécute immédiatement, même pendant un tour. — [Docs Interactive mode](https://code.claude.com/docs/en/interactive-mode), [Docs Commands](https://code.claude.com/docs/en/commands), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- 2.1.283 : « Improved `/tasks`: rows show a status icon, the name and whole facts, the title and key hints stay on screen with many tasks, and the list gains paging keys, the mouse wheel and clicks ». 2.1.281 : `x` sur une `/ultrareview` en cours demande confirmation. 2.1.277 : « Added a line saying a background task's update is waiting when it finishes while a panel such as `/tasks` is open ». 2.1.282 : correctif d'un ` · ` doublé dans le pied de `/tasks`. — [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)
- Chaînes associées : « Backgrounded agent », « Fetching in background », « Background anyway (tasks will be stopped) », « Cloud agent launched ». — [binaire v2.1.282](file:///home/administrator/.local/share/claude/versions/2.1.282)

### Inferences
- Les notifications de fin arrivent comme messages système dans le transcript. Le mode `/focus` les regroupe en un seul compteur.

### Gaps
- Texte exact de la notification de fin d'une tâche Bash de fond dans le transcript : non extrait.
