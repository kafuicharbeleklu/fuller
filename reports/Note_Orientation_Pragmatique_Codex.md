# Fuller — orientation pragmatique pour les autres agents

Auteur : Codex. Date : 25 septembre 2026.

Pour Claude, Antigravity et les autres agents. Rédigé à la demande de l'utilisateur, après son rappel de l'objectif du projet. HEAD constaté : `6f78c5d`.

**Statut : demande utilisateur retranscrite et recommandation de Codex. Aucune migration approuvée ou réalisée ; aucun comparatif de moteurs exécuté.**

Actualisation du 25 septembre à 11:04 UTC : après lecture des nouvelles réalisations et mesures rapportées par Claude, ma priorité immédiate devient l'usage réel de Fuller ; le comparatif des moteurs passe au second plan. Voir [C001 dans le dossier d'échange `chat/`](../chat/2026-09-25_110412_codex_orientation.md). Le texte ci-dessous conserve la proposition antérieure pour en rendre l'évolution explicite.

## 1. Ce que l'utilisateur demande réellement

Construire Fuller, un agent de terminal avec une TUI/TUX proche de Claude Code, puis améliorer sa capacité à accomplir le travail : efficacité, raisonnement et réutilisation des corrections de l'utilisateur.

L'utilisateur rapporte plus d'un mois de difficultés avec son ancienne réalisation Python/Rich, puis des progrès beaucoup plus rapides en trois jours avec TypeScript/React/Ink. Il demande aux agents de signaler une mauvaise direction technique et de proposer une voie plus pratique, sans entretenir une succession interminable de correctifs.

- Conserver ce qui fonctionne : la TUI TypeScript/React/Ink. Ne pas repartir de zéro.
- Distinguer « possible techniquement » de « adapté à notre objectif et à nos ressources ».
- La priorité reste la qualité maximale, même si l'agent répond plus lentement. Cela ne justifie pas un développement indéfiniment plus complexe.
- L'expérience de ce projet n'établit pas une incapacité générale de Python à construire des agents ou des interfaces terminal.
- Les corrections de sécurité et de fiabilité restent nécessaires, mais leur succession ne constitue pas, à elle seule, une stratégie d'amélioration du raisonnement.

## 2. Changement d'ordre recommandé par Codex

Avant d'ajouter de nouveaux mécanismes maison, comparer le moteur actuel de Fuller à un moteur existant. Avancer également la comparaison des modèles, aujourd'hui placée après plusieurs lots d'optimisation.

Le point à examiner est le coût de développement et de maintenance de notre propre boucle d'agent, pas le remplacement de React. Un bon résultat aux tests logiciels ne démontre pas un meilleur taux de réussite sur les tâches de l'utilisateur.

Deux possibilités documentées :

- **Premier candidat : Gemini CLI piloté via ACP**, cohérent avec l'intégration Gemini actuelle. ACP permet à une application cliente de piloter l'agent et ses sessions. Réutiliser ce moteur n'est pas la même chose qu'appeler directement l'API du modèle. Voir la [documentation ACP de Gemini CLI](https://geminicli.com/docs/cli/acp-mode/) et son [authentification par clé Gemini](https://geminicli.com/docs/get-started/authentication/).
- **Alternative si le fournisseur peut changer : Claude Agent SDK**, qui expose les outils, la boucle d'agent et la gestion du contexte de Claude Code à une application TypeScript. Vérifier l'accès API, les coûts, les conditions et l'identité visuelle autorisée avant de retenir cette option. Voir la [documentation officielle](https://code.claude.com/docs/en/agent-sdk/overview).

Ce sont des candidats, pas des preuves de supériorité dans Fuller. Leurs fonctionnalités ne garantissent ni une intégration immédiate ni la conservation de toutes les fonctions de Fuller. Ne pas remplacer le backend, importer massivement des interfaces internes ou créer un framework multi-moteurs avant un essai limité.

## 3. Prochaine expérience proposée : courte et décisionnelle

Choisir cinq scénarios représentatifs des difficultés réelles de l'utilisateur :

1. Corriger un bug avec une reproduction et un contrôle final.
2. Modifier plusieurs fichiers sans casser les usages existants.
3. Reprendre le travail après interruption sans perdre l'objectif.
4. Réutiliser une préférence validée dans une nouvelle session.
5. Réagir correctement à un test échoué sans annoncer une fausse réussite.

Comparer Fuller et Gemini CLI sur des copies isolées du même état initial, avec les mêmes consignes et contraintes. Utiliser le même modèle quand cela est possible pour commencer par isoler l'effet du moteur. Enregistrer le modèle réellement utilisé et désactiver les replis silencieux ; séparer erreurs d'API/quota et échecs de tâche. Protéger les vérifications contre les modifications de l'agent.

Juger surtout le résultat réel, les régressions, les interventions humaines nécessaires et le respect des permissions. Mesurer aussi durée et tokens, sans les faire passer avant la qualité. Répéter les cas ambigus ; cinq tâches constituent un filtre initial, pas un classement statistiquement robuste. Élargir ensuite avec le banc existant et d'autres échecs réels. Voir les [recommandations d'évaluation d'Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

Décision attendue :

- Si le moteur existant fait nettement mieux : proposer un prototype réversible derrière la TUI Fuller. Vérifier explicitement streaming, permissions, annulation, sessions, diffs et mémoire avant toute migration.
- Si Fuller fait aussi bien : conserver son moteur ; corriger les limites observées plutôt que changer d'architecture par principe.
- Si les deux rencontrent les mêmes difficultés : comparer un autre modèle ou niveau de réflexion avant d'empiler de nouveaux mécanismes.

L'expérience doit produire une décision de maintien ou un prototype borné, pas une nouvelle étude sans fin. Elle nécessite un périmètre et un budget d'appels réels autorisés ; cette note ne les autorise pas.

## 4. Apprentissage et optimisations : rester proportionné

Exploiter d'abord la mémoire et `/learn` déjà présents : conserver une correction validée, avec son contexte utile, puis vérifier sa réutilisation dans une autre session. Cette mémoire influence le contexte ; elle ne réentraîne pas les poids du modèle.

Mettre en attente, faute de besoin démontré sur Fuller : fine-tuning, mémoire vectorielle complexe, chaînes systématiques de plusieurs agents et masquage automatique fondé uniquement sur l'âge des tours. Ce ne sont pas des interdictions universelles : une expérience peut justifier leur adoption plus tard.

Les diagnostics syntaxiques et la réduction du contexte restent des options utiles à tester lorsqu'un échec concret les justifie. Ne pas transformer des gains mesurés dans un autre produit en gains attendus garantis pour Fuller.

## 5. Coordination et état des notes

- Le [rapport pragmatique d'Antigravity](Rapport_Efficacite_Pragmatique_Agent_Antigravity.md) est disponible. Accord sur la simplicité et la mesure ; **pas de consensus établi sur l'ordre des travaux** : son choix « syntaxe puis masquage » diffère de ma recommandation « comparer moteur et modèle d'abord ».
- Ne pas reprendre comme acquis les formulations « exact à 100 % », « zéro tour perdu » ou des pourcentages transférés d'autres agents. Un mécanisme prometteur n'est pas encore un résultat observé sur Fuller.
- Les points de la précédente revue de Codex ont fait l'objet du correctif `f1584bc` : analyseur TypeScript fourni par Fuller, rappel de résultat de test inconnu, reconstruction différée de la conversation. Ne pas les présenter à nouveau comme non corrigés.
- La [passation de Claude](Note_de_passation_Claude.md), sections 11 et 12, annonce désormais la confiance dans le dossier et l'approbation des serveurs MCP. Ces ajouts n'ont pas été audités pendant la rédaction de cette note ; l'ancien constat « aucune confirmation au démarrage » ne doit pas être répété sans vérification actuelle.
- Pour l'orientation future, cette note remplace la recommandation de ma [passation historique](Note_de_passation_Codex.md) de simplement poursuivre les lots contexte/mémoire/outils. Elle ne réécrit pas l'historique des correctifs ni les choix explicites ultérieurs de l'utilisateur.

## 6. Périmètre de cette intervention

Documentation uniquement. Aucun code, réglage, secret ou fournisseur modifié ; aucun appel de génération, installation, nettoyage, commit ou push. Les résultats de tests cités dans d'autres notes appartiennent à leurs vérifications respectives ; aucune suite n'a été relancée pour cette rédaction.
