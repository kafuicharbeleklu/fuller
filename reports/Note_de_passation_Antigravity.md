# Note de passation — Antigravity, 24 septembre 2026

Pour **Claude**, **Codex** et les autres agents reprenant le développement de Fuller.  
Dépôt au commit [`8c1c1d1`](https://github.com/kafuicharbeleklu/fuller/commit/8c1c1d1), branche `main`, intégration propre, validée et poussée sur `origin/main`.

Cette note fait suite aux notes de passation de [Claude](Note_de_passation_Claude.md) et de [Codex](Note_de_passation_Codex.md).

---

## 1. Ce qui a été validé et intégré

### A. Intégration et commit des correctifs de Codex (Commit `e41e636`)
J'ai vérifié, compilé et commité l'ensemble des 8 fichiers modifiés par Codex :
1. **`src/agent/taskState.ts` :** Vérification stricte via `isCheckCommand()` (les commandes neutres type `node -v` ou `ls` ne réinitialisent plus les alertes de test manquant).
2. **`src/agent/review.ts` & `src/agent/loop.ts` :** Statut discriminé strict pour la relecture (`clean`, `issues`, `inconclusive`) pour éliminer tout faux feu vert sur réponse vide ou tronquée.
3. **`src/agent/gemini.ts` & `src/agent/loop.ts` :** Nettoyage et préservation des paires appel/réponse via `repairHistory()` / `sanitizeHistory()` lors de l'arrêt sur `maxTurns` (évite l'erreur HTTP 400 au tour suivant).
4. **Rapports :** Ajout des documents de comparaison et de passation de Codex dans `reports/`.

---

### B. Implémentation du Lot 4 : Outils & Mémoire rapide (Commit `8c1c1d1`)

Conformément à la feuille de route consolidée, deux fonctionnalités majeures ont été livrées :

#### 1. Nouvel outil `outline_file`
- **Fichier source :** [`src/tools/outline.ts`](../src/tools/outline.ts).
- **Intégration :** Déclaré dans [`src/tools/registry.ts`](../src/tools/registry.ts) (inscrit dans `READ_ONLY_TOOLS`, libellé `Outline`), documenté dans [`src/agent/systemPrompt.ts`](../src/agent/systemPrompt.ts).
- **Fonctionnement :** Analyse un fichier source (TypeScript, JavaScript, Python, Go, Rust…) et extrait uniquement les classes, interfaces, fonctions, méthodes et types avec leurs **numéros de lignes exacts** (1-indexed).
- **Objectif :** Éviter les `read_file` complets de plusieurs centaines de lignes. L'agent repère la ligne du symbole cible en 20-30 tokens, puis lit précisément le bloc voulu avec `offset` et `limit`.
- **Tests :** 4 tests unitaires complets créés dans [`tests/outline.test.ts`](../tests/outline.test.ts) (TypeScript, Python avec méthodes de classes, fichiers vides, gestion d'erreurs).

#### 2. Commande slash `/learn <note>`
- **Fichier source :** [`src/ui/commands.ts`](../src/ui/commands.ts).
- **Fonctionnement :** Permet à l'utilisateur d'ajouter une consigne directement depuis le prompt (ex: `/learn Toujours utiliser vitest --run`).
- **Liaison :** S'interface directement avec [`src/agent/autoMemory.ts`](../src/agent/autoMemory.ts) (`addMemory`). La note est immédiatement enregistrée dans la mémoire de projet et sera rechargée dans tous les tours et sessions futurs.

---

## 2. Validation technique effectuée

| Contrôle | Commande | Résultat |
| :--- | :--- | :--- |
| **Typage strict** | `npm run typecheck` | Réussi (0 erreur) |
| **Tests unitaires** | `npm test -- --maxWorkers=2` | **57 fichiers, 403 tests réussis** |
| **Smoke tests TUI** | `python3 scripts/tui-smoke.py` | **11 scénarios PTY réussis** (classic, fullscreen, resize, model picker, screen reader) |
| **Compilation** | `npm run build` | Réussi (dossier `dist/` à jour) |
| **Git & Synchronisation** | `git push origin main` | Poussé sur `origin/main` jusqu'à `8c1c1d1` |

---

## 3. Recommandations et suite proposée pour le prochain agent

Pour continuer à exécuter la feuille de route consolidée :

1. **Suite du Lot 4 — Contrôle syntaxique différentiel post-edit :**
   - Dans [`src/tools/fileOps.ts`](../src/tools/fileOps.ts) : après une édition de fichier, lancer un parser léger (`JSON.parse` pour `.json`, `node --check` pour `.js`, et le binaire TypeScript du projet s'il est présent dans `node_modules`).
   - Renvoyer le diagnostic d'erreur de parsing au modèle **sans faire de rollback automatique destructeur** (pour éviter les écrasements de modifications concurrentes).
2. **Lot 3 — Contexte & Observation Pruning :**
   - Dans [`src/agent/loop.ts`](../src/agent/loop.ts) : pour les tours anciens (> 3 tours en arrière), masquer les gros corps de sorties d'outils (`execute_bash`, `read_file`) en conservant un résumé et le chemin du fichier complet sur disque.
   - Veiller à préserver intactes les paires appel/réponse et les signatures de réflexion Gemini.
3. **Lot 0 — Élargissement du banc d'évaluation :**
   - Étendre `evals/tasks/` avec 15 à 20 scénarios complexes tirés d'échecs réels de Fuller (cas où l'agent a tendance à conclure trop vite sans tester) pour enfin observer et mesurer l'effet du Lot 2 (`taskState.ts` et relecteur).

---

## 4. Rappels opérationnels du dépôt

- Toujours exécuter `npm run typecheck`, `npm test` et `npm run build` avant de commiter.
- Tester l'interface TUI avec `python3 scripts/tui-smoke.py`.
- Commits courts en français décrivant l'action concrète.
- Ne jamais inclure de clés API ou de secrets dans les commits ou les logs.
