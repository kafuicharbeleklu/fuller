# 3d — /resume, âge des prompts dans ctrl+r, /permissions, /config

Référence : Claude Code 2.1.281, captures du 24/09/2026 à 100×30, sessions lancées une par une. Captures : `captures/3d-*.json`. La capture ctrl+r de Claude Code contient l'historique réel de l'utilisateur : elle n'est pas versionnée, seul son format est repris ici.

## /resume

| Point | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| Aide | `Ctrl+A to show all projects · Ctrl+B to only show current branch · Space to preview · Ctrl+R to rename · Type to search · Esc to cancel`, sur deux lignes si besoin | Ctrl+B, recherche, Échap (tronquée) | Comme Claude Code, renvoyée à la ligne |
| Ctrl+A | Toutes les sessions de tous les projets ; titre « Resume session (1 of 50) » ; le chemin du projet (`~/…`) ajouté aux détails ; aide « Ctrl+A to only show current repo » | Absent | Comme Claude Code (50 sessions au plus) |
| Session d'un autre dossier | Reprise impossible sur place | — | Message « This conversation is from a different directory. To resume, run: cd … && fuller --resume … », commande copiée |
| Espace | Aperçu : la conversation (bannière comprise) décalée de 2 colonnes, filet grisé, « 1h ago · 2 messages · HEAD », « Enter to resume · Esc to cancel » | Absent | Comme Claude Code ; ↑/↓ font défiler un aperçu long |
| Ctrl+R | « Rename session: » en gras, champ « Enter new session name » grisé, « Enter to save · Esc to cancel » à la place de la liste | Absent | Comme Claude Code ; le titre est enregistré dans le fichier de session |
| Défilement | Liste ancrée en haut, `↓` sur la dernière ligne quand il en reste | Sélection centrée | Comme Claude Code (`↑` en haut quand la liste a défilé) |
| Champ de recherche | Bordure grisée, `⌕ Search…` grisé, largeur terminal − 6 | Bordure gris clair, 2 colonnes plus étroite | Comme Claude Code |
| Taille | `2KB`, `181.7KB` | `2.0KB` | Comme Claude Code |

Écart restant : au lancement (`fuller --resume` sans identifiant), le sélecteur n'offre pas Ctrl+A, faute de transcript où afficher la commande à lancer.

## ctrl+r

| Point | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| Âge | `11m ago` en gris devant chaque prompt, deux espaces avant le texte | Absent | Comme Claude Code (heure lue dans `history.jsonl`, déjà enregistrée) |
| Couleurs | Texte des lignes en couleur normale, sélection en couleur permission | Tout en gris | Comme Claude Code |
| Aperçu | Cadre grisé, texte gris | Cadre couleur permission | Comme Claude Code |

## /permissions

Capture de Claude Code faite dans un dossier déjà approuvé ; elle contient des réglages de l'utilisateur et n'est pas versionnée.

| Point | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| Onglets | Recently denied · Allow · Ask · Deny · Auto mode · Workspace, Allow ouvert | Allow · Deny · Workspace | Allow · Ask · Deny · Workspace (Recently denied et Auto mode dépendent du mode auto, absent de Fuller) |
| Règles « ask » | Confirmation toujours demandée, même si une règle allow ou le mode autoriserait | Absentes | `permissions.ask` dans les réglages, prioritaire sur allow et sur les modes ; deny reste prioritaire |
| Focus | Sur les onglets au départ : onglet sur fond couleur permission, aucun `❯`, « ←/→ to switch · ↓ to select · Esc to cancel » | Liste sélectionnée d'emblée | Comme Claude Code |
| Liste | `↓` y entre ; l'onglet passe en gras inversé ; « ↑/↓ to navigate · Enter to select · ←/→ to switch · Esc to cancel » | — | Comme Claude Code |
| Recherche | Champ `⌕ Search…` aussi large que la description de l'onglet ; `/` l'active (bordure couleur permission) ; « Type to filter · Enter/↓ to select · ↑ to tabs · Esc to clear » ; le filtre masque « Add a new rule… » | Absente | Comme Claude Code |
| Ajout | Fenêtre « Add allow permission rule », explication, « e.g., **WebFetch** or **Bash(ls *)** », champ pleine largeur « Enter permission rule… », « Enter to submit · Esc to cancel » | Saisie dans la ligne 1 | Comme Claude Code (et « Add ask/deny permission rule ») |
| Workspace | `-  <dossier> (Original working directory)`, puis « 1. Add directory… » | Dossiers numérotés | Comme Claude Code ; « Add directory… » ouvre la fenêtre de `/add-dir` |

## /config (onglet Config de Settings)

| Point | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| Commande | `/config` « Open settings » | Absente | Ajoutée |
| Onglets | Status · Config · Usage · Stats | Status · Usage | Status · Config · Usage (pas de Stats : Fuller ne garde pas d'historique d'utilisation) |
| Ouverture | Focus sur « ⌕ Search settings… » (bordure couleur permission, onglet en gras inversé), « Type to filter · Enter/↓ to select · ↑ to tabs · Esc to clear » | — | Comme Claude Code |
| Liste | Nom sur 43 colonnes puis valeur ; `❯` et couleur permission sur la ligne choisie ; « Enter/Space to change · / to search · Esc to close » ; « ↓ N more below » | — | Comme Claude Code |
| Réglages | ~45 réglages propres à Claude Code | — | Ceux qui existent dans Fuller : Auto-compact, Effort, Verbose output, Notifications, Default permission mode, Theme et Model (ces deux derniers ouvrent leur sélecteur). Ils sont enregistrés dans `~/.fuller/settings.json`. |

## Vérifications

- `npm run typecheck`, `npm test` (40 fichiers, 246 tests), `npm run build` : OK.
- Suites PTY : permission 6/6, auth 10/10, smoke 11/11.
