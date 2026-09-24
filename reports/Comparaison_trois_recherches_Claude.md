# Comparaison des trois recherches sur Fuller — Claude

Auteur : Claude (auteur du rapport [`plan-efficacite-agent.md`](plan-efficacite-agent.md), désigné « T » ou « plan technique non signé » par Codex). Date : 24/09/2026, dépôt au commit `b6065d8`.

Documents comparés :

| Repère | Document | Auteur |
|---|---|---|
| A | [Rapport_Optimisation_Fuller_Antigravity.md](Rapport_Optimisation_Fuller_Antigravity.md) | Antigravity |
| C | [Rapport_Optimisation_Fuller_Codex.md](Rapport_Optimisation_Fuller_Codex.md) et [Comparaison_Recherches_Fuller_Codex.md](Comparaison_Recherches_Fuller_Codex.md) | Codex |
| T | [plan-efficacite-agent.md](plan-efficacite-agent.md) | Claude |

Priorité de l'utilisateur rappelée par Codex : **qualité maximale, même si c'est plus lent**.

## 1. Verdict

La comparaison de Codex est la plus rigoureuse des trois documents, et je retiens l'essentiel de son arbitrage : **commencer par une mesure fiable et une intégration Gemini robuste, puis la vérification du travail et la qualité du contexte**. Aucun des trois rapports n'a mesuré ses propositions sur Fuller ; les chiffres cités viennent d'autres agents et d'autres tâches.

Chaque rapport apporte quelque chose que les autres n'ont pas :

- **T (moi)** : les points propres à l'API Gemini, vérifiés dans le code et la documentation (température, préfixe mis en cache, `finishReason`, signatures de réflexion, chemin des sorties complètes), et le sujet clés/quotas.
- **C (Codex)** : la rigueur de mesure (évaluateurs protégés, plusieurs essais, erreurs d'API à part), l'état de tâche avec preuves liées à la dernière version des fichiers, la fidélité de la compaction, la mémoire avec provenance, la détection d'absence de progrès. Il a aussi trouvé des défauts que je n'avais pas vus (section 4).
- **A (Antigravity)** : l'outil `outline_file` (symboles et positions d'un fichier), la carte du dépôt, le contrôle syntaxique rapide, la commande `/learn`.

## 2. Forces et faiblesses

| | Forces | Faiblesses |
|---|---|---|
| **A — Antigravity** | Propositions d'outils concrètes, fichiers cibles indiqués | Diagnostic dépassé : la mémoire apprise existait déjà. Chiffres sans source (« un modèle seul résout 15–20 % », « le harnais fait 70–80 % », « lecture divisée par 5 », « −75 % grâce au cache »). Retour arrière automatique après erreur de syntaxe risqué (peut effacer une modification concurrente). Injecter `git status` en tête de chaque tour casse le préfixe mis en cache. Modèles « économiques » pour éditer et vérifier, à rebours de la priorité qualité |
| **C — Codex** | Niveaux de preuve explicites, critères de validation par lot, défauts réels trouvés dans le code, honnêteté sur ce qui n'est pas démontré | Plan large et peu d'étapes courtes ; les points Gemini (température, fins de génération) manquaient dans son premier rapport, ce qu'il reconnaît |
| **T — Claude** | Écarts Gemini précis et sourcés, étapes concrètes, sujet clés/quotas documenté | Critiques de Codex que j'accepte : édition floue jusqu'à 10 % d'écart trop risquée ; seuils (50 %, « 3 échanges », 50 000 tokens) présentés trop comme des règles ; « Gemma nettement moins capable » non démontré par mes tests simples ; « le 403 vient du compte » généralisé à partir de réponses de forum ; gains chiffrés d'autres outils non transférables |

## 3. Points d'accord des trois rapports

| Sujet | A | C | T | Décision |
|---|---|---|---|---|
| Mémoire des corrections | ✔ | ✔ | ✔ | **Faite** (outil `memory`). Suite : provenance, remplacement des notes contradictoires, sélection des notes utiles à la tâche (C) ; `/learn` comme raccourci (A) |
| Garder le contexte utile (masquer les vieilles sorties, résumer mieux) | ✔ | ✔ | ✔ | À faire, avec références vers les sorties complètes et paires appel/réponse intactes |
| Vérifier avant de conclure | ✔ | ✔ | ✔ | À faire en code (état de tâche), pas seulement dans le prompt |
| Contrôle syntaxique après édition | ✔ | ✔ | ✔ | À faire, en comparant les diagnostics avant/après, sans retour arrière automatique |
| Comprendre le dépôt (outline, carte) | ✔ | ✔ | ✔ | À expérimenter, bénéfice à mesurer |
| Relecture indépendante | ✔ | ✔ | ✔ | Sur les tâches risquées seulement, bornée |
| Température, `finishReason`, cache | — | ✔ (après coup) | ✔ | **Priorité 1** |

## 4. Défauts relevés par Codex, vérifiés dans le code actuel

| Défaut | Où | Vérifié | Effet |
|---|---|---|---|
| Le résumé de compaction ne voit que les **600 premiers caractères** de chaque résultat d'outil | `src/agent/gemini.ts` (`historyToText`) | Oui | Une erreur en fin de journal (tests, compilation) disparaît du résumé |
| Le banc d'essai vérifie dans le dépôt que l'agent peut modifier | `scripts/eval.mjs` (`check`) | Oui | Faux succès possible si l'agent modifie les tests |
| Sortie de commande tronquée sans chemin vers le fichier complet | `src/tools/registry.ts`, `src/agent/loop.ts` | Oui | Le modèle ne peut pas relire la fin d'un long journal |
| Température forcée, `finishReason` ignoré, environnement en tête du prompt | `src/agent/gemini.ts`, `src/agent/systemPrompt.ts` | Oui | Déjà dans T, toujours à corriger |

Point de Codex désormais dépassé : l'évaluation pouvait attribuer à tort un résultat au modèle demandé alors qu'un repli avait eu lieu. Depuis, le repli demande l'accord (ou est désactivé) et le mode `-p` ne bascule jamais sans `--fallback-model` : le banc reste sur le modèle demandé.

## 5. Divergences et arbitrage

| Question | Positions | Décision |
|---|---|---|
| Édition tolérante | T : cascade jusqu'au flou et correction par modèle ; C : diagnostics d'abord, flou non par défaut | **C** : d'abord des erreurs d'édition utiles (emplacements candidats, extrait à relire) ; normalisation limitée aux espaces de début/fin de ligne avec correspondance unique ; pas de correspondance floue par défaut |
| Contrôle syntaxique | A : `ts.createSourceFile` puis retour arrière ; C : diagnostics avant/après | **C**, et une contrainte pratique : `typescript` n'est pas une dépendance d'exécution de Fuller. Utiliser le TypeScript du projet s'il est installé, `JSON.parse` pour le JSON, `node --check` pour le JavaScript |
| État Git à chaque tour | A : en tête de chaque tour ; T et C : préfixe stable pour le cache | En fin de prompt ou dans le message utilisateur, jamais en tête |
| Plusieurs agents | A : architecte → éditeur → vérificateur, modèles économiques ; C et T : relecteur ciblé | Relecteur ciblé sur les changements risqués ; aucun modèle choisi pour son prix (priorité qualité) |
| Seuils de contexte | T : 50 %, 3 échanges, 50 000 tokens ; C : hypothèses à mesurer | À mesurer. Seule règle déjà appliquée : garder la conversation sous le plus petit modèle de la chaîne de repli, pour que le repli soit possible |
| Gemma | T : « moins capable » ; C : non établi | Non établi : comparer sur le banc avant de conclure |

## 6. Feuille de route consolidée

| Lot | Contenu | Origine | Validation |
|---|---|---|---|
| **0 — Mesure fiable** | Vérifications protégées (tests remis dans leur version d'origine avant contrôle), 3 essais par tâche, erreurs d'API à part, modèle réellement utilisé enregistré, traces d'échec gardées sans secrets, puis corpus porté à 20–30 tâches tirées de vrais échecs | C + T | Chaque évaluateur rejette une mauvaise solution et accepte une bonne |
| **1 — Intégration Gemini robuste** | Retirer la température ; traiter `finishReason` (vide, tronqué, appel mal formé, refus) sans rejouer d'outil ; chemin du fichier complet dans les sorties tronquées ; préfixe stable et taux de cache mesuré ; compaction qui garde la fin des sorties d'outils | T + C | Tests simulés de chaque fin de génération ; comparaison avant/après sur le banc |
| **2 — Travail vérifié** | État de tâche (objectif, contraintes, critères, preuves liées à la version des fichiers) ; détection d'absence de progrès ; relecteur sur tâches risquées | C + T + A | Moins de faux « terminé », sans bloquer une analyse ni une conclusion honnête |
| **3 — Contexte et mémoire** | Masquage récupérable des vieilles sorties ; résumé structuré ; notes avec provenance, remplacement et sélection | C + A + T | Contraintes gardées après compaction ; correction réutilisée dans une nouvelle session |
| **4 — Outils** | `outline_file`, carte du dépôt, contrôle syntaxique différentiel, meilleures erreurs d'édition | A + C | Gain sur changements multifichiers sans plus de mauvaises cibles |
| **5 — Modèles** | Comparer modèles et niveaux de réflexion sur le même corpus | C | Choix fondé sur les résultats |

## 7. Ce que je change dans mon propre plan

- Je retire la correspondance floue par défaut et la correction d'édition par modèle ; je commence par des erreurs d'édition plus utiles.
- Je présente les seuils comme des hypothèses à mesurer.
- Je retire « Gemma nettement moins capable » tant que le banc ne l'a pas montré.
- Je nuance « le 403 vient du compte » : c'est ce que répond le personnel Google sur le forum, pas une règle documentée.
- J'ajoute les défauts trouvés par Codex (compaction à 600 caractères, évaluateurs non protégés) au lot 0 et au lot 1.
