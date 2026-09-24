# Plan pour rendre Fuller plus efficace — 24/09/2026

Sources : trois recherches du 24/09/2026 (Gemini CLI lu dans son code, publications d'Anthropic, Aider, SWE-agent, OpenHands, documentation de l'API Gemini, forum Google AI) et une lecture du code de Fuller. Chaque mesure citée vient de sa source ; les estimations d'effort sont les nôtres.

## Constat

Avec le même modèle, le harnais (le code autour du modèle) change fortement les résultats. Sur Terminal-Bench 2.0, Gemini 2.5 Pro obtient 32,6 avec le harnais Terminus 2 et 19,6 avec Gemini CLI ([tbench.ai](https://www.tbench.ai/news/terminal-bench-2-1)). Un harnais minimal (bash seul) atteint 75,8 % sur SWE-bench Verified avec Gemini 3 Flash ([swebench.com](https://www.swebench.com/)) : c'est la base à battre.

Fuller a aujourd'hui plusieurs écarts avec ce que recommandent Google et les meilleurs agents :

| Écart | Où | Ce que disent les sources |
|---|---|---|
| Température 0,2 (0,1 pour les résumés) | `src/agent/gemini.ts` | Google : garder la valeur par défaut pour Gemini 3, une température plus basse « may lead to unexpected behavior, such as looping or degraded performance » ; paramètre désormais déprécié ([doc Gemini 3](https://ai.google.dev/gemini-api/docs/gemini-3), [changelog](https://ai.google.dev/gemini-api/docs/changelog)) |
| Préfixe du prompt qui change (date, branche, mode, modèle en tête ; notes de mémoire dans le prompt système) | `src/agent/systemPrompt.ts` | Le cache implicite (−90 % sur les tokens en cache) exige un préfixe stable d'au moins 4 096 tokens ([caching](https://ai.google.dev/gemini-api/docs/generate-content/caching)) |
| Compaction à 85 % d'un million de tokens, anciennes sorties d'outils gardées entières | `src/config.ts`, `src/tools/truncate.ts` | Gemini CLI compacte à 50 % et masque les vieilles sorties ; Anthropic mesure +29 % de performance et −84 % de tokens en effaçant les vieux résultats d'outils ([context management](https://claude.com/blog/context-management)) |
| Édition par correspondance exacte seulement | `src/tools/fileOps.ts` | L'édition tolérante de Gemini CLI fait passer les échecs d'édition d'environ 20 % à 6 % ([PR #6823](https://github.com/google-gemini/gemini-cli/pull/6823)) |
| `finishReason` jamais lu (appels mal formés, réponses vides) | `src/agent/gemini.ts` | Google : « Always check the finishReason » ; Gemini CLI relance jusqu'à 4 fois ([function calling](https://ai.google.dev/gemini-api/docs/generate-content/function-calling)) |
| Aucune détection de boucle | — | Gemini CLI détecte les boucles en 3 couches et injecte un message de reprise ([loopDetectionService.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/loopDetectionService.ts)) |
| Cache jamais mesuré (`cachedContentTokenCount` non lu) | — | Seul moyen de savoir si le cache fonctionne |

## Étape 0 — Mesurer avant de toucher (prérequis)

1. Compléter le banc d'essai : 3 essais par tâche, et journaliser le taux d'échec d'édition, les erreurs « 0 matches », le nombre de tours, les tokens (médiane et 90e centile) et les tokens servis par le cache.
2. Lancer la mesure de référence sur Gemini 3.6 Flash dès que le quota le permet.
3. Ajouter 10 à 20 tâches tirées de vrais échecs de Fuller (Anthropic conseille 20 à 50 tâches issues d'échecs réels, avec plusieurs essais : [demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).

Chaque étape suivante se valide par une comparaison `--compare` avec la référence.

## Étape 1 — Gains rapides (un à deux jours, faible risque)

| # | Changement | Gain attendu | Effort |
|---|---|---|---|
| 1 | Retirer la température (valeur par défaut du modèle), mettre les règles de rigueur dans le prompt système | Moins de boucles, meilleur raisonnement (recommandation Google) | Très faible |
| 2 | Préfixe stable : bloc Environnement et notes de mémoire déplacés après la partie fixe du prompt ; ordre des outils figé ; afficher le taux de cache dans `/stats` | Jusqu'à −90 % sur le coût des tokens répétés, réponses plus rapides | Faible |
| 3 | Lire `finishReason` : relancer une fois sur `MALFORMED_FUNCTION_CALL`, réponse vide ou réflexion sans réponse, avec un message de relance | Moins de tours perdus | Faible |
| 4 | Vérifier que les signatures de pensée survivent à la reprise de session et à la compaction ; à défaut, la signature de secours documentée par Google | Évite les erreurs 400 en milieu de session | Faible |
| 5 | Sorties longues : fichier complet sur disque et chemin donné au modèle (au lieu de couper) | Le modèle peut relire ce qu'il lui faut | Très faible |

## Étape 2 — Contexte et outils (une semaine)

| # | Changement | Gain mesuré ailleurs | Effort |
|---|---|---|---|
| 6 | Masquer les anciennes sorties d'outils (garder les ~50 000 derniers tokens intacts, remplacer le reste par un aperçu + chemin du fichier) | +29 % et −84 % de tokens (Anthropic) ; SWE-agent 18,0 % contre 15,0 % | Faible |
| 7 | Compacter en instantané structuré (objectif, contraintes, fichiers touchés, tâches faites et à faire) suivi d'un second passage qui vérifie les oublis, **sans couper les sorties d'outils à leurs 600 premiers caractères** (défaut relevé par Codex) ; seuil à mesurer | Sessions longues plus fiables | Faible |
| 8 | Édition : d'abord des erreurs utiles (emplacements candidats, extrait à relire) ; normalisation limitée aux espaces de début et de fin de ligne, avec correspondance unique ; refus des `new_string` à trous (« … rest of code »). Pas de correspondance floue par défaut (révisé le 24/09 après la comparaison de Codex) | Gemini CLI rapporte ~20 % → 6 % d'échecs avec une cascade plus large, non transférable tel quel | Faible à moyen |
| 9 | Outils « en chaîne » : une recherche qui trouve 3 résultats ou moins renvoie directement le code autour ; une écriture renvoie son diff | −10 % de tours ([PR #19574](https://github.com/google-gemini/gemini-cli/pull/19574)) | Faible |
| 10 | Détection de boucles : même cycle d'appels répété 5 fois, ou même bloc de texte répété ; premier signal = message « prends du recul », second = arrêt | Évite les sessions qui tournent à vide | Faible |
| 11 | Après chaque édition, vérifier la syntaxe du fichier modifié et ne renvoyer que les nouvelles erreurs (le hook `PostToolUse` couvre déjà le typecheck complet) | SWE-agent : 18,0 % contre 15,0 % avec le linter | Moyen |

## Étape 3 — Qualité sur les tâches longues (plus tard, selon les mesures)

| # | Changement | Gain mesuré ailleurs | Effort |
|---|---|---|---|
| 12 | Sous-agent Explore avec rapport imposé (constats, fichiers pertinents, symboles clés) | Moins de contexte dans l'agent principal | Faible |
| 13 | Relecteur : un sous-agent relit le diff avant de conclure | Aider +3 à 5 points ; OpenHands 60,6 % → 66,4 % | Moyen |
| 14 | Consignes de fin : « la validation est la seule fin possible », reproduire un bug par un test, changer d'approche après 3 échecs | +20 % environ sur SWE-bench interne d'OpenAI avec 3 rappels ([guide GPT-4.1](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide)) | Très faible |
| 15 | Routage automatique Flash-Lite / Flash selon la difficulté, et repli de modèle sur 503 (dont Gemma 4, voir `research_notes/gemma-via-api-gemini.md`) | Coût et disponibilité | Moyen |

## Clés API et quotas — à décider

- Les limites sont **par projet**, pas par clé ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)). Faire tourner des clés de plusieurs projets gratuits pour additionner les quotas revient à contourner les limites, ce que les conditions des API Google interdisent (§2d, [developers.google.com/terms](https://developers.google.com/terms)).
- Le 403 « Your project has been denied access » : selon les réponses du personnel Google sur le forum, il vient d'un signalement du compte (par ex. [fil 182326](https://discuss.ai.google.dev/t/gemini-api-returns-403-your-project-has-been-denied-access/182326)) ; ce n'est pas une règle documentée. Pistes de déblocage citées par Google : vérification d'âge et date de naissance, numéro de téléphone, validation en deux étapes, nouvelle clé, puis activation de la facturation. Aucun déblocage manuel du quota gratuit n'est documenté.
- Google annonce que les clés « standard » (`AIza…`) seront refusées ([api-key](https://ai.google.dev/gemini-api/docs/api-key)) : notre clé principale est de ce type et doit être remplacée par une clé `AQ.…`.
- **Recommandation** : un seul projet avec facturation (Tier 1 dès 5 $ prépayés, passage en général immédiat), et garder la bascule de clés comme secours, pas comme moyen d'additionner des quotas gratuits.

## Révision du 24/09 (après comparaison)

Voir [Comparaison_trois_recherches_Claude.md](Comparaison_trois_recherches_Claude.md) : les seuils cités sont des hypothèses à mesurer ; ajouter au lot de mesure la protection des évaluateurs (l'agent ne doit pas pouvoir modifier les tests qui le jugent).

## Ordre conseillé

Étape 0, puis 1 → 2 → 3, en mesurant après chaque lot. Les éléments 1, 2, 6, 8 et 10 sont ceux qui ont les gains mesurés les plus nets pour l'effort.
