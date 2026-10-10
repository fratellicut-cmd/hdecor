# H'DECOR

Application web (téléphone d'abord) de gestion pour H'DECOR EI, peintre en bâtiment : métré, calcul de peinture et liste d'achat, catalogue, devis et signature électronique, factures (acompte, situation, finale, avoir) et paiements, relances, planning, comptabilité simplifiée et exports, PV de réception, photos, demandes d'avis.

Données fictives seulement dans ce dépôt. Rien de ce qui touche à la loi ou à la fiscalité n'est affirmé comme exact : les points à confirmer sont marqués **À VÉRIFIER** dans l'application et regroupés dans [la check-list du comptable](docs/CHECKLIST_PREMIERE_FACTURE.md).

## Documents

| Pour | Document |
|---|---|
| Yorick (utilisation) | [docs/GUIDE_UTILISATEUR.md](docs/GUIDE_UTILISATEUR.md) |
| Le comptable | [docs/CHECKLIST_PREMIERE_FACTURE.md](docs/CHECKLIST_PREMIERE_FACTURE.md) |
| La mise en ligne | [docs/MISE_EN_PRODUCTION.md](docs/MISE_EN_PRODUCTION.md) |
| Points reportés et décisions | [docs/SUIVI.md](docs/SUIVI.md) |
| Architecture et choix initiaux | [docs/cadrage/CADRAGE.md](docs/cadrage/CADRAGE.md) |
| Données personnelles | [docs/rgpd/registre-traitements.md](docs/rgpd/registre-traitements.md) |
| Spécification d'origine | [PROMPT_PRINCIPAL.md](PROMPT_PRINCIPAL.md) |

## Technique

Next.js 16 (App Router) et TypeScript strict, Tailwind, Supabase (Postgres avec RLS sur chaque table, Auth avec double authentification, Storage), zod, pdf-lib, Vitest, Playwright. Hébergement prévu : Vercel (région Paris) et Supabase (UE).

Règles du code : argent en centimes entiers, TVA par taux, documents émis immuables, numérotation sans trou, tous les calculs dans `src/domain/` (fonctions pures testées), toute écriture par une Server Action validée par zod. Détails dans [CLAUDE.md](CLAUDE.md).

## Développement

Prérequis : Node 22, PostgreSQL 16 démarré (`pg_ctlcluster 16 main start`), `poppler-utils` (tests de PDF), Python 3 avec `openpyxl` (test de l'export Excel).

```
npm ci
npm run local:start          # pile locale sans Docker (base hdecor_dev), écrit .env.local
npm run dev                  # http://localhost:3000
npx tsx scripts/creer-compte.ts --email … --raison-sociale "…"   # mot de passe demandé au clavier
```

Contrôles :

```
npm run typecheck && npm run lint && npm run test     # types, lint, tests unitaires
npm run test:db                                        # schéma SQL (DB, AUTH=shim|gotrue)
npm run build && npx next start -p 3001
E2E_URL=http://localhost:3001 npm run test:e2e         # parcours sur téléphone (Playwright)
```

## Démonstration (données fictives)

Base séparée `hdecor_demo`, jamais la base réelle :

```
npm run demo:pile                                      # recrée la base de démo (vide)
npm run build && npx next start                        # serveur sur la démo
npm run demo:charger                                   # chargement par l'application (~30 s)
npm run demo:verifier                                  # invariants, numéros sans trou, données fictives
```

L'accès (email et mot de passe tirés au hasard) est écrit dans `.supabase-local/demo-acces.txt`, jamais dans git. Pour effacer la démo : `npm run demo:pile` (ou `npm run local:start` pour revenir au développement).

## Sauvegarde

`scripts/sauvegarde/sauvegarder.sh` et `restaurer.sh` : archive chiffrée de la base et des fichiers, restauration contrôlée (empreintes des documents émis). Test : `bash tests/sauvegarde/restauration.sh` sur la démo. Procédure de production : [docs/MISE_EN_PRODUCTION.md](docs/MISE_EN_PRODUCTION.md) § 5.
