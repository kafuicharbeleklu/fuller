# Mise en forme face à Claude Code 2.1.283 (26/09/2026)

Comparaison ligne à ligne, styles compris, des mêmes écrans capturés dans les deux applications à la même taille (100×30 et 100×34), avec `scripts/parity-compare.mjs` : il neutralise le nom, le modèle, la version et le dossier, puis liste les lignes qui diffèrent (`--color` pour les couleurs et attributs). Les captures de Claude Code restent hors du dépôt (historique des prompts, e-mail et organisation du compte dans `/status`) ; celles de Fuller sont dans `captures-283/`.

## Ce que la comparaison a trouvé

- **Les lignes vides des dialogues** : la comparaison du 24/09 retirait les lignes vides des captures avant de comparer, et Fuller avait été aligné sur « aucune ligne vide ». Le composant de dialogue de Claude Code (lu dans le binaire) met une ligne vide entre l'en-tête et le contenu, et une avant l'aide du bas, grise et en italique. `OverlayFrame` suit maintenant cette règle (sauf sous 16 lignes). Espacements internes repris : `/model` (ligne d'effort, ou « ○ Effort not supported for … »), `/theme`, `/permissions`, `/memory`, `/help`, `/status` (deux groupes, ligne « MCP servers »), `/resume` (recherche collée au titre, une ligne vide avant chaque session).
- **La dernière ligne de l'écran** : Fuller laissait une ligne vide sous le pied de page en plein écran. Le cadre prend toute la hauteur ; l'écrivain d'images réécrit en place une image de la hauteur du terminal au lieu de laisser Ink effacer l'écran et l'historique. Le plein écran prend aussi toute la largeur (filets de 100 colonnes comme Claude Code).
- **Les thèmes** : palettes exactes de Claude Code pour dark, light, les deux daltonisés et les deux ANSI (gris des textes secondaires #999999, vert #4eba65, rouge #ff6b80, permission du thème clair #5769f7…), toujours en 24 bits comme Claude Code. Fuller garde son accent doré et ses thèmes propres.
- **La coloration du code** : Monokai Extended sur les thèmes sombres **dans les diffs** (aperçu de `/theme`, cartes d'édition), comme Claude Code (`function` #66d9ef, noms #a6e22e, chaînes #e6db74, texte #f8f8f2). Dans les réponses, Claude Code garde les couleurs du terminal : Fuller aussi.
- **Les réponses** (document Markdown fixe rendu par Claude Code sur Haiku et par le composant de Fuller, `scripts/render-markdown.tsx`) : 31 lignes sur 34 identiques, couleurs comprises. Repris : en-têtes de tableau centrés et code en ligne coloré dans les cellules, `---` écrit tel quel entre deux lignes vides, barre des citations atténuée, liens en bleu vif soulignés. Écarts restants : Fuller garde l'adresse du lien entre parenthèses (Claude Code la cache derrière un lien cliquable OSC 8, écarté le 25/09 pour la mesure des largeurs) ; deux nuances de coloration du code tiennent à la version de highlight.js.
- **Les diffs** : lignes retirées en texte simple, mots modifiés sur un fond plus vif (#5c0200 / #044700), numéros des lignes de contexte atténués, code non atténué.
- **Le menu `/`** : pour un préfixe tapé, le nom exact d'abord puis les noms les plus courts (`/co` → copy, color, config, compact), l'usage départageant les égalités ; un `/` seul reste classé par usage.
- **Ctrl+U** : « Ctrl+Y to paste deleted text » pendant 5 s après l'effacement d'au moins 3 caractères, même quand la saisie est vide.
- **Le `❯` de la saisie** : couleur par défaut du terminal au repos.

## Restant, volontairement ou faute de temps

- Le logo (trois lignes chez Claude Code, six pour Fuller) : choix de marque.
- Le curseur : Claude Code montre le vrai curseur du terminal dans la saisie, Fuller un bloc inversé. Il faudrait connaître la position exacte du curseur après chaque image.
- `@` : Claude Code y propose aussi les sous-agents et les ressources MCP.
- `/hooks` : Claude Code liste davantage d'événements, sans numéros, la description sous chaque nom.
- `log` en vert dans `console.log` : la bibliothèque de coloration de Fuller ne reconnaît pas les appels de méthode.
- Un chevauchement de deux lignes du transcript, vu une fois après une longue suite de dialogues et non reproduit ensuite : la hauteur de la conversation est mesurée un rendu en retard ; les lignes en trop sont maintenant coupées au lieu d'être tassées.
