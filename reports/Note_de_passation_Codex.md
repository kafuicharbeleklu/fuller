# Note de passation — Codex, 24 septembre 2026

Pour Claude, Antigravity et les autres agents qui reprennent Fuller.

Mise à jour du 25 septembre : pour les prochaines priorités, lire la [note d'orientation pragmatique de Codex](Note_Orientation_Pragmatique_Codex.md). Le présent document reste un instantané historique des correctifs du 24 septembre, pas l'état courant du dépôt.

Cette note complète la [passation de Claude](Note_de_passation_Claude.md). Elle décrit les corrections demandées par l'utilisateur après sa lecture, et non une nouvelle étape de la feuille de route.

## 1. État du dépôt et périmètre

- HEAD vérifié : `b1c0578`.
- Les correctifs ci-dessous sont dans le répertoire de travail, **non commités et non poussés**. Ils ne sont donc pas inclus dans le statut CI mentionné dans la note de Claude.
- Huit fichiers suivis sont modifiés : cinq fichiers de production et trois fichiers de tests, listés ci-dessous.
- [Comparaison_Recherches_Fuller_Codex.md](Comparaison_Recherches_Fuller_Codex.md) était déjà non suivi ; il a été conservé sans modification. Cette présente note est également un nouveau fichier.
- Aucun appel de génération réel, aucune modification des clés, des quotas ou de la facturation.

Ne pas écraser ces changements en reprenant le travail ; examiner le diff et n'indexer que les fichiers voulus si un commit est demandé.

## 2. Correctifs appliqués

### A. Une commande quelconque ne compte plus comme vérification

Fichier : `src/agent/taskState.ts:31`.

Avant correction, après une modification de code, `node --version` suffisait à supprimer le rappel de vérification. Cette commande pouvait aussi remplacer l'état d'un test échoué.

Maintenant :

- `isCheckCommand()` reconnaît prudemment des commandes de test, compilation, typage et lint, en réutilisant le découpage des commandes du module de permissions.
- Les requêtes de version/aide, installations, commandes arbitraires et certaines compositions masquant les échecs ne sont pas acceptées comme contrôles.
- Les échecs restent suivis par commande : un lint réussi ne résout pas un test échoué ; la réussite ultérieure de la même commande lève son échec enregistré.
- Une écriture shell potentielle invalide un contrôle antérieur pour les fichiers déjà suivis.
- Les codes négatifs et les marqueurs de dépassement de délai ne sont plus interprétés comme un succès.

Cela reste un **rappel heuristique**, pas une certification du comportement ni de la couverture des tests. Des commandes personnalisées valides peuvent ne pas être reconnues. Les rappels restent bornés pour permettre une conclusion honnête.

### B. Revue propre, défauts trouvés et revue non concluante sont distincts

Fichiers : `src/agent/review.ts:88`, `src/agent/subagent.ts:139`, `src/agent/loop.ts:1131`.

- `parseReview()` retourne désormais un objet discriminé : `{ status: 'clean' }`, `{ status: 'issues', text }` ou `{ status: 'inconclusive' }`. **Il ne retourne plus une chaîne ou null.**
- Seul un verdict explicite `NO_ISSUES` est accepté comme revue propre ; une réponse vide, inutilisable ou ambiguë n'est pas un feu vert.
- `SubagentResult` contient un booléen `completed`, vérifié par l'appelant de la revue. Une revue tronquée, refusée ou arrêtée ne valide pas les changements.
- Le rapport du sous-agent utilise sa dernière réponse, sans recycler une ancienne affirmation antérieure à un appel d'outil lorsque la réponse finale est vide.
- Le message utilisateur signale explicitement une revue non concluante. Les erreurs empêchant la revue continuent à être signalées comme une revue sautée, sans bloquer la restitution du travail.

Ne pas réintroduire une condition de type `if (!parseReview(...))` : utiliser le discriminant `status` et tenir compte de `completed`.

### C. L'arrêt à la limite de tours répare l'historique sans effacer la chaîne complète

Fichiers : `src/agent/gemini.ts:332`, `gemini.ts:526`, `src/agent/loop.ts:821`.

- La branche `maxTurns` appelle maintenant `repairHistory()`.
- La réparation s'appuie sur `sanitizeHistory()`, également utilisé lors de la reconstruction d'une session.
- Les paires complètes appel/réponse sont conservées, y compris les signatures de réflexion.
- Les réponses sont appariées une à une par nom et identifiant ; les appels sans identifiant restent pris en charge lorsqu'ils correspondent.
- Une fin incomplète ou incohérente est retirée, sans remonter au-delà de la dernière paire complète.

Cela corrige le point signalé dans la section « Historique après un arrêt » de la passation de Claude. Ce n'est pas une garantie transactionnelle pour les effets de bord d'un outil interrompu avant l'enregistrement de sa réponse.

## 3. Tests ajoutés et vérifications effectuées

Tests modifiés :

- `tests/taskState.test.ts` : reconnaissance des contrôles, conservation/résolution des échecs, invalidation et trois états de revue.
- `tests/geminiRobustness.test.ts` : conservation des paires complètes/signatures, absence de mutation de l'historique fourni, réparation et rafraîchissement, appels parallèles avec ou sans identifiants.
- `tests/loop.test.ts` : rappel après commande non pertinente, arrêt à la limite puis message suivant, revue vide/tronquée/refusée, réponse ancienne non réutilisée, verdict propre explicite.

Résultats obtenus pendant le tour de correction précédent :

| Vérification | Résultat |
|---|---|
| `npm run typecheck` | Réussi |
| `npm run build` | Réussi |
| `git diff --check` | Réussi |
| `npm test -- --maxWorkers=2` | 56 fichiers, **399 tests réussis** |
| `python3 scripts/tui-smoke.py` | **11 scénarios PTY réussis** : classic/fullscreen, redimensionnement, menus, sélecteur de modèle, lecteur d'écran |

Attention : un passage de `npm test` avec le parallélisme par défaut a donné 398 succès et un échec dans `tests/sessionPicker.test.tsx:32` (filtrage au clavier, trame attendue pas encore affichée). Ce fichier n'a pas été modifié. Ses six tests ont ensuite réussi isolément, puis toute la suite a réussi avec deux workers. Une sensibilité au timing est plausible ; la cause n'a pas été démontrée ni corrigée.

Les tests du protocole et du relecteur utilisent des modèles simulés. Les smoke tests PTY ne valident pas les réponses réelles de Gemini/Gemma. Aucune nouvelle campagne d'évaluation de qualité n'a été exécutée. La création de cette note n'a pas relancé les suites.

## 4. Limites restantes et suite conseillée

1. Tester en conditions API réelles la reprise après limite/interruption et les trois issues du relecteur, avec un budget et un accès autorisés. Ne pas présenter cette vérification comme déjà faite.
2. Conserver la distinction entre contrôle reconnu et preuve suffisante : les commandes personnalisées, les modifications shell et la couverture réelle des fichiers ne sont pas intégralement modélisées. Le code de sortie est encore lu dans le texte de retour de l'outil.
3. Ajouter des scénarios difficiles et répétés pour mesurer l'effet du lot 2 ; le succès des tests logiciels ci-dessus n'est pas une mesure de gain de capacité du modèle.
4. Si l'échec du sélecteur de sessions revient, traiter sa synchronisation dans un travail distinct, sans augmenter arbitrairement les délais.
5. Reprendre ensuite les lots contexte/mémoire/outils de la feuille de route consolidée. Ne pas recréer la mémoire de base ou l'intégration Gemma déjà présentes.

Mon ancienne comparaison décrit un instant antérieur : pour l'état des lots 0 à 2, lire d'abord la passation de Claude, puis cette note et le code courant.
