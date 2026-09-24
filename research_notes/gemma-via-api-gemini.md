# Gemma avec nos clés API Gemini — note du 24/09/2026

**Réponse : oui.** Nos clés (y compris le nouveau format `AQ.…`) donnent accès aux modèles Gemma 4 via l'API Gemini, avec le même SDK et le même point d'accès que Gemini. Fuller fonctionne déjà avec eux : `fuller --model gemma-4-26b-a4b-it`.

## Ce que nous avons vérifié nous-mêmes

Tests faits avec la clé 4 (une clé qui fonctionne), sans afficher de clé :

| Vérification | Résultat |
|---|---|
| Modèles Gemma listés par `models.list` | `gemma-4-26b-a4b-it` et `gemma-4-31b-it`, 262 144 tokens d'entrée, `generateContent` et `countTokens` |
| Génération simple (`gemma-4-26b-a4b-it`) | répond « ok » en 2,4 s |
| Appel d'outil avec instruction système (`gemma-4-26b-a4b-it`) | appelle `read_file({"file_path":"package.json"})` correctement, en 1,2 s |
| Même test avec `gemma-4-31b-it` | appel d'outil correct, mais 45 s |
| Fuller en mode `-p` sur `gemma-4-26b-a4b-it` | utilise l'outil Read, répond « fuller-code » ; deux erreurs 500 réessayées et une bascule de clé sur quota en route |

`gemma-4-26b-a4b-it` est un modèle « mixture of experts » (environ 4 milliards de paramètres actifs), d'où sa rapidité. `gemma-4-31b-it` est un modèle dense, plus lent.

## Ce que dit la page officielle de Google DeepMind

Source : [deepmind.google/models/gemma/gemma-4](https://deepmind.google/models/gemma/gemma-4/), lue le 24/09/2026.

- Quatre modèles, tous en variante « IT Thinking » (qui raisonne avant de répondre) : **31B** (dense), **26B A4B** (mixture of experts), **E4B** et **E2B** (petits modèles pour appareils, avec audio et vision en temps réel).
- Appels de fonctions natifs et workflows agentiques (« native support for function calling »), 140 langues, fine-tuning possible.
- Scores publiés :

| Test | 31B | 26B A4B | E4B | E2B |
|---|---|---|---|---|
| LiveCodeBench v6 (code) | 80,0 % | 77,1 % | 52,0 % | 44,0 % |
| AIME 2026 (maths) | 89,2 % | — | — | — |
| MMLU (connaissances) | 85,2 % | — | — | — |

- Disponible sur Google AI Studio, Hugging Face, Kaggle, **Ollama**, **LM Studio**, Docker, JAX, Keras et GKE. Gemma est un modèle ouvert : il peut tourner **en local**, sans clé ni quota.
- La page ne précise ni la taille du contexte, ni la licence, ni les prix.

Sur l'API Gemini, nos clés ne voient que le 31B et le 26B A4B (pas les versions E4B et E2B).

## Réflexion (thinking) sur l'API, testée le 24/09

| Réglage envoyé à `gemma-4-26b-a4b-it` | Résultat |
|---|---|
| Aucun | réfléchit par défaut (261 tokens de réflexion), réponse juste, 7,1 s |
| `thinkingLevel: LOW` | refusé : « Thinking level is not supported for this model » (400) |
| `thinkingLevel: HIGH` + `includeThoughts` | accepté, réponse juste, 3,9 s |
| `thinkingLevel: MINIMAL` | accepté, **0 token de réflexion**, réponse juste, 1,4 s |

Conforme à la documentation officielle : Gemma n'accepte que `high` et `minimal`. Depuis le 24/09, `/effort` propose ces deux niveaux pour Gemma (`high` par défaut, ce que fait Gemma sans réglage). Les tokens de réflexion sont facturés comme de la sortie sur les offres payantes.

## Ce que dit la documentation de l'API

Source : [Run Gemma with the Gemini API](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api), mise à jour le 02/07/2026.

- Modèles : `gemma-4-31b-it` et `gemma-4-26b-a4b-it`, présentés comme « a convenient alternative to setting up your own local instance ».
- Fonctions confirmées : appels de fonctions, instructions système, images, conversation multi-tours, réflexion réglable (`thinking_level` à `high` ou `minimal`), **recherche Google intégrée** (grounding).
- Contexte : « up to 256K context window ».
- Exemples de code en Python, JavaScript et REST.
- La page ne dit **rien du prix ni des limites** : il faut les lire dans AI Studio (page Rate limits) pour chaque projet.

## Ce que disent d'autres sources

- Contexte de 256K et licence Apache 2.0 selon [Philipp Schmid, 07/04/2026](https://www.philschmid.de/gemma-4-gemini-api) (nos clés annoncent 262 144 tokens d'entrée).
- Prix : gratuit via l'API Gemini selon des agrégateurs tiers ([Requesty](https://www.requesty.ai/models/google/gemma-4-31b-it), [freellm.net](https://freellm.net/models/google-gemini/gemma-4-31b-it), [OpenRouter](https://openrouter.ai/google/gemma-4-31b-it:free)). **Non confirmé sur une page officielle de Google.**
- Limites de l'offre gratuite : un résultat de recherche parle de 15 requêtes par minute et 1 million de tokens par jour, **non vérifié** ; les limites sont par projet et visibles dans AI Studio (page Rate limits).
- Sortie maximale : 8K tokens par réponse selon un agrégateur tiers, **non vérifié**.

## Ce qu'il faut savoir avant de l'utiliser dans Fuller

- Gemma est nettement moins capable que Gemini 3.6 Flash sur le code et les tâches agentiques longues : à réserver aux tâches simples, aux sous-agents d'exploration, ou comme modèle de secours quand les quotas Flash sont épuisés.
- Le sélecteur `/model` propose Gemma 4 (26B A4B et 31B) à côté des modèles Gemini récents, et `fuller --model gemma-4-26b-a4b-it` fonctionne aussi.
- **Changer de famille de modèle en cours de conversation** : Gemma refuse (400) un historique qui contient les signatures de réflexion de Gemini. Fuller les retire en passant à Gemma, et ajoute la signature de secours documentée par Google en revenant à Gemini 3. Testé en réel : Gemini lance un appel d'outil, Gemma le termine, Gemini reprend la conversation.
- **Modèle de repli** : quand le modèle courant reste saturé (3 réponses 503 de suite) ou n'a plus de quota sur aucune clé, Fuller passe sur Gemma 4 26B A4B avec un avis. Réglable dans `/config` (Fallback model) ou avec `--fallback-model` (`off` pour désactiver).
- `fuller --list-models --all` interroge l'API avec la clé principale (clé 1, format `AIza`) : le 24/09 elle listait 18 modèles, **sans Gemma**, alors que la clé 4 (format `AQ.`) voit les deux Gemma. La visibilité de Gemma semble donc dépendre du projet ou du type de clé ; à revérifier (le réseau vers Google a coupé pendant la vérification).
- Les quotas restent **par projet** : Gemma ne contourne pas les limites, il a ses propres limites dans chaque projet.

## À faire si l'on veut aller plus loin

0. Option à étudier : faire tourner Gemma **en local** (Ollama ou LM Studio) pour ne plus dépendre des quotas. Cela demanderait à Fuller un second fournisseur de modèles (API compatible OpenAI d'Ollama), en plus de l'API Gemini.

1. Mesurer Gemma sur notre banc d'essai : `node scripts/eval.mjs --model gemma-4-26b-a4b-it`, puis comparer avec Gemini 3.6 Flash (`--compare`), pour choisir entre le 26B et le 31B comme repli.
