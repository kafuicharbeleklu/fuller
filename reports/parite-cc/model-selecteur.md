# /model — sélecteur de modèle et niveau d'effort

Traité avant la phase 3, à la demande de l'équipe. Référence : Claude Code 2.1.281, capturé le 24/09/2026 à 100×28, 100×30 et 60×30. Aucune requête au modèle : Échap, et `s` (modèle pour cette session seulement, sans toucher à la configuration). Fuller a été capturé avec la vraie clé Gemini (`PARITY_KEEP_KEY=1`), qui sert uniquement à lister les modèles (`ListModels`). Captures dans `captures/model-*.json` et `captures/effort-*.json`.

## Claude Code (100×28)

```
▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ ◐ medium · /effort ▔
   Select model
   Switch between Claude models. Your pick becomes the default for new sessions. For
   other/previous model names, specify with --model.
   ❯ 1. Default (recommended) ✔  Opus 5.5 with 1M context · Best for everyday, complex tasks
     2. Opus (1M context)        Opus 5.5 with 1M context · Best for everyday, complex tasks
     3. Fable                    Fable 5.1 · Most capable for your hardest and longest-running
                                 tasks
     4. Sonnet                   Sonnet 5 · Efficient for routine tasks
     5. Haiku                    Haiku 4.5 · Fastest for quick answers
   ◐ Medium effort (default) ←/→ to adjust
   Enter to set as default · s to use this session only · Esc to cancel
```

## Fuller après correction (100×30)

```
▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ ◐ medium · /model ▔
   Select model
   Switch between Gemini models. Your pick becomes the default for new sessions. Press a for all
   models, or use /model <name>.
     1. Gemini 3.8 Flash       1M context
     2. Gemini 3.7 Flash       1M context
   ❯ 3. Gemini 3.6 Flash ✔     1M context
     4. Gemini 3.5 Flash       1M context
     5. Gemini 3.5 Flash Lite  1M context
   ◐ Medium effort (default) ←/→ to adjust
   Enter to set as default · s to use this session only · Esc to cancel
```

## Écarts et corrections

| Élément | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| Filet du haut | `▔` couleur permission, effort actuel incrusté | `▔` gris, vide | Comme Claude Code |
| Espacement | Aucune ligne vide | Une ligne vide entre chaque bloc | Aucune ligne vide |
| Titre | Gras, couleur permission | Gras, couleur texte | Gras, couleur permission |
| Ligne sélectionnée | `❯` et nom en couleur permission, numéro gris | `❯` et numéro en couleur accent, nom en gras | Comme Claude Code |
| Modèle actuel | Vert avec ✔ | ✔ seul | Vert avec ✔ |
| Descriptions | Colonne fixe, retour à la ligne sous la colonne | Tronquées ; « 1.0M context » | Retour à la ligne ; « 1M context » ; description omise si c'est le nom du modèle |
| Ligne de navigation | Aucune | `↑/↓ select · PgUp/PgDn page · Home/End · a all models` | Retirée ; la touche `a` est citée dans la description |
| Clé d'API invalide | — | Corps JSON brut de l'erreur | Message seul (`✗ API key not valid…`) |

## Niveau d'effort

| Comportement | Claude Code | Fuller avant | Fuller après |
|---|---|---|---|
| Libellé | `◐ Medium effort (default)`, symbole couleur de marque, texte gris, `←/→ to adjust` plus foncé | `◉ medium thinking`, tout en couleur accent | Comme Claude Code |
| Symboles | low `○`, medium `◐`, high `●`, xHigh `◉`, max `◈`, Ultracode `✦` | `◉` pour tous | Ceux de Claude Code ; `◌` pour minimal (niveau propre à Gemini) |
| ←/→ en bout de liste | Revient à l'autre extrémité | S'arrête | Revient à l'autre extrémité |
| Changement de modèle dans la liste | Garde le niveau choisi ; pas de ligne pour un modèle sans effort | Revient au niveau par défaut du modèle | Garde le niveau, ou le plus proche que le modèle accepte ; pas de ligne sans niveaux |
| Message après validation | `Set model to Opus 5.5 (1M context) (default) for this session only with low effort` | `Switched model to … · low thinking · this session only. Conversation history kept.` | `Set model to Gemini 3.5 Flash for this session only with high effort` |
| Message après Échap | `Kept model as Opus 5.5 (1M context) (default)` | `Kept model as Gemini 3.6 Flash` | `Kept model as Gemini 3.6 Flash (default)` |
| Ligne d'effort au-dessus de la saisie | Mise à jour après le choix | Restait sur l'ancien niveau | Mise à jour |

Niveaux de Fuller : ceux de l'API Gemini pour chaque modèle (minimal, low, medium, high selon le modèle). Claude Code en a six (low à Ultracode) ; ce sont des niveaux propres aux modèles Claude.

Fichiers : `src/ui/ModelPicker.tsx`, `src/ui/OverlayFrame.tsx` et `src/ui/Select.tsx` (communs à tous les sélecteurs : `/theme`, `/rewind`, `/resume` changent aussi d'aspect), `src/ui/App.tsx`, `src/ui/Footer.tsx`, `scripts/parity-capture.py` (option `PARITY_KEEP_KEY`). Tests : `tests/overlays.test.tsx`.

## Non vérifié ou restant

- Message après Entrée (modèle par défaut) : non capturé chez Claude Code pour ne pas modifier la configuration de l'utilisateur. Fuller écrit `Set model to X (default) with Y effort`.
- Claude Code colore le nom du modèle et le niveau dans ces messages (`#b1b9f9`) ; les messages système de Fuller sont en texte simple.
- Après Échap ou validation, la conversation plein écran de Fuller affiche un en-tête `Conversation · 3 rows` et répète `❯ /model` : à traiter en phase 2 (rendu de la conversation).
