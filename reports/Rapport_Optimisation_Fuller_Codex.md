# Rapport de recherche et plan d'amélioration de Fuller — Codex

- **Auteur :** Codex.
- **Date :** 24 septembre 2026.
- **Priorité exprimée par l'utilisateur :** qualité maximale, même si l'exécution est plus lente.
- **Périmètre :** efficacité de l'agent de programmation, raisonnement appliqué, vérification, contexte, mémoire des expériences et fiabilité d'exécution.
- **Statut :** recherche et proposition d'architecture ; aucune modification fonctionnelle mise en œuvre dans le cadre de ce rapport.
- **Méthode :** lecture du code de Fuller, documentation officielle, publications de recherche et retours d'ingénierie. Aucun benchmark payant ni essai comparatif de modèles exécuté pour ce rapport.

## 1. Recommandation principale

Renforcer en premier la mesure des résultats, la vérification du travail et la conservation du contexte. Développer ensuite l'exploitation des corrections utilisateur, la compréhension du dépôt et la revue indépendante des changements difficiles.

Le code autour du modèle peut améliorer les résultats obtenus par l'agent. Il ne garantit pas une équivalence générale de raisonnement avec un autre modèle. Les gains proposés ici sont des hypothèses à mesurer sur les tâches de Fuller, et non des améliorations déjà démontrées.

La qualité maximale signifie ici : respecter l'intention de l'utilisateur, produire un résultat correct, préserver les comportements existants, vérifier les changements et réduire les corrections manuelles nécessaires. La rapidité et le coût restent observés, mais ne constituent pas le premier critère de sélection.

## 2. État actuel vérifié dans le code

Le dépôt a évolué depuis le premier échange : Fuller dispose déjà d'une mémoire des expériences et d'un banc d'évaluation. Le plan doit s'appuyer sur ces fonctions existantes.

Les références ci-dessous correspondent au code inspecté lors de la recherche. Les numéros de ligne peuvent évoluer.

| Élément | Constat dans le code | Conséquence pour le plan |
|---|---|---|
| Mémoire apprise | `src/agent/autoMemory.ts:21` : entrées avec identifiant, type, portée, texte et date ; ajout, suppression, déduplication simple et filtre de secrets | Enrichir la mémoire et sa sélection, sans recréer le stockage |
| Injection des souvenirs | `src/agent/autoMemory.ts:102` et `src/agent/systemPrompt.ts:72` : toutes les notes chargées sont ajoutées au prompt | Introduire une sélection pertinente pour la tâche et des règles de résolution des contradictions |
| Instructions persistantes | `src/agent/contextLoader.ts:49` : chargement des fichiers utilisateur, projet et locaux | Conserver cette base et la distinguer des souvenirs déduits d'expériences |
| Évaluations | `scripts/eval.mjs:75` et `evals/tasks/` : huit scénarios, contrôles exécutables, répétitions et comparaison de résultats | Étendre la couverture et renforcer l'indépendance des contrôles |
| Vérification | `src/agent/systemPrompt.ts:43` demande les tests ; `src/agent/loop.ts:720` termine la boucle en l'absence d'appels d'outils ; hooks Stop disponibles | Ajouter un suivi explicite des critères de réussite et de leur validation |
| Compression | `src/agent/gemini.ts:276` demande un résumé d'environ 600 mots ; `historyToText`, ligne 333, limite chaque résultat d'outil à ses 600 premiers caractères | Préserver les diagnostics, contraintes et éléments récents au-delà d'un résumé général |
| Déclenchement de la compression | `src/agent/loop.ts:821` appelle la compression automatique après le tour principal | Prévoir la gestion du contexte pendant les longues exécutions, à des frontières cohérentes |
| Cohérence des éditions | `src/tools/fileTracker.ts:10` contrôle la lecture préalable et les changements depuis la lecture | Vérifier la couverture de cette protection dans les sous-agents et les différents chemins d'écriture |
| Exécution | `src/agent/retry.ts`, `loop.ts` et `subagent.ts` : reprises sur erreur, limites de tours, sous-agents et lectures parallèles | Compléter par la détection du manque de progrès et la reprise durable |
| Mesure de consommation | `src/agent/loop.ts:607` comptabilise les appels principaux ; certains appels auxiliaires suivent d'autres chemins | Unifier la comptabilité avant de comparer le coût total des configurations |

### Limites des constats

- La perte possible d'une erreur située à la fin d'un journal est une déduction du découpage à 600 caractères, pas un incident reproduit pendant cette recherche.
- Certains évaluateurs exécutent les tests présents dans le dépôt modifiable par l'agent. Cela crée un risque de faux succès ; aucun contournement effectif n'a été observé.
- Les protections présentes dans un chemin d'exécution ne permettent pas d'affirmer qu'elles couvrent tous les autres chemins sans tests complémentaires.
- Aucun taux de réussite actuel, gain de qualité ou classement des modèles n'est établi par cette inspection.

## 3. Enseignements des recherches

### Évaluer le résultat réel et la régularité

Une évaluation d'agent doit examiner l'état final de l'environnement, pas seulement sa réponse. Plusieurs essais sont nécessaires pour distinguer une amélioration stable d'un succès occasionnel. Les tâches issues d'échecs réels constituent un bon point de départ. [Source : Anthropic, évaluation des agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

### Préserver les informations utiles sur les tâches longues

La compression, les notes structurées et la récupération ciblée du contexte répondent à des besoins complémentaires. Une réduction trop agressive peut supprimer des informations qui deviennent importantes plus tard. [Source : Anthropic, gestion du contexte](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

### Concevoir les outils pour leur utilisateur : le modèle

Les travaux SWE-agent montrent que l'interface de navigation, d'édition et d'exécution influence les performances. Les retours doivent notamment être compréhensibles et permettre à l'agent d'agir après une erreur. Ces résultats motivent des améliorations d'outils, sans fournir un gain chiffré transférable à Fuller. [Source : SWE-agent](https://arxiv.org/abs/2405.15793).

### Accumuler des connaissances exploitables

ACE étudie l'adaptation du contexte par des connaissances et stratégies conservées et mises à jour progressivement. Cette approche se distingue du réentraînement des paramètres du modèle. Ses résultats encouragent l'expérimentation, mais ne prouvent pas que la même architecture améliorera Fuller dans les mêmes proportions. [Source : ACE](https://arxiv.org/abs/2510.04618).

### Donner une vue compacte du dépôt

Aider construit une carte des fichiers et des symboles, puis sélectionne les éléments pertinents dans un budget de contexte. Cette approche fournit une piste pour retrouver les dépendances avant de modifier une fonction. [Source : Aider, repository map](https://aider.chat/docs/repomap.html).

### Utiliser une revue indépendante là où elle apporte des preuves

Le retour d'ingénierie d'Anthropic de mars 2026 décrit des boucles de génération et d'évaluation séparées. Il souligne également que l'évaluateur doit être calibré, qu'il conserve des limites et que son intérêt dépend de la difficulté du travail. [Source : conception d'agents pour les tâches longues](https://www.anthropic.com/engineering/harness-design-long-running-apps).

## 4. Plan d'implémentation proposé

Les nouveaux noms de modules ci-dessous sont des propositions, pas des fichiers déjà créés.

### Lot 1 — Évaluations fiables et instrumentation

**Objectif :** savoir précisément si une modification rend Fuller meilleur.

**Base existante :** `scripts/eval.mjs`, `evals/tasks/`, `src/headless.ts`, `src/agent/gemini.ts` et `src/agent/loop.ts`.

**Travaux :**

- Porter progressivement le corpus de huit à 30–50 scénarios représentatifs : corrections multifichiers, contraintes anciennes, reprise, mémoire entre sessions, TUI et analyse sans modification.
- Définir une solution de référence pour chaque scénario et vérifier le comportement de l'évaluateur sur une solution incorrecte comme sur une solution correcte.
- Conserver les contrôles finaux hors de la portée d'écriture de l'agent ou vérifier leur intégrité avant l'évaluation.
- Ajouter des critères de respect du périmètre : fichiers interdits inchangés, contrats publics préservés et absence de modifications inutiles.
- Conserver les traces d'échec nécessaires au diagnostic, avec exclusion des secrets et politique de rétention explicite.
- Enregistrer la révision de Fuller, le modèle, les réglages, la version du scénario, les outils et les résultats.
- Répéter les tâches, séparer les tâches de développement de celles réservées à l'évaluation finale, et distinguer erreurs API, environnement et raisonnement.
- Mesurer tous les appels : agent principal, sous-agents, résumés et autres appels auxiliaires.

**Validation :** aucun scénario ne peut être déclaré réussi uniquement parce que l'agent a affaibli son contrôle ; les résultats sont comparables et les échecs explicables.

### Lot 2 — État de tâche et vérification avant conclusion

**Objectif :** distinguer travail effectué et travail validé.

**Modules proposés :** `src/agent/taskState.ts` et `src/agent/verification.ts`, intégrés à `loop.ts` et au stockage de session.

**Travaux :**

- Conserver l'objectif, les contraintes explicites, les critères de réussite et les hypothèses encore ouvertes.
- Suivre les fichiers modifiés et les vérifications applicables.
- Associer chaque résultat de vérification à la version ou à l'empreinte des fichiers qu'il couvre.
- Invalider les résultats concernés après une nouvelle modification.
- Avant la conclusion d'une tâche de modification, examiner les critères manquants et exécuter les contrôles autorisés pertinents.
- Pour un bug : rechercher une reproduction, vérifier la correction, puis les régressions applicables.
- Pour une analyse : contrôler les références et la cohérence des conclusions ; ne pas déclencher des tests ou des modifications sans rapport avec la demande.
- Conserver explicitement les vérifications impossibles ou non concluantes.

**Validation :** les essais détectent les faux « terminé », y compris quand un test a réussi avant la dernière modification. Les commandes restent soumises aux permissions existantes.

Cette proposition s'appuie sur l'usage d'états de progression et de critères vérifiables pour les travaux longs. [Source : Anthropic, agents de longue durée](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

### Lot 3 — Contexte et compression fiables

**Objectif :** conserver les informations décisives quand la conversation ou l'exécution s'allonge.

**Fichiers concernés :** `src/agent/gemini.ts`, `src/agent/loop.ts`, `src/session/store.ts` ; un module dédié de gestion du contexte pourra être extrait.

**Travaux :**

- Conserver un état structuré de la tâche indépendamment du résumé narratif.
- Préserver une portion récente de l'historique et les résultats encore nécessaires.
- Maintenir des références vers les sorties complètes pour pouvoir retrouver une preuve.
- Remplacer le simple préfixe de 600 caractères par une représentation qui conserve statut, code de sortie, diagnostics utiles et emplacement de la trace complète.
- Surveiller le contexte pendant les longues exécutions, avec une marge pour le prochain résultat d'outil et la prochaine réponse.
- Compacter à une frontière où les appels d'outils et leurs réponses forment un ensemble cohérent.
- Tester interruption, sauvegarde, reprise et compression sans casser les métadonnées propres au fournisseur.

Google précise que les signatures de raisonnement doivent être conservées lors des échanges d'outils concernés. Le SDK les gère dans les usages documentés ; les reconstructions manuelles d'historique nécessitent une attention particulière. [Source : signatures de raisonnement Gemini](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures).

**Validation :** après une compression forcée, Fuller conserve les contraintes, retrouve une erreur située en fin de journal et ne réexécute pas une modification déjà effectuée.

### Lot 4 — Mémoire pertinente des corrections et décisions

**Objectif :** réutiliser les expériences utiles au bon moment et dans le bon projet.

**Base existante :** `src/agent/autoMemory.ts`, `src/agent/contextLoader.ts`, `src/agent/systemPrompt.ts`, l'outil `memory` et l'interface `/memory`.

**Travaux :**

- Ajouter la provenance, la justification, les fichiers ou symboles concernés, le statut de confirmation et la dernière vérification.
- Distinguer une instruction explicite d'une déduction du modèle ou d'un simple résultat d'outil.
- Gérer les contradictions par remplacement ou précision de l'ancienne note, en conservant une trace compréhensible du changement.
- Sélectionner les souvenirs selon la demande, les fichiers visés et les contraintes applicables.
- Commencer avec les chemins, symboles et mots-clés ; évaluer une recherche sémantique seulement si les mesures montrent des lacunes.
- Préserver les fonctions de consultation, correction et suppression par l'utilisateur.
- Empêcher la promotion automatique d'instructions issues d'un fichier ou d'une page externe en préférences utilisateur.
- Faire évoluer le format avec compatibilité pour les notes déjà présentes.

**Exemple :** une contrainte sur le format de retour d'une fonction est reliée à la fonction, à ses consommateurs et à la raison donnée par l'utilisateur. Lors d'une prochaine modification, l'agent la retrouve puis vérifie sa validité dans le code actuel.

**Validation :** une correction est réutilisée dans une nouvelle session pertinente, n'affecte pas un projet sans rapport et cesse d'agir après remplacement. Comparer mémoire désactivée, mémoire actuelle et mémoire sélectionnée.

### Lot 5 — Compréhension du dépôt et qualité des outils

**Objectif :** mieux identifier les dépendances et rendre les résultats techniques exploitables.

**Base existante :** `src/utils/fileIndex.ts`, `src/tools/search.ts`, `src/tools/fileOps.ts`, `src/tools/registry.ts` et `src/tools/fileTracker.ts`.

**Travaux :**

- Construire une carte compacte des modules, exports, imports et tests associés.
- Pour TypeScript, expérimenter une extraction à partir du compilateur déjà utilisé par le projet.
- Conserver la recherche textuelle et un fonctionnement de repli pour les langages non indexés.
- Mettre à jour les informations après modification afin de ne pas présenter une carte périmée.
- Structurer les résultats d'outils : statut, code de sortie, diagnostics, fichiers affectés, troncature et référence vers le résultat complet.
- Améliorer les erreurs de paramètres et d'édition afin qu'elles indiquent une prochaine action utile.
- Charger sélectivement les outils spécialisés lorsque leur nombre devient une source mesurée de confusion.
- Vérifier la couverture des protections de fichier dans les sous-agents et les autres chemins d'écriture.

**Validation :** meilleure réussite sur les changements multifichiers et meilleure identification des tests pertinents. Comparer chaque nouvel outil avec les primitives existantes avant de le généraliser.

Les recommandations de conception d'outils insistent sur des interfaces distinctes, des réponses pertinentes et des erreurs permettant de corriger l'action. [Source : Anthropic, conception des outils](https://www.anthropic.com/engineering/writing-tools-for-agents).

### Lot 6 — Profil qualité et revue indépendante

**Objectif :** consacrer davantage de raisonnement et de vérification aux tâches qui en bénéficient.

**Base existante :** `src/agent/thinking.ts`, `src/agent/models.ts`, `src/agent/subagents.ts` et `src/agent/subagent.ts`.

**Travaux :**

- Comparer plusieurs modèles réellement accessibles et niveaux de raisonnement sur le corpus identique du lot 1.
- Choisir le meilleur résultat observé pour le profil qualité, avec réglages enregistrés et possibilité de revenir à une configuration antérieure.
- Créer un rôle de revue en contexte distinct, recevant la demande, les contraintes, le diff et les résultats des vérifications.
- Demander des défauts précis, justifiés par le code ou une reproduction : cas limite, dépendance cassée, test insuffisant, modification hors périmètre.
- Calibrer la revue sur des changements avec défauts connus et des changements corrects pour mesurer également les faux signalements.
- Expérimenter plusieurs solutions dans des espaces isolés pour les problèmes difficiles ; choisir selon les contrôles et la qualité du changement.
- Borner les cycles de revue et contrôler leur effet sur la complexité du code.

**Validation :** hausse de la réussite sur les tâches difficiles et détection de défauts réels, sans hausse importante des faux signalements ou du travail inutile. L'accord de deux modèles ne constitue pas, à lui seul, une preuve de correction.

Les sous-agents ne doivent pas être multipliés systématiquement : certaines tâches de programmation sont fortement dépendantes et se prêtent mal à une division parallèle. [Source : retour d'expérience multi-agent d'Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system).

### Lot 7 — Reprise, progrès et efficacité d'exécution

**Objectif :** permettre un effort soutenu sans boucles improductives ni reprise incohérente.

**Base existante :** `src/agent/retry.ts`, `src/agent/loop.ts`, `src/session/store.ts`, `src/checkpoint/manager.ts` et les tâches d'arrière-plan.

**Travaux :**

- Détecter une répétition par l'action, ses arguments, son résultat et l'état pertinent du projet.
- Distinguer l'absence de progrès d'une attente légitime ou d'une répétition justifiée par un changement.
- Déclencher une nouvelle hypothèse ou une recherche ciblée avant de poursuivre une boucle identique.
- Journaliser suffisamment les actions pour distinguer demandé, démarré, terminé et résultat incertain après interruption.
- Avant de rejouer une opération ayant des effets, vérifier son état réel.
- Mesurer les durées et la consommation complète, y compris les appels auxiliaires.
- Stabiliser les portions de contexte réutilisées et mesurer le cache implicite Gemini ; n'ajouter un cache explicite que si les usages le justifient.

Le cache implicite de Gemini est automatique sur les modèles documentés, mais ses économies ne sont pas garanties pour chaque requête. Un cache explicite a également un coût de stockage et une durée de vie à prendre en compte. [Source : cache Gemini](https://ai.google.dev/gemini-api/docs/generate-content/caching).

**Validation :** pas de modification dupliquée dans les scénarios de reprise, détection correcte des boucles sans progression et consommation attribuée à chaque type d'appel.

## 5. Ordre de livraison

| Livraison | Lots | Dépendance et condition de passage |
|---|---|---|
| A — Mesure | Lot 1 | Résultats de référence fiables et traces exploitables |
| B — Fiabilité du travail | Lots 2 et 3 | Validation de la dernière version et conservation des contraintes après compression |
| C — Connaissance utile | Lots 4 et 5 | Amélioration démontrée sur mémoire entre sessions et changements multifichiers |
| D — Qualité avancée | Lots 6 et 7 | Gain démontré sur les tâches difficiles et reprises, sans régression majeure |

Chaque fonction devrait pouvoir être activée séparément pour identifier sa contribution. Les corrections d'un défaut concret de reprise peuvent naturellement être avancées avant la livraison D si les évaluations le révèlent.

Le choix initial du modèle peut être comparé dès la livraison A ; l'orchestration de revue approfondie vient après la fiabilisation des contrôles.

## 6. Mesures de réussite et validation

| Dimension | Mesure proposée |
|---|---|
| Correction | Réussite des contrôles indépendants sur l'état final |
| Régularité | Résultats sur plusieurs exécutions de chaque scénario |
| Respect de l'intention | Contraintes suivies, périmètre respecté, absence de modification injustifiée |
| Vérification | Conclusions de réussite appuyées par des contrôles valides sur la dernière version |
| Mémoire | Réutilisation pertinente, absence de contamination entre projets, remplacement des notes obsolètes |
| Longues tâches | Contraintes et erreurs conservées après compression, reprise sans répétition des effets |
| Revue | Défauts réels détectés et faux signalements |
| Effort utilisateur | Corrections et interventions nécessaires pour obtenir le résultat accepté |
| Ressources | Temps complet, appels d'outils et tokens de tous les appels |

Les seuils chiffrés doivent être fixés après la mesure initiale. Ce rapport ne promet aucun pourcentage d'amélioration.

Pour chaque livraison : tests ciblés, `npm run typecheck`, `npm test` et `npm run build`. Les changements TUI doivent conserver les contrôles de terminal et des captures adaptées, notamment pour les permissions et le redimensionnement. Les scénarios avec modèles réels restent distincts des tests ordinaires sans clé API.

## 7. Ce que je différerais

- Un fine-tuning avant d'avoir un corpus de trajectoires réussies, une cible précise et des évaluations indépendantes.
- Une base vectorielle avant d'avoir mesuré les limites de la recherche par chemins, symboles et mots-clés.
- Une multiplication automatique des agents sans preuve d'amélioration.
- Des boucles de réflexion supplémentaires sans observations externes ou contrôles exploitables.
- Une migration générale de fournisseur avant d'avoir comparé les modèles accessibles dans un protocole commun.

## 8. Cadre de comparaison avec les deux autres agents

Ce document constitue la contribution indépendante de Codex. Il ne contient pas encore de classement ni de synthèse des deux autres rapports.

La comparaison devra s'appuyer sur les documents complets, en conservant leur attribution et en vérifiant les propositions dans le dépôt actuel.

| Critère | Question à examiner pour chaque proposition |
|---|---|
| Adéquation au besoin | Améliore-t-elle la qualité du résultat selon la priorité de l'utilisateur ? |
| Connaissance de Fuller | Reconnaît-elle les fonctions déjà présentes et les limites exactes du code ? |
| Solidité des sources | Les affirmations sont-elles soutenues par des sources primaires pertinentes ? |
| Niveau de preuve | S'agit-il d'un constat, d'un risque déduit, d'une hypothèse ou d'un résultat mesuré ? |
| Faisabilité | Les modules, dépendances et changements nécessaires sont-ils identifiés ? |
| Mesurabilité | Quels scénarios permettraient de confirmer ou de rejeter le bénéfice ? |
| Effets secondaires | Quels risques de régression, perte de contexte, faux souvenir ou complexité supplémentaire ? |
| Priorité | La proposition doit-elle être immédiate, expérimentale ou différée ? |

La synthèse comparative devra distinguer : convergences, propositions complémentaires, divergences à arbitrer et recommandations déjà couvertes par le code. Une divergence empirique devrait devenir une expérience comparative, avec les mêmes tâches et des paramètres documentés.

**Décision proposée par Codex : commencer par la livraison A, puis B.** Cela donne les moyens de comprendre les échecs et de traiter les conclusions prématurées ainsi que la perte d'informations essentielles avant d'ajouter davantage d'orchestration.
