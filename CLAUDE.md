# CLAUDE.md : Règles permanentes du projet H'DECOR

Ce fichier est lu automatiquement à chaque session. Il s'applique à tout le code et à tous les agents.

## Projet
Application web de gestion pour H'DECOR EI (peintre en bâtiment) : métré, calcul de peinture, devis, factures, paiements, comptabilité simplifiée. Spécification complète : `PROMPT_PRINCIPAL.md`.

## Stack
Next.js (App Router) + TypeScript strict + Tailwind + shadcn/ui, Supabase (Postgres, Auth, Storage, RLS), zod, Vitest, Playwright, Resend, Stripe (optionnel), PWA.

## Règles non négociables
1. Argent en **centimes entiers**. Aucun calcul monétaire en flottant.
2. TVA calculée **par taux sur le total HT du taux**, puis arrondie au centime.
3. Documents émis (factures, devis envoyés) **immuables**. Correction par avoir ou nouvelle version.
4. Numérotation **atomique, chronologique, sans trou** : DEV-AAAA-0001, FAC-AAAA-0001, AVO-AAAA-0001.
5. **RLS activée sur chaque table**. Chaque table porte `organisation_id`.
6. Aucun secret dans le code ni dans git. Variables d'environnement uniquement.
7. Entrées validées côté serveur avec zod.
8. Toutes les valeurs métier (taux, marges, rendements, seuils, délais) sont **paramétrables**, jamais en dur.
9. Interface en **français**, formats français (€, JJ/MM/AAAA, virgule décimale).
10. Mobile-first : cibles tactiles de 44 px minimum.

## Honnêteté
- Ne jamais inventer une référence produit, un prix, un taux, un article de loi.
- Toute donnée non confirmée est marquée **À VÉRIFIER** (interface + base).
- Ne jamais affirmer qu'un test passe sans l'avoir exécuté.
- Ne jamais désactiver ou affaiblir un test pour faire passer le build.
- En cas de doute : signaler, ne pas deviner.

## Qualité : agents de contrôle
Agents dans `.claude/agents/` : `chef-de-projet`, `qa-calculs`, `auditeur-legal`, `auditeur-peinture`, `securite-rgpd`, `relecteur-code`, `testeur-chantier`.

Une phase n'est terminée que si tous les agents applicables rendent **APPROUVÉ**. Sur **REFUSÉ** : corriger, relancer, sans contourner. Maximum 5 boucles par phase, puis s'arrêter et expliquer le blocage.

| Phase | Agents obligatoires |
|---|---|
| 0 Cadrage | chef-de-projet, securite-rgpd |
| 1 Fondations | securite-rgpd, relecteur-code, testeur-chantier |
| 2 Métré et calculateur | qa-calculs, auditeur-peinture, relecteur-code, testeur-chantier |
| 3 Catalogue | auditeur-peinture, qa-calculs, relecteur-code |
| 4 Devis | qa-calculs, auditeur-legal, securite-rgpd, relecteur-code, testeur-chantier |
| 5 Factures | qa-calculs, auditeur-legal, securite-rgpd, relecteur-code, testeur-chantier |
| 6 Pilotage | qa-calculs, relecteur-code, testeur-chantier |
| 7 Documents | auditeur-legal, securite-rgpd, relecteur-code, testeur-chantier |
| 8 Recette | tous, orchestrés par chef-de-projet |

## Définition de « terminé »
Tests exécutés et verts, TypeScript / lint / build sans erreur ni warning, aucun bloquant ouvert, PDF réel généré et contrôlé, aucune donnée inventée présentée comme réelle.

## Ce qui relève de l'humain
Validation légale finale par le comptable de Yorick (TVA, mentions, rétractation, facturation électronique, seuils micro-entreprise). Vérification des références et rendements de peinture sur les fiches techniques fabricants.

## Commandes
- Tests du schéma SQL (Phase 0, sans application) : `bash tests/db/run.sh`
  Prérequis : PostgreSQL 16 local démarré, et un rôle superuser au nom de l'utilisateur système
  (`sudo -u postgres createuser -s "$USER"`). Le script recrée la base `hdecor_test`, applique
  `tests/db/shim_supabase.sql` puis `supabase/migrations/*.sql`, lance `tests/db/schema.test.sql`
  et le test de numérotation concurrente `tests/db/concurrence.sh`.
- À partir de la Phase 1 :
- Développement : `npm run dev`
- Tests : `npm run test`
- Parcours : `npm run test:e2e`
- Lint / types : `npm run lint` et `npm run typecheck`
- Build : `npm run build`
