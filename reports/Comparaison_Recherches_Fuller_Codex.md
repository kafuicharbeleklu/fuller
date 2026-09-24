# Comparaison des trois recherches sur Fuller — Codex

Auteur : Codex. Date : 24 septembre 2026.

Priorité retenue : qualité maximale, même avec davantage de temps de calcul.

État du dépôt examiné : `e1481fe`. Comparaison documentaire, lecture du code et vérification ciblée des sources officielles ; aucun changement fonctionnel, aucune clé consultée et aucun appel de génération lancé pour cette comparaison.

## 1. Verdict

Je recommande une synthèse des trois recherches, et non l'application intégrale d'un seul rapport :

- Le **plan technique non signé** apporte les corrections immédiates les plus précises pour l'intégration Gemini.
- Mon **rapport Codex** apporte le cadre de mesure, la vérification du travail terminé et la gestion durable des expériences.
- Le **rapport Antigravity** apporte notamment une proposition concrète d'outil de lecture structurelle du code et un contrôle syntaxique rapide.

Deux corrections importantes : Fuller possède déjà une mémoire apprise, et plusieurs propositions concernant Gemma sont maintenant implémentées. Certains gains chiffrés annoncés sont soit non sourcés, soit mesurés dans des environnements différents : aucun n'est une prévision fiable du gain de Fuller.

Le code autour du modèle peut améliorer les résultats de l'agent : meilleures informations, meilleurs outils, moins d'oublis, tests et corrections. Cela ne modifie pas les poids du modèle et ne démontre pas une équivalence générale avec un modèle plus puissant. Une mémoire de corrections est un apprentissage au niveau de l'application, pas un réentraînement automatique du modèle.

## 2. Documents comparés et méthode

| Repère | Document | Attribution |
|---|---|---|
| C | [Rapport_Optimisation_Fuller_Codex.md](Rapport_Optimisation_Fuller_Codex.md) | Mon rapport initial |
| A | [Rapport_Optimisation_Fuller_Antigravity.md](Rapport_Optimisation_Fuller_Antigravity.md) | Signé Antigravity |
| T | [plan-efficacite-agent.md](plan-efficacite-agent.md) | Auteur non indiqué ; considéré ici comme le troisième rapport |

Documents complémentaires : [note Gemma de l'autre recherche](../research_notes/gemma-via-api-gemini.md) et [ma note initiale sur l'accès à Gemma](Note_Acces_Gemma_API_Codex.md).

La note de l'autre recherche décrit des tests API réels. Je les attribue à son auteur : je ne les ai pas reproduits. Les originaux sont conservés ; la présente comparaison précise ce qui est encore applicable au code actuel.

Niveaux de preuve employés :

- **Confirmé dans le code** : présence ou absence vérifiée dans les chemins cités ; ce n'est pas une validation en conditions réelles.
- **Documenté par le fournisseur** : capacité ou recommandation retrouvée sur une source officielle.
- **Expérimental** : piste raisonnable dont l'effet sur Fuller reste à mesurer.
- **Non établi** : chiffre ou conclusion insuffisamment étayé pour décider.

## 3. Forces et limites de chaque rapport

| Rapport | Apport principal | Limite à corriger | Usage recommandé |
|---|---|---|---|
| C — Codex | Évaluations indépendantes, critères de réussite, mémoire avec provenance, contexte durable, revue calibrée | Plan large ; j'avais insuffisamment détaillé la température et les fins de génération Gemini. Certaines vérifications sont désormais couvertes dans le code | Cadre qualité et mesure du résultat |
| A — Antigravity | `outline_file`, carte du dépôt, contrôle syntaxique rapide, séparation des rôles | Diagnostic mémoire dépassé ; pourcentages sans références ; promesse de validité logique excessive ; choix de modèles économiques peu adapté à la priorité qualité | Catalogue d'outils à expérimenter, après correction du diagnostic |
| T — Plan technique | Température, `finishReason`, cache, logs récupérables, signatures ; étapes concrètes et liens vers les sources | Plusieurs seuils arbitraires ; édition floue risquée ; chiffres externes non transférables ; disponibilité et capacités intellectuelles parfois mélangées | Première liste de corrections techniques, avec garde-fous |

Je retiens donc davantage T pour le premier lot de modifications, C pour la façon de les valider, et A pour enrichir les outils. Ce jugement porte sur ces documents et cet état du dépôt, pas sur les capacités générales de leurs auteurs.

## 4. Arbitrage vérifié dans Fuller

### 4.1 Mémoire : améliorer l'existant, ne pas le reconstruire

Antigravity décrit une mémoire limitée à des fichiers statiques et propose `save_memory`. Ce diagnostic ne correspond plus à l'état examiné :

- `src/agent/autoMemory.ts:72` enregistre déjà des notes, avec portée, type, date, déduplication et filtre heuristique de secrets.
- `src/agent/autoMemory.ts:102` encourage déjà la mémorisation des corrections, préférences et faits utiles.
- `src/tools/registry.ts:439` branche cette fonction sur l'outil `memory`.
- `src/agent/systemPrompt.ts:72` injecte cette mémoire.

**Décision :** conserver le stockage existant. Ajouter progressivement la provenance, les liens vers fichiers/symboles, le remplacement des notes contradictoires et une sélection pertinente plutôt que l'injection de toutes les notes. Une commande `/learn` serait un raccourci d'interface facultatif, pas une nouvelle intelligence à construire.

Le filtre actuel ne constitue pas une garantie exhaustive contre les secrets. Les souvenirs doivent rester inspectables, modifiables et supprimables ; un texte provenant d'un fichier ou d'un outil ne doit pas devenir automatiquement une instruction durable.

### 4.2 Température : le plan technique relève un point réel

`src/agent/gemini.ts:154` impose `temperature: 0.2` ; `gemini.ts:323` impose `0.1` au résumé.

Google recommande de ne plus modifier les paramètres d'échantillonnage de Gemini 3.x et de retirer ces réglages des requêtes. **Je retiens cette correction en priorité pour Gemini 3.x**, avec des tests du constructeur de requêtes et une comparaison avant/après. Ce n'est pas une preuve que toutes les boucles actuelles viennent de la température, ni une règle à transposer sans examen à Gemma ou à toute autre famille. [Documentation Google sur les paramètres Gemini 3.x](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5).

C'est une omission importante de mon rapport initial.

### 4.3 Fins de génération : traiter la cause, pas seulement relancer

`src/agent/gemini.ts:254` traite texte, appels d'outils et consommation, sans exploiter `finishReason`.

Le plan T a raison de le relever. La documentation distingue notamment arrêt normal, limite de sortie, blocage de sécurité et appel de fonction mal formé. Il faut conserver cette information jusque dans la boucle et les traces. [Référence GenerateContent](https://ai.google.dev/api/generate-content).

**Décision :** gérer séparément réponse vide, troncature, appel mal formé et refus. Prévoir une récupération limitée pour les erreurs récupérables, sans rejouer aveuglément les outils déjà exécutés ni contourner un refus. Une réponse vide ne prouve pas à elle seule une erreur transitoire.

L'association des réponses aux appels est également importante. Le code transmet déjà les identifiants dans `gemini.ts:243` et `loop.ts:764` : préserver cela et tester les appels multiples, interruptions et reprises, plutôt que présenter cette association comme absente.

### 4.4 Cache et sorties longues : deux sujets distincts

Le préfixe du prompt inclut l'environnement avant les règles stables (`src/agent/systemPrompt.ts:32`). La consommation de tokens en cache n'est pas enregistrée dans `gemini.ts:286`.

**Décision :** stabiliser les parties réellement réutilisables et mesurer `cachedContentTokenCount`. Ne pas injecter un état Git changeant au sommet du préfixe que l'on cherche à réutiliser.

Les réductions de 75 % ou 90 % citées dans les rapports ne sont pas des réductions garanties de la facture totale. Le cache implicite dépend des correspondances, ses seuils varient selon le modèle, et le cache explicite a notamment un coût de stockage. [Documentation du cache Gemini](https://ai.google.dev/gemini-api/docs/generate-content/caching).

Pour les logs, **l'enregistrement sur disque existe déjà** : `loop.ts:884` fournit un chemin et `registry.ts:325` retourne `outputFile`. En revanche, dans le chemin de commande au premier plan examiné, `loop.ts:968` renvoie au modèle `out.output`, sans lui ajouter ce chemin ; le texte peut être tronqué par `registry.ts:320`.

Le changement utile est donc d'exposer une référence récupérable au modèle lorsque la sortie est tronquée, avec bornes de lecture et permissions appropriées, pas de recréer tout le stockage des logs.

### 4.5 Compaction : accord sur le problème, pas sur un seuil magique

Les trois rapports recommandent de mieux gérer le contexte. La configuration utilise un seuil de 85 % (`src/config.ts:246`), appliqué à la fenêtre suivie par la session (`loop.ts:1370`). Il serait inexact de parler systématiquement d'un million de tokens : la fenêtre dépend du modèle et de sa configuration.

Le résumé est produit à partir d'une représentation qui coupe notamment chaque résultat d'outil à 600 caractères (`gemini.ts:414`). Risque : perte d'une erreur ou d'une contrainte située après cette coupure ; ce risque n'a pas été reproduit par un nouveau test ici.

**Décision :** état structuré de tâche, références vers les observations complètes, et conservation des erreurs non résolues, contraintes et preuves de validation. Évaluer ensuite le masquage sélectif et plusieurs seuils.

Les seuils « après trois échanges », « garder 50 000 tokens » et « compacter à 50 % » sont des hypothèses d'expérience, pas des constantes universelles. Le +29 % publié par Anthropic concerne une évaluation interne de recherche agentique ; le −84 % concerne la consommation de tokens d'un scénario de recherche web de 100 tours. Ces chiffres ne mesurent pas Fuller. [Publication Anthropic sur la gestion du contexte](https://claude.com/blog/context-management).

Les transformations d'historique doivent aussi préserver les paires appel/réponse et les signatures requises. Réduire le contexte ne doit pas casser le protocole du fournisseur.

### 4.6 Édition : ne pas échanger une erreur visible contre une corruption discrète

`src/tools/fileOps.ts:140` exige une correspondance exacte et refuse les cibles absentes ou ambiguës. Le plan T propose une cascade jusqu'à une correspondance floue et une correction par modèle léger.

**Décision :** commencer par des diagnostics plus utiles : endroits candidats, extrait à relire et demande d'une cible unique. Une normalisation limitée peut être expérimentée si elle conserve le sens et l'unicité. Ne pas autoriser par défaut une modification approximative de « 10 % » : espaces et indentation peuvent être significatifs, et deux fonctions voisines peuvent beaucoup se ressembler.

Toute édition tolérante doit préserver la protection contre les fichiers devenus obsolètes depuis leur lecture. La protection `fileTracker` est déjà passée aux outils des sous-agents (`src/agent/subagent.ts:62` et `:122`) : actualisation de mon rapport initial, qui en demandait la vérification.

Les pages des PR Gemini CLI #6823 et #19574 n'ont pas pu être relues avec l'outil web pendant cette comparaison. Les chiffres « 20 % vers 6 % » et « −10 % de tours » restent des résultats rapportés par T, non revalidés ici, et certainement pas mesurés sur Fuller.

### 4.7 Syntaxe et vérification : conserver les deux niveaux

Le contrôle syntaxique proposé par A et T est utile, mais ne garantit ni la validité des imports, ni les types, ni la logique métier. Construire un AST ne suffit pas : il faut exploiter ses diagnostics.

**Décision :**

1. Analyser le contenu candidat avant écriture lorsque c'est possible.
2. Comparer les diagnostics avant/après pour ne pas attribuer à l'agent les erreurs déjà présentes.
3. Tenir compte des modifications multifichiers temporairement incohérentes.
4. Vérifier ensuite le comportement avec les tests pertinents.

Éviter un rollback automatique susceptible d'effacer une modification concurrente de l'utilisateur.

La consigne de tester existe déjà (`src/agent/systemPrompt.ts:43`). La renforcer dans le prompt ne remplace pas un suivi en code : quels critères ont été vérifiés, avec quelle commande, sur quelle version des fichiers ? Une nouvelle modification doit rendre caduques les preuves affectées.

La règle « la validation est la seule fin possible » doit autoriser une conclusion honnête en cas de blocage, de tests indisponibles ou de demande purement analytique. Elle ne doit pas créer une boucle infinie.

### 4.8 Lecture structurelle du dépôt : bonne proposition, bénéfice à mesurer

Je retiens `outline_file` et une carte compacte du dépôt, présents sous des formes complémentaires dans A et C. L'outil devrait retourner symboles, signatures et positions, puis permettre une lecture ciblée.

Commencer par les langages réellement utiles et un budget ajustable ; invalider les résultats après modification du fichier. Une carte doit permettre de retrouver le code, pas se substituer à sa lecture.

Le gain « lecture divisée par cinq » annoncé par A n'est pas étayé dans son document. Le critère décisif sera la réussite des modifications multifichiers, puis le nombre de lectures et de tokens.

### 4.9 Relecteur et modèles : priorité à la qualité mesurée

Les trois rapports proposent une forme de spécialisation. Je ne retiens pas un circuit obligatoire architecte → éditeur → vérificateur pour chaque tâche, ni le choix du vérificateur parce qu'il est le moins cher.

Pour les changements risqués, expérimenter un relecteur indépendant disposant de la demande, du diff, des fichiers utiles et des résultats de tests. Il doit chercher des défauts précis et citer ses preuves, sans pouvoir modifier simultanément les mêmes fichiers. Limiter le nombre de cycles et départager les désaccords par des contrôles.

Avec la priorité qualité, j'avance cette expérience par rapport à mon calendrier initial et à l'étape 3 de T. Elle reste à comparer à l'agent seul ; davantage d'agents n'est pas automatiquement meilleur.

### 4.10 Gemma : intégration déjà présente, classement de qualité non établi

Google documente Gemma via l'API Gemini, notamment les appels de fonctions et les niveaux de réflexion `high`/`minimal`. [Documentation officielle Gemma sur Gemini API](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api).

Au commit examiné :

- `src/agent/models.ts:49` inclut Gemma 4 dans la sélection recommandée.
- `src/agent/thinking.ts:15` et `:24` gèrent ses niveaux et le défaut `high`.
- `src/agent/gemini.ts:196` gère le repli ; `:356` définit Gemma 26B comme cible par défaut.
- `src/agent/gemini.ts:373` adapte l'historique entre familles.

Ces fonctions ne sont plus des travaux à démarrer. Mes réserves antérieures sur le sélecteur et la prise en charge de l'effort doivent être lues comme un état antérieur.

La note complémentaire rapporte des générations et appels d'outils réussis avec une clé. Cela soutient un accès effectif lors de ces essais, mais ne démontre ni l'accès de toutes les clés, ni la robustesse de longues tâches de programmation. Une différence de catalogue entre deux clés n'isole pas la cause « format de clé » de la cause « projet ».

L'affirmation « Gemma nettement moins capable que Gemini 3.6 Flash » n'est pas établie par les tests simples consignés dans cette note. Inversement, rien dans les trois rapports ne prouve qu'un Fuller équipé de Gemma égale généralement un modèle de premier plan.

**Décision qualité :** comparer les modèles sur les mêmes tâches, tracer tout changement de modèle, et ne pas confondre reprise de disponibilité et résultat validé. Le marqueur de secours des signatures ne reconstitue pas l'information de raisonnement précédemment perdue.

### 4.11 Clés et quotas : sujet opérationnel séparé

Le plan T a raison de distinguer les quotas par projet des clés individuelles. Google le précise dans sa [documentation des limites](https://ai.google.dev/gemini-api/docs/rate-limits).

La documentation annonce également la transition vers les clés d'autorisation et le refus des clés standard en septembre 2026. C'est un point de continuité à vérifier dans le projet concerné, pas une preuve de l'état actuel de chacune de nos clés. [Documentation des clés Gemini](https://ai.google.dev/gemini-api/docs/api-key).

En revanche, je ne généraliserais pas un diagnostic de forum en « tout 403 vient du compte », ni l'activation de facturation en solution garantie. Ne pas modifier les clés ou activer une offre payante dans le cadre de cette comparaison.

## 5. Feuille de route consolidée — qualité maximale

| Lot | Travail retenu | Origine | Condition de validation |
|---|---|---|---|
| 0 — Référence fiable | Renforcer le banc existant, préserver les traces, isoler les contrôles finaux et distinguer modèle demandé/modèle réellement utilisé | C + T | Évaluateurs testés sur solutions correctes et incorrectes ; résultats reproductibles et correctement attribués |
| 1 — Intégration robuste | Réglages adaptés à Gemini 3.x, traitement des fins de génération, logs récupérables, statistiques du cache ; tests de signatures et de reprise | T, complété par les constats actuels | Tests simulés des erreurs, aucun rejeu d'effet de bord, comparaison avant/après |
| 2 — Travail réellement vérifié | État de tâche, critères et preuves liés à la version finale ; détection de non-progrès ; essai de revue indépendante sur tâches risquées | C + T + A | Moins de faux succès et de répétitions improductives, sans bloquer les analyses ni ignorer un arrêt utilisateur |
| 3 — Contexte et expériences | Masquage récupérable, résumé structuré, mémoire pertinente avec provenance et remplacement des notes obsolètes | C + A + T | Contraintes conservées après compaction et corrections réutilisées dans une nouvelle session pertinente |
| 4 — Outils plus précis | Syntaxe différentielle, `outline_file`, carte du dépôt, retours d'édition enrichis ; tolérance très limitée seulement si sûre | A + C + T | Gain sur changements multifichiers, aucune augmentation des mauvaises cibles modifiées |
| 5 — Optimisation avancée | Comparaison des modèles et efforts, revue étendue si utile, essais de plusieurs solutions en environnements séparés | C + A + T | Gain net sur tâches difficiles au regard des erreurs, du temps et des ressources supplémentaires |

Le lot 0 commence par l'instrumentation minimale nécessaire, pas par un vaste chantier bloquant. Une correction de protocole reproductible peut avancer avec son test ciblé. Chaque amélioration doit pouvoir être évaluée séparément.

Le routage vers le modèle le moins cher, l'hébergement local et le fine-tuning sont différés : ils ne répondent pas en premier à la priorité qualité exprimée.

## 6. Comment départager les propositions par des résultats

Le banc contient actuellement huit scénarios. `scripts/eval.mjs:75` lance les contrôles dans le dépôt de travail modifiable ; `:113` supprime ensuite le répertoire temporaire. Il faut protéger les vérifications finales et conserver les éléments utiles au diagnostic des échecs.

Autre point important avec le repli désormais disponible : la synthèse d'évaluation est étiquetée par le modèle demandé (`scripts/eval.mjs:123`). Pour comparer deux modèles, désactiver le repli ou enregistrer explicitement la trajectoire des modèles utilisés ; sinon un résultat pourrait être attribué à la mauvaise configuration.

Protocole proposé :

1. Étendre progressivement le corpus avec de vrais échecs : modification multifichier, contrainte ancienne, reprise interrompue, correction mémorisée, édition ambiguë, sortie tronquée, et demande d'analyse sans écriture.
2. Comparer la version actuelle à une seule modification activée à la fois, sur les mêmes tâches et réglages.
3. Commencer par trois essais par tâche ; augmenter les répétitions si les résultats sont instables. Trois essais ne suffisent pas à eux seuls à démontrer une petite différence.
4. Séparer les tâches utilisées pour développer les améliorations de celles réservées au verdict final.
5. Mesurer en premier réussite des contrôles indépendants, régressions et faux succès ; ensuite régularité, tours, temps et consommation de tous les appels.
6. Rapporter séparément erreurs API/environnement et échecs de résolution, ainsi que le taux de réussite de bout en bout : exclure les pannes du score de raisonnement ne doit pas cacher les interruptions vécues par l'utilisateur.

Une amélioration est retenue si les preuves montrent un bénéfice pertinent sans régression critique observée ; les limites du corpus restent explicites. Aucun des trois rapports ne fournit aujourd'hui une mesure avant/après de ces lots sur Fuller.

Pour une future implémentation : tests ciblés, `npm run typecheck`, `npm test`, `npm run build` et contrôles PTY si l'interface change. Ces commandes n'ont pas été exécutées pour cette comparaison documentaire.

## 7. Ce que je change dans ma recommandation initiale

- J'intègre en tête les points Gemini que T a mieux identifiés : température, fins de génération et retour des références de logs.
- Je conserve ma priorité sur l'évaluation fiable et les preuves de réussite, au lieu de retenir des pourcentages de gain non mesurés.
- Je reprends le contrôle syntaxique et `outline_file` d'A, sans leurs promesses de validité logique ou de gain chiffré.
- Je ne propose plus comme nouveaux travaux la mémoire de base, le branchement du suivi de fichiers dans les sous-agents ou l'intégration Gemma déjà présents.
- J'avance l'essai du relecteur sur les tâches difficiles et je garde les optimisations de coût en second plan.

**Conclusion :** le premier chantier recommandé est un lot court « mesure fiable + intégration Gemini robuste », suivi de « vérification du résultat + contexte et mémoire utiles ». C'est une recommandation issue des trois recherches et du code actuel, pas encore une performance démontrée. Aucun correctif fonctionnel n'a été appliqué dans ce travail.
