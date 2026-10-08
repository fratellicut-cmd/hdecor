# Suivi des vulnérabilités des dépendances

Contrôle : `npm audit` (CI : `npm audit --omit=dev`, bloquant).

## État au 08/10/2026

| Périmètre | Résultat |
|---|---|
| Dépendances de **production** (`npm audit --omit=dev`) | **0 vulnérabilité** |
| Outillage de **développement** (`npm audit`) | 5 alertes « high », une seule cause |

## Alerte connue (développement uniquement)

- **Paquet :** `braces`, avis [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Déni de service par épuisement de pile, avec un motif de fichiers très imbriqué.
- **Chaîne :** `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`. Les 5 alertes sont cette même cause, remontée à chaque maillon.
- **Exposition :** aucune en production. Ces paquets ne servent qu'au lint, sur nos propres fichiers, et ne sont pas embarqués dans l'application.
- **Correctif proposé par `npm audit fix --force` :** revenir à `eslint-config-next@14`, incompatible avec Next 16. **Refusé.**
- **Action :** surveiller une version corrigée de `eslint-config-next` 16.x et relancer `npm audit` à chaque montée de version.
