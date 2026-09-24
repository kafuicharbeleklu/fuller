# Fuller — écarts subtils avec Claude Code 2.1.280

Audit du 23 septembre 2026, sur le contenu actuel du répertoire de travail, HEAD `8c2f2d6` avec modifications locales et nouveaux fichiers. Les références ci-dessous visent le contenu sur disque au moment de l'audit, pas uniquement ce commit.

Référence demandée : dernière version publiée. Le registre npm, interrogé sur `@anthropic-ai/claude-code/latest`, indique **2.1.280** ; le [changelog officiel](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21280) commence également par cette version. La documentation en ligne a été consultée le même jour ; elle évolue indépendamment des versions. Aucun comportement de Claude Code n'a été déduit de sa seule apparence.

## Méthode et limites

- Lecture des composants actuels et de leur branchement dans `App`. Les anciens rapports décrivent des états antérieurs ; leurs absences de fonctionnalités ne sont pas reprises comme constats actuels.
- Neuf scénarios exécutés sur les composants avec `ink-testing-library`, entrées clavier brutes et callbacks observés, sans appel Gemini. Ils produisent des preuves fonctionnelles au niveau composant, pas des captures d'un terminal réel.
- Référence Claude Code documentaire : aucun lancement comparatif de son binaire. Les différences de renderer sont explicitement indiquées.
- Sélecteur déjà ajusté : pas de nouvelle évaluation de sa conformité dans cet audit.
- Aucun changement du code applicatif ou des tests existants. Ce rapport est le seul fichier ajouté au projet par cet audit.

## Registre des écarts

Les numéros FUI sont propres à ce rapport. « Reproduit » désigne Fuller ; « statique » signifie établi par lecture du chemin de code. Tous les écarts ci-dessous sont **gênants** ; FUI-01 et FUI-05 sont prioritaires pour l'intégrité des interactions. Aucun blocage général du CLI n'a été établi.

| ID | Sujet et périmètre | Attendu documenté | Constat Fuller et preuve | État |
|---|---|---|---|---|
| FUI-01 | Collages repliés, historique et annulation | Rappel : restituer le collage, jamais envoyer son marqueur. [Historique](https://code.claude.com/docs/en/interactive-mode#command-history) | Le rappel dans la session et Backspace → Undo transmettent littéralement `[Pasted text #1 +4 lines]`. `src/ui/InputBox.tsx:151`, `:208`, `:229`, `:277`, `:320`. | Deux reproductions |
| FUI-02 | Déplacements et suppressions par mots | Alt+B/F/D séparent la ponctuation ; Ctrl+W s'arrête aux espaces. [Édition](https://code.claude.com/docs/en/interactive-mode#word-boundaries-in-editing-shortcuts) | `/`, `.`, `_`, `-` sont des caractères de mot ; Ctrl+W partage la même logique. `src/ui/InputBox.tsx:51`, `:163`, `:177`, `:455`, `:517`. | Deux reproductions |
| FUI-03 | Envoi immédiat pendant le travail | Ctrl+Entrée ou Ctrl+X Ctrl+S envoie file et brouillon immédiatement depuis 2.1.275. [File](https://code.claude.com/docs/en/interactive-mode#when-claude-code-sends-what-you-queued) | Ctrl+Entrée insère un retour à la ligne ; aucune interruption ni soumission. Les touches du second raccourci sont ignorées. `src/ui/InputBox.tsx:425`, `:458`, `:479`. | Ctrl+Entrée reproduit ; seconde combinaison statique |
| FUI-04 | Recherche historique en plein écran | Plein écran : Entrée charge le résultat ; Échap annule ; portées sélectionnables. [Recherche](https://code.claude.com/docs/en/interactive-mode#reverse-search-with-ctrlr) | Même recherche inline dans les deux renderers : Entrée soumet immédiatement, Échap conserve le résultat. Pas de prop de renderer dans `InputBox`. `src/ui/InputBox.tsx:397`, `src/ui/App.tsx:433`. | Soumission reproduite ; branchement plein écran statique |
| FUI-05 | Commentaire et refus de permission | Tab commente Oui/Non ; refus sans commentaire arrête le tour. [Permissions](https://code.claude.com/docs/en/permissions#add-a-comment-when-you-answer-a-permission-prompt) | Tab simple ignoré. Non → Entrée ouvre une saisie sans décider. Le refus finalement envoyé retourne une erreur d'outil au modèle sans arrêter explicitement le tour. `src/ui/PermissionPrompt.tsx:23`, `:31`, `src/agent/loop.ts:808`, `:661`. | Interaction reproduite ; continuation établie statiquement |
| FUI-06 | Suggestion grisée dans le prompt | Tab ou flèche droite insère la suggestion. [Suggestions](https://code.claude.com/docs/en/interactive-mode#prompt-suggestions) | Le texte est un placeholder ; Tab ne l'insère pas et Entrée reste sans effet. `src/ui/App.tsx:441`, `src/ui/InputBox.tsx:474`, `:502`, `:565`. | Tab → Entrée reproduit |
| FUI-07 | Défilement de la conversation en plein écran | PgUp/PgDn : demi-écran ; molette : quelques lignes ; Ctrl+Home/End : extrémités. [Défilement](https://code.claude.com/docs/en/fullscreen#scroll-the-conversation) | Molette et touches de page transmettent la même direction, puis déplacent d'une page entière. Ctrl+Home/End déplacent le curseur du prompt. `src/ui/InputBox.tsx:377`, `:463`, `:506`, `src/ui/FullscreenTranscript.tsx:33`. | Statique |
| FUI-08 | Relecture du transcript en plein écran | `[` exporte au scrollback ; `v` ouvre l'éditeur ; Ctrl+U/D : demi-page. [Transcript](https://code.claude.com/docs/en/fullscreen#search-and-review-the-conversation) | Aucun traitement de `[` ou `v` dans le pager ; Ctrl+U/D déplacent d'une page entière. `src/ui/Pager.tsx:61`, `:77`. | Statique |
| FUI-09 | Bash en cours : Ctrl+B | Ctrl+B passe Bash en arrière-plan. [Bash](https://code.claude.com/docs/en/interactive-mode#background-bash-commands) | La touche déplace toujours le curseur d'un graphème à gauche, même occupé ; aucune action de transfert n'est branchée dans `InputBoxProps`. `src/ui/InputBox.tsx:13`, `:451`. | Statique |
| FUI-10 | Complétion slash au milieu du prompt | Complétion possible après un espace. [Commandes](https://code.claude.com/docs/en/interactive-mode#complete-a-command-mid-prompt) | Le déclenchement exige un `/` initial et aucun espace dans l'intégralité du texte. `src/ui/InputBox.tsx:93`. | Statique |

## Reproductions et causes

### FUI-01 — perte du contenu associé au marqueur

1. Coller en bracketed paste quatre lignes : `line1`, `line2`, `line3`, `line4`.
2. Appuyer sur Entrée : `onSubmit` reçoit correctement les quatre lignes.
3. Appuyer sur Haut puis Entrée : `onSubmit` reçoit **`[Pasted text #1 +4 lines]`**.

Autre chemin : coller ces quatre lignes, Backspace, Ctrl+_, Entrée. Même marqueur transmis sans contenu.

Cause : `pushHistory(trimmed)` conserve le texte avant expansion ; `resetEditor()` vide la table des collages. Backspace supprime également l'entrée de cette table, alors que les snapshots Undo ne conservent que `text` et `cursor`. `expandPastes()` conserve silencieusement le marqueur lorsqu'il ne peut plus le résoudre.

La persistance disque passe par un autre chemin : `App.tsx:294` reçoit le texte développé. La reproduction établit donc la perte **dans la session courante**, sans conclure que toute reprise depuis le disque perd le collage. Restaurer les références et leur contenu ensemble, et tester leur cycle de vie, est prioritaire.

### FUI-02 — frontières différentes selon le raccourci

- Saisir `src/utils/foo.ts`, Alt+B, `X`, Entrée : sortie **`Xsrc/utils/foo.ts`**. Le déplacement saute le chemin entier.
- Saisir `alpha:beta`, Ctrl+W, Entrée : sortie **`alpha:`**. La suppression s'arrête au deux-points.

Cause : une unique fonction `isWordChar` sert à deux conventions distinctes. L'édition des graphèmes est déjà présente pour gauche/droite et Backspace ; les parcours par mots utilisent encore les indices UTF-16 et une définition spécifique des caractères de mot. Le comportement CJK reste à vérifier dynamiquement.

### FUI-03 — Ctrl+Entrée confondu avec le multiligne

Avec `busy=true`, une entrée en file et le brouillon `draft`, envoyer `ESC[13;5u` : le parser reconnaît un Return avec Ctrl, mais `InputBox` ajoute une ligne vide. Les callbacks d'interruption et de soumission ne sont jamais appelés.

Cause : `if (e.alt || e.ctrl || e.shift)` rassemble tous les Enter modifiés. Une correction doit conserver Ctrl+J multiligne : le parser représente également LF comme un Return avec Ctrl (`src/ui/useRawInput.ts:113`). Tester les octets des deux entrées est nécessaire pour éviter une nouvelle régression.

La reprise de file présente aussi un écart à traiter dans ce chantier : Fuller ne reprend qu'une entrée, uniquement sur prompt vide (`InputBox.tsx:489`, `loop.ts:295`). La documentation décrit une reprise groupée devant le brouillon. [Reprise de file](https://code.claude.com/docs/en/interactive-mode#take-back-what-you-queued)

### FUI-04 — distinguer les deux renderers

Avec l'historique `['old prompt']`, envoyer Ctrl+R, `old`, Entrée : `onSubmit('old prompt')` est appelé immédiatement. Ce comportement correspond à la validation classique documentée ; c'est son utilisation identique en plein écran qui constitue l'écart.

Autres différences établies par lecture : Backspace sur recherche vide laisse la recherche ouverte (`InputBox.tsx:408`), et sa liste provient de l'historique du projet avec fallback global (`session/history.ts:26`), sans sélection de portée. La recherche n'est pas à qualifier d'absente.

### FUI-05 — le dialogue de permission a son propre clavier

Sur un dialogue à choix Oui/Non :

1. Tab sur Oui : aucune saisie de commentaire n'apparaît.
2. Bas puis Entrée sur Non : aucun appel à `onDecide` ; un champ de feedback apparaît.

Cause : ce composant implémente ses propres touches au lieu de réutiliser `Select`. Les ajustements du sélecteur ne corrigent donc pas ce dialogue. Le type `PermissionDecision` n'autorise du feedback que pour `kind: 'no'` (`src/agent/types.ts:65`) ; prendre en charge un commentaire d'approbation nécessite aussi un changement de transmission vers l'agent.

Après refus effectif, `executeCall` renvoie une chaîne d'erreur et le chemin normal appelle `sendToolResponses`. La poursuite effective et la réponse du modèle n'ont pas été exécutées dans cet audit ; le modèle pourrait décider de s'arrêter, mais Fuller ne garantit pas l'arrêt du tour à cet endroit.

### FUI-06 — une suggestion affichée ne devient jamais du texte

Avec le placeholder `Run the tests`, Tab puis Entrée : aucune soumission. Cause : Tab ne traite que les menus et aucune branche ne copie `placeholder` dans l'éditeur. Les suggestions réelles de Fuller sont générées localement dans `suggestions.ts:14` et branchées comme placeholder ; leur contenu et leur mécanisme de génération ne sont pas assimilés à ceux de Claude Code.

## Points visuels à vérifier séparément

Ces observations internes sont établies par lecture, mais ne suffisent pas à mesurer une parité visuelle avec Claude Code :

- **Densité et style selon le renderer.** `App.tsx:66` initialise `verbose=true`. En classique, le rendu utilise `TranscriptItemView` et `ToolRow` ; en plein écran, il utilise les chaînes de `transcriptLines`, sans passer par le renderer Markdown (`App.tsx:90`, `:362`, `:370`). Les résultats terminés répètent `⎿` sur chaque ligne dans `viewerText.ts:57`, tandis que `ToolRow.tsx:64` le réserve à la première. Pendant le streaming plein écran, les noms internes et les arguments JSON sont visibles (`App.tsx:93`). Comparer une même conversation dans les deux modes avant de fixer les détails esthétiques.
- **Hauteur en plein écran.** La conversation reçoit `rows - 9` hors picker (`App.tsx:370`), puis spinner, notices, tâches, permission et saisie peuvent s'ajouter. Le risque de dépasser la hauteur avec un long diff ou une saisie multiligne demande une reproduction PTY à différentes dimensions.
- **Redimensionnement et rendu réel.** Aucune conclusion nouvelle sur flicker, reflow, sélection native, tmux/SSH ou couleurs. Les frames de composants ne prouvent pas le comportement ANSI d'un terminal.

## Vérification et ordre proposé

Commande exécutée :

```sh
npm test -- --run tests/keys.test.ts tests/tuiEnhancements.test.tsx tests/inputBorder.test.tsx tests/overlays.test.tsx tests/slashMenu.test.tsx
```

Résultat : **5 fichiers, 26 tests réussis**. Les neuf scénarios additionnels vérifient les observations décrites plus haut ; ils ne sont pas des tests d'acceptation de la parité. Script temporaire : `/tmp/fuller-parity-audit/reproduce.tsx` ; observations : `/tmp/fuller-tui-audit-results.json`. Ces artefacts temporaires ne constituent pas une archive durable ; les étapes et résultats utiles sont retranscrits dans ce rapport. Pas de build ni de publication pour cet audit documentaire.

Ordre conseillé pour une prochaine implémentation :

1. FUI-01 : contenu des collages à travers suppression, annulation, historique et envoi.
2. FUI-05 : validation de permission, commentaire, refus et arrêt du tour.
3. FUI-03 puis FUI-04 : séparer les intentions d'envoi, édition et sélection de résultat.
4. FUI-02, FUI-06, FUI-09 et FUI-10 : interactions courantes restantes.
5. FUI-07 et FUI-08 : navigation plein écran, puis captures comparatives du rendu.

Chaque correction doit avoir un test comportemental ciblé ; les changements visibles doivent aussi fournir un snapshot et une capture terminal conformément aux consignes du dépôt.

## Suite — corrections réalisées le 23 septembre 2026

À la demande de poursuivre, les dix écarts du registre ont été traités. L'audit ci-dessus conserve ses observations initiales ; ses numéros de ligne décrivent l'état avant correction.

| ID | Correction | Preuves ajoutées |
|---|---|---|
| FUI-01 | Historique conservant le texte développé ; Undo sauvegardant aussi collages et images ; envoi bloqué si une référence est introuvable ; expansion également en mode shell. | `tests/inputParity.test.tsx` : rappel, suppression/Undo, shell, référence manquante. |
| FUI-02 | Segmentation Unicode des mots pour Alt+B/F/D et suppression par mot ; Ctrl+W suit les espaces. | Chemins, ponctuation, underscore et segmentation CJK dans `inputParity`. |
| FUI-03 | Ctrl+Entrée et Ctrl+X Ctrl+S envoient immédiatement ; Ctrl+J reste multiligne. La file conserve pièces jointes et options, ainsi que les commandes shell, reprises sans interruption. Haut reprend les messages devant le brouillon. | Tests UI et tests `AgentLoop` pour FIFO, interruption, images et reprise groupée. |
| FUI-04 | Recherche plein écran avec sélection, portées session/projet/tous et restauration du brouillon ; validation classique conservée. | Tests UI, snapshot et PTY dans les deux modes. |
| FUI-05 | Tab commente Oui/Non ; commentaires conservés par option ; refus direct ; arrêt du tour principal si refus sans commentaire ; commentaire d'approbation transmis après le résultat. | Tests de dialogue, snapshot, tests d'arrêt, absence d'exécution des outils suivants et transmission du commentaire. |
| FUI-06 | Tab et flèche droite insèrent la suggestion affichée. | Deux tests UI. |
| FUI-07 | Demi-page, molette de trois lignes, Ctrl+Home/End ; suivi réactivé à la fin. | Test du viewport, nouveaux résultats pendant la relecture et routage clavier/souris. |
| FUI-08 | Export natif `[` et éditeur `v` en plein écran ; demi-page Ctrl+U/D et page Ctrl+B/F ; restauration du terminal et du brouillon. | Tests du pager, snapshot, exports éditeur et enregistrements PTY. |
| FUI-09 | Ctrl+B transfère le processus Bash existant au gestionnaire de tâches ; sortie conservée, interruption du tour détachée du processus transféré. | Test réel du processus : un seul lancement, sortie avant/après, fin notifiée une fois ; PTY du CLI. |
| FUI-10 | Complétion au milieu du prompt ; texte fantôme en classique, liste en plein écran ; aucune sélection initiale en plein écran et aucune exécution de la commande intégrée. | Tests Tab, Entrée, flèches, snapshots et PTY. |

Validation finale : **typecheck et build réussis ; 29 fichiers de tests, 179 tests réussis**, dont 25 nouveaux tests. Les tests avec serveur MCP ont été exécutés hors du bac à sable après l'échec de son sous-processus dans l'environnement restreint.

Captures sans requête au modèle, avec configuration temporaire isolée et `NO_COLOR=1` :

- [Classique, 60 colonnes](tui-parity/classic-60.cast) et [100 colonnes](tui-parity/classic-100.cast).
- [Plein écran, 60 colonnes](tui-parity/fullscreen-60.cast) et [100 colonnes](tui-parity/fullscreen-100.cast).
- [Transcript exporté vers l'éditeur, 100 colonnes](tui-parity/fullscreen-100-editor.txt).

Les quatre scénarios PTY passent : transfert Bash, fin de tâche, recherche, transcript, maintien du brouillon et complétion. Les deux captures plein écran contiennent chacune trois entrées et trois sorties du buffer alternatif ; aucune requête CPR `ESC[6n` n'a été observée. Ces vérifications n'établissent pas une identité visuelle avec le binaire Claude Code. Couleurs, comparaison avec son rendu réel, tmux/SSH, sélection native et le risque de hauteur décrit plus haut restent à examiner.

Régénération :

```sh
npm run typecheck
npm test
npm run build
python3 scripts/tui-parity-capture.py
# Seulement après revue d'un changement de rendu voulu :
npm test -- tests/inputParity.test.tsx tests/transcriptNavigation.test.tsx tests/tuiEnhancements.test.tsx --update
```

Les `.cast` utilisent le format asciinema v2 et peuvent être relus avec `asciinema play <fichier.cast>`. Ils conservent les séquences ANSI originales ; les snapshots de composants couvrent les frames textuelles.

## Suite — captures permission, erreur 429 et sudo

Les captures utilisateur ont orienté cette passe vers le cycle de rendu et l'authentification. Les commandes réseau et VPN contenues dans ces captures n'ont pas été exécutées. Les vérifications emploient des réponses Gemini simulées et un faux exécutable `sudo` qui utilise `getpass` sur `/dev/tty`.

| ID | Gravité | Constat et preuve | Correction et état |
|---|---|---|---|
| FUI-11 | gênant | **Reproduit** : un paragraphe sans retour à la ligne dépassait le budget de `LiveArea`. Ink déclenchait alors `ESC[2J ESC[3J ESC[H` et réimprimait l'historique entier. Source : `src/ui/LiveArea.tsx:24`. | Le texte est replié à la largeur effective avant de sélectionner les dernières lignes. Le test 60×16 interdit l'effacement global et vérifie que le texte terminé apparaît intégralement, une fois. Les enchaînements permission → résultat → retry → erreur sont rejoués à 60×16, 80×24 et 126×35 : aucun bloc d'attente résiduel, un seul prompt. **Corrigé pour les scénarios reproduits.** |
| FUI-12 | gênant | **Reproduit par callbacks simulés** : l'annonce d'attente restait active jusqu'à la fin de la requête suivante ; le commit de l'erreur finale précédait le retrait du spinner et de la notice. Des enveloppes JSON imbriquées rendaient aussi l'erreur illisible. Sources : `src/agent/loop.ts:611`, `:724` ; `src/agent/retry.ts:24`. | État `retrying` distinct, retrait de l'annonce au début de chaque tentative, nettoyage avant le commit final et décodage des messages imbriqués. Une interruption durant le backoff ne lance aucune requête supplémentaire. **Corrigé.** Les limites Gemini et leur durée ne sont pas modifiées. |
| FUI-13 | bloquant pour l'authentification | **Cause confirmée** : Bash était lancé dans une session détachée sans terminal de contrôle. Source : `src/tools/bash.ts:43`. | Après l'autorisation existante, une invocation directe de `sudo` au premier plan emprunte le TTY. Le clavier Ink, la lecture stdin de Node et les repaints sont suspendus ; `sudo` lit lui-même le mot de passe. La commande s'exécute une seule fois et sa sortie reste capturée. Restauration en fin normale, Ctrl+C, erreur et timeout. Sources : `src/ui/useTerminalHandoff.ts:13`, `src/ui/frameWriter.ts:186`. **Validé avec un faux sudo en PTY Linux.** |

### Preuves et limites

- `npm run typecheck`, `npm run build` et `git diff --check` réussis ; **32 fichiers, 193 tests réussis**.
- `tests/terminalLifecycle.test.tsx` utilise le vrai renderer Ink et le writer Fuller, puis rejoue les octets avec `@xterm/headless`. La colonne de marge utilisée par le CLI est conservée. Les snapshots portent sur le résultat après rejeu, comprenant le scrollback.
- `tests/retry.test.ts` vérifie début de tentative, backoff, arrêt après le dernier échec, annulation immédiate et lecture des erreurs imbriquées. `tests/loop.test.ts` vérifie l'ordre de nettoyage et l'absence de transfert au terminal après refus.
- **10 scénarios PTY, 100×28** : succès, annulation et timeout après saisie, puis annulation et timeout pendant la saisie masquée, dans chaque renderer. Aucun secret simulé dans le flux terminal, les fichiers de session, les sorties d'outil ou les journaux clavier/frame. Le terminal retrouve les modes echo et canonique à la sortie.
- **10 rejeux ANSI réussis** : un seul prompt, aucun état `Running`/permission/interrupt restant, un seul résultat du scénario nominal, aucune requête CPR. Exemples : [classique, succès](tui-auth/classic-success.cast), [écran rejoué](tui-auth/classic-success.txt), [plein écran, annulation pendant la saisie](tui-auth/fullscreen-cancel_prompt.cast).

Le collage utilisateur ne fournit pas les octets ANSI ni les dimensions exactes du terminal. Les doublons précis de cette capture ne sont donc pas tous attribués à une cause unique : les transitions simples ne les reproduisent pas dans le checkout actuel ; le débordement d'un long paragraphe est, lui, établi. La matrice ne prouve pas la parité visuelle avec le binaire Claude Code et ne couvre pas encore tmux/SSH, les longs dialogues plein écran ni tous les redimensionnements pendant l'authentification.

L'authentification automatique vise les commandes dont le parseur identifie `sudo` (y compris une séquence de commandes). Une commande cachée dans un script ou une autre chaîne shell n'est pas garantie détectée. Le mode headless, le lecteur d'écran et les tâches en arrière-plan ne bénéficient pas de cette saisie interactive. Les tests n'exécutent ni le vrai sudo ni une commande privilégiée ; aucune désactivation VPN n'a été effectuée.

Régénération et vérification des captures :

```sh
npm run build
python3 scripts/tui-auth-capture.py
node scripts/check-tui-auth.mjs
# Scénario ciblé :
python3 scripts/tui-auth-capture.py fullscreen cancel_prompt
# Snapshots : vérification normale, puis mise à jour seulement après revue
npm test -- tests/terminalLifecycle.test.tsx tests/nativeTerminal.test.ts
npm test -- tests/terminalLifecycle.test.tsx tests/nativeTerminal.test.ts --update
```

## Suite — trace du champ vide et dialogue de permission (23 septembre 2026)

La capture utilisateur précise deux écarts : le cadre `> ` de saisie vide reste sous « Waiting for permission… », puis la demande d'autorisation apparaît sans la carte et les détails attendus. La référence locale `claude --version` indique **2.1.281** ; la [documentation officielle des permissions](https://code.claude.com/docs/en/permissions) décrit les choix et les commentaires, mais ne spécifie pas toutes les dimensions ou couleurs du dialogue. Le rendu de ce dernier s'appuie aussi sur des captures publiques du client Claude Code ; il ne prétend pas à une copie au pixel près.

| ID | Gravité | Constat et cause | Correction et preuve |
|---|---|---|---|
| FUI-14 | gênant | **Reproduit dans la capture utilisateur** : trace de la zone de saisie vide pendant l'attente de permission. Cause exacte ANSI de cette capture non démontrable sans son flux brut ; la transition `awaiting_permission` précédait l'arrivée de `confirmation` et le masquage dépendait encore de l'état du champ. `src/ui/App.tsx:393-395`. | Le composeur est masqué dès `awaiting_permission` et pendant le transfert du TTY. Les rejeux xterm et six captures dans un vrai PTY n'observent aucun `> ` vide transitoire ni carte résiduelle, en classique et plein écran à 60×16, 100×28 et 126×35. `tests/terminalLifecycle.test.tsx:87-123`, `scripts/check-tui-permission.mjs`. **Corrigé pour les transitions reproduites.** |
| FUI-15 | gênant | **Reproduit dans la capture utilisateur et établi dans le composant** : la permission était du texte sans cadre, sans commande ni description, dissocié du choix. `src/ui/PermissionPrompt.tsx:68-101`. | Carte bordée avec titre, commande, description, raison de danger, question et choix. L'outil affiche « Running… » pendant que la carte est ouverte, comme dans [cet exemple public Claude Code](https://github.com/anthropics/claude-code/issues/34007). Format compact quand le terminal est bas ; le transcript plein écran cède la place à la carte sous 16 lignes. Snapshots à 12–35 lignes et captures PTY à 16–35 lignes. **Corrigé pour les tailles testées.** |
| FUI-16 | gênant | **Établi statiquement** : l'option « ne plus demander pour sudo » promettait une règle persistante alors que l'évaluation continue de demander pour le risque `danger`; un préfixe du premier segment ne couvre pas toute une commande composée. `src/permissions/rules.ts:165-166`, `:195-205`. | Seuls Oui/Non sont présentés pour une commande dangereuse ou composée. Tests ciblés pour `sudo … && sudo …` et commande composée avec réseau ; la règle persistante reste offerte pour une commande simple `npm run build`. **Corrigé.** |

Vérification : `npm run typecheck`, `npm test` (**32 fichiers, 198 tests**), `npm run build`, `git diff --check`, dix scénarios PTY avec faux `sudo` et leurs dix rejeux ANSI réussis. Six autres captures PTY utilisent le vrai renderer Ink et le writer Fuller avec un tour et une permission simulés, sans Gemini ni exécution de la commande. Le vérificateur rejoue attente, carte et résultat ; il impose zéro cadre `> ` pendant la permission, zéro effacement global à partir du tour, puis un seul prompt et un seul résultat finaux. Exemples : [capture classique 126×35](tui-permission/classic-126x35.cast), [écran de permission](tui-permission/classic-126x35.permission.txt), [plein écran 60×16](tui-permission/fullscreen-60x16.permission.txt). Régénération : `python3 scripts/tui-permission-capture.py`, puis `node scripts/check-tui-permission.mjs`.

La capture utilisateur initiale ne contient pas ses octets ANSI : l'attribution précise de sa trace au writer ou à Ink reste à vérifier sur ce terminal. Aucune commande VPN ou privilégiée réelle n'a été exécutée.
