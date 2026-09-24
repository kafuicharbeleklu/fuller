# Note — Accès à Gemma avec les clés API de Fuller

**Auteur :** Codex · **Vérification documentaire :** 24 septembre 2026.

## Réponse

**Oui, en principe : nos clés Gemini API issues de Google AI Studio sont le type de clés utilisé pour accéder à Gemma hébergé par Google.** Il n'est pas nécessaire de créer une clé spécifique « Gemma ».

Google documente deux modèles Gemma 4 sur cette API :

- `gemma-4-31b-it`
- `gemma-4-26b-a4b-it`

Le guide utilise `@google/genai` et `generateContent`, déjà employés dans Fuller. Il documente aussi les instructions système, les conversations et les appels de fonctions. Pour le raisonnement, `high` active le mode thinking et `minimal` le désactive. [Source officielle : Gemma sur la Gemini API](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api).

## Limite de cette vérification

Cette note confirme la possibilité documentée, **pas l'accès effectif de chacune de nos clés** : aucun secret n'a été lu et aucune requête authentifiée n'a été exécutée pendant cette recherche. Les droits, restrictions, quotas disponibles et conditions tarifaires de nos projets restent à vérifier.

Les quotas s'appliquent par projet, et varient selon le modèle et le niveau d'utilisation. Plusieurs clés rattachées au même projet ne multiplient donc pas ses quotas. [Source officielle : limites de la Gemini API](https://ai.google.dev/gemini-api/docs/rate-limits).

## Conséquences pour Fuller

Constats dans le code actuel :

- `src/agent/models.ts:54` accepte déjà les identifiants commençant par `gemma` si le catalogue indique `generateContent`.
- La sélection recommandée filtre les modèles considérés gratuits dans une liste locale. Gemma n'y figure pas actuellement : son absence de la liste recommandée ne prouve pas une absence d'accès. Utiliser la liste complète pour vérifier sa présence.
- `src/agent/thinking.ts` ne définit pas encore les réglages Gemma. Le réglage explicite `high`/`minimal` serait à intégrer et tester.
- La boucle envoie des outils : il faudra vérifier un cycle complet appel de fonction → résultat → réponse, et pas seulement une réponse textuelle.

## Vérification pratique proposée

1. Actualiser le catalogue avec une clé configurée, sans afficher la clé ; le cache actuel du catalogue est global, donc un résultat mis en cache ne prouve pas l'accès de cette clé.
2. Effectuer une génération minimale sur chacun des deux identifiants pour confirmer l'accès réel.
3. Tester les instructions système, le streaming et un outil de lecture avant de qualifier l'intégration Fuller de compatible.
4. Contrôler les quotas et tarifs applicables dans AI Studio.

**Conclusion : l'accès via nos clés Gemini est une piste directement compatible avec notre fournisseur actuel ; la disponibilité pour nos projets et l'intégration complète restent à valider par un essai authentifié.** Aucun changement de modèle ou de configuration n'a été effectué.
