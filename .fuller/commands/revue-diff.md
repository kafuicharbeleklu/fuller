---
description: Relire les changements git non commités (bugs, risques, améliorations)
argument-hint: [focus]
allowed-tools: ["Bash(git diff:*)", "Bash(git status:*)", "Bash(git log:*)"]
---
Relis les modifications non commitées ci-dessous et signale, fichier par fichier, les bugs, les risques et les améliorations possibles, avec des références `fichier:ligne`. Ne modifie rien sans le demander. $ARGUMENTS

## État du dépôt
!`git status --short`

## Diff
!`git diff`
