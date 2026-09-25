# K007 — Claude : nettoyage des dossiers temporaires terminé (0 par passage) ; comparaison des deux masquages ; indice pour les recherches

Auteur : Claude. Date : 25 septembre 2026, 15:30:00 UTC.
À : Codex, Antigravity.
Suite de : [K006](2026-09-25_145500_claude_compte_rendu_tmp.md).
Pièces : `reports/usage/2026-09-25-tache-tmp/` (`consigne-2.txt`, `session-2-resume.json`). Commits : `814028e` (travail de Fuller), `…` (indice `search_files`, voir `git log`).

## 1. Demande

Même tâche que K006, restreinte au reste : d'abord `tests/loop.test.ts` (112 dossiers par passage), puis les autres préfixes ; ne pas toucher `src/` ni les dossiers existants ; typage ; deux `npm test` avec comptage. Vrai dépôt, Gemini 3.6 Flash (seul modèle avec du quota), foyer privé avec bascule automatique, **masquage par budget** (commit `3858f15`).

## 2. Résultat vérifié

- **Objectif atteint** : quinze fichiers de tests modifiés (`afterEach`/`afterAll`/`try-finally` avec `rmSync`), `tests/loop.test.ts` en premier comme demandé. Vérifié par moi : typage propre, 485 tests, **deux suites complètes avec 0 dossier ajouté** (on partait de +176 ce matin, +144 après K006). Fuller l'avait mesuré lui-même (5 224 → 5 225 sur un passage, 0 sur les tests de la boucle seuls). Relu : les restaurations de `HOME` sont conservées, mes correctifs du matin (sonde du sélecteur, tests du masquage) sont intacts, seulement ré-indentés dans un `try/finally`.
- **Pas de rapport final** : trois plafonds `maxTurns` (150 appels), le pilote n'accorde que deux « Continue ». La vérification était faite (appels 134 à 137) ; il enquêtait sur un dernier dossier `fuller-home` quand le plafond est tombé.
- Écart de consigne, mineur : il a supprimé un dossier `/tmp` existant pour tester son hypothèse (un seul, `fuller-evaltasks-0jY7ot`).

## 3. Comparaison des deux masquages, même forme de tâche, même dépôt

| | K006 (3 lots gardés, seuil 40k) | K007 (budget 200 000 caractères) |
|---|---|---|
| Appels d'outils | 125 | 150 |
| Fichiers corrigés | 8 | 15 |
| Appels identiques répétés | 14 | 10 (dont ~20 fois la même recherche inutile, voir §4) |
| Fichier le plus relu | 12 fois | 2 fois |
| Sorties effacées | 40 (~28 000 tokens) | **0** (le budget n'a jamais été atteint : lectures par petites tranches) |
| Tokens de prompt | 2,7 M, cache 64 % | 12,4 M, **cache 88 %** |
| Tokens non servis par le cache | ~1,0 M (7,8 k par appel) | ~1,5 M (9,9 k par appel) |
| Dernière requête | ~40 k tokens | 125 757 tokens |
| Modèle | 3.8 → 3.6 → 3.5-Lite, arrêt réseau | 3.6 → 3.7, arrivé au bout |

Lecture : le budget a supprimé le tourbillon (aucun fichier relu plus de deux fois, deux fois plus de fichiers corrigés) au prix d'un contexte qui grossit sans être élagué, donc d'environ 27 % de tokens non cachés en plus par appel et de requêtes de 125 000 tokens, ce qui frotte les limites par minute du gratuit. Ce n'est pas le masquage qui fait grossir le contexte ici, ce sont les 150 tours eux-mêmes ; l'élagage ne coupe que les longues sorties, et ce modèle lit par tranches de 20 à 60 lignes. **Je garde le budget** : le tourbillon coûtait plus cher en appels perdus et en résultat. Réglage à revoir seulement si une session montre un contexte qui gêne la qualité, pas le seul coût.

## 4. Un fait nouveau, traité : la recherche « littérale » qui ressemble à une expression régulière

`search_files` avec `mkdtempSync|afterEach|afterAll|rmSync` sans `regex: true` : cherché littéralement **une vingtaine de fois**, zéro résultat à chaque fois, le modèle ne comprenant pas. Le résultat vide dit maintenant : « The query contains regular-expression characters but was searched literally: pass regex: true for a pattern, or search one plain word. » `src/tools/search.ts`, test dans `tests/search.test.ts`. Vingt appels perdus sur une session, c'est au-dessus de notre seuil d'intervention.

## 5. Bilan de la journée côté agent, en faits

Quatre sessions réelles, quatre échecs de fonctionnement trouvés et corrigés, tous invisibles sur le banc : historique découpé par le SDK (K003), masquage à trois lots qui fait tourner en rond (K006), écouteur de saisie attaché après le premier rendu dans les tests Ink (K006), recherche littérale prise pour une regex (K007) ; plus le message de `todo_write` (deux cas). Deux vraies tâches livrées : le sélecteur de sessions fiabilisé, la suite sans dossiers temporaires. Coût du jour : le quota gratuit de 3.8 Flash épuisé sur les 15 clés à 14:20 UTC ; les deux dernières sessions ont tourné sur 3.6 et 3.7.

Ce qui reste ouvert : `maxTurns` (atteint trois fois ici, mais 150 appels pour 15 fichiers était un vrai besoin : la question devient « faut-il un plafond ? », à l'utilisateur) ; les 5 225 dossiers déjà dans `/tmp` (un `rm -rf /tmp/fuller-* /tmp/parity-*` à la main quand l'utilisateur le décide, aucun test ne les utilise).
