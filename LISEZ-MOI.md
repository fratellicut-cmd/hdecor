# KIT H'DECOR : mode d'emploi

Ce kit contient tout pour faire construire l'application de Yorick (devis, factures, métré, calcul de peinture) par Claude Code, avec des agents de contrôle qui bloquent tout ce qui est faux ou incomplet.

## Contenu

```
hdecor-kit/
├── LISEZ-MOI.md              ce guide
├── PROMPT_PRINCIPAL.md       le cahier des charges complet à donner à Claude Code
├── CLAUDE.md                 les règles permanentes (lues automatiquement)
└── .claude/agents/
    ├── chef-de-projet.md     orchestre, valide chaque phase, refuse sans preuves
    ├── qa-calculs.md         surfaces, peinture, TVA, arrondis, numérotation
    ├── auditeur-legal.md     mentions obligatoires devis et factures
    ├── auditeur-peinture.md  cohérence métier, références, rendements
    ├── securite-rgpd.md      accès, RLS, secrets, RGPD
    ├── relecteur-code.md     qualité du code, tests, performance
    └── testeur-chantier.md   joue Yorick sur un chantier, sur téléphone
```

## Installation (10 minutes)

1. **Installe Claude Code** si ce n'est pas fait (voir la documentation officielle d'Anthropic) et Node.js.
2. **Crée un dossier de projet vide**, par exemple `hdecor-app`.
3. **Dézippe le kit** dans ce dossier : `CLAUDE.md`, `PROMPT_PRINCIPAL.md` et le dossier `.claude/` doivent être à la racine. Le dossier `.claude` est caché : active l'affichage des fichiers cachés (Mac : `Cmd + Maj + .`).
4. **Ajoute le logo** : crée `public/brand/` et mets-y le fichier du logo H'DECOR (le plus haute qualité possible, idéalement en SVG ou PNG fond transparent).
5. **Ouvre un terminal** dans le dossier et lance `claude`.
6. Tape `/agents` : tu dois voir les 7 agents. Si ce n'est pas le cas, relance Claude Code depuis la racine du projet.
7. **Colle ce message** :

> Lis CLAUDE.md et PROMPT_PRINCIPAL.md en entier, puis exécute la Phase 0 uniquement. Pose-moi tes questions d'architecture en une seule fois, puis livre le cadrage et attends ma validation.

## Comptes à créer avant la phase 1 (gratuits au départ)

| Service | Rôle | Quand |
|---|---|---|
| Supabase | base de données, connexion, fichiers | Phase 1 |
| Vercel | mise en ligne | Phase 1 |
| Resend | envoi des emails | Phase 4 |
| Stripe | paiement en ligne (optionnel) | Phase 5 |
| GitHub | sauvegarde du code | Phase 1 |

Claude Code te guidera pour chacun. Ne lui donne jamais tes mots de passe : il utilise des variables d'environnement que tu renseignes toi-même.

Procédure détaillée de mise en ligne (réglages Supabase, variables Vercel, création du compte) : `docs/MISE_EN_PRODUCTION.md`.

## Comment piloter (ton rôle de directeur)

- **Une phase à la fois.** À la fin de chaque phase, Claude Code te présente un compte rendu et tu valides avant la suivante.
- **Tu décides, il exécute.** Les points marqués « décision humaine » sont pour toi ; ceux marqués « À FAIRE VALIDER PAR LE COMPTABLE » sont pour le comptable de Yorick.
- **Si un agent refuse**, c'est normal : Claude Code corrige et relance. Tu n'as rien à faire, sauf s'il dit qu'il est bloqué après 5 tentatives.
- **Pour forcer un contrôle** à tout moment :

> Lance maintenant les agents applicables à cette phase (voir le tableau de CLAUDE.md), corrige tous les bloquants, relance jusqu'à APPROUVÉ, puis fais-moi le compte rendu.

- **Pour un audit global surprise** :

> Lance le chef-de-projet en revue globale : il vérifie les preuves de chaque phase, relance les agents manquants et me donne la liste des risques résiduels.

## Ce que les agents font, et ce qu'ils ne font pas

**Ils réduisent fortement les erreurs** : calculs, mentions manquantes, failles de sécurité, bugs, ergonomie.

**Ils ne remplacent pas :**
- le **comptable de Yorick** pour la validation légale et fiscale finale (statut TVA, mentions, rétractation, seuils, facturation électronique) ;
- les **fiches techniques fabricants** pour les rendements et références de peintures ;
- un **test réel** : avant la première vraie facture, Yorick et son comptable vérifient un devis et une facture générés par l'app, ligne par ligne.

Les agents partagent le même modèle que celui qui code, donc certains angles morts se recoupent. C'est pour cela que les tests de calcul utilisent des résultats **calculés à la main** (voir section 6 du prompt) et que le comptable garde le dernier mot.

## Informations à préparer pour Yorick

- Statut fiscal : micro-entreprise (franchise de TVA) ou régime réel avec TVA
- SIRET
- Assurance décennale et RC Pro : assureur, numéro de contrat, période, zone
- Médiateur de la consommation choisi
- IBAN / BIC
- Logo en haute qualité
- Taux horaire, marge souhaitée, taux de pénalités et conditions de paiement habituelles
- Fournisseurs de peinture habituels et leurs tarifs (fichier ou photos)
- Quelques anciens devis et factures comme modèles

## Point de vigilance sur la facturation électronique

La réforme française de la facturation électronique est en cours de déploiement (réception obligatoire pour toutes les entreprises depuis septembre 2026, émission pour les petites entreprises prévue à partir de septembre 2027). Les dates et les plateformes agréées sont **à confirmer** auprès de l'administration fiscale ou du comptable : l'application prépare les données au format Factur-X mais ne remplace pas ce choix.

## Option : revendre l'outil à d'autres artisans

Le prompt prévoit déjà le multi-entreprise (chaque donnée est rattachée à une organisation). Si tu veux aller plus loin (abonnement, inscription en libre-service, facturation de l'outil), dis-le avant la phase 0 pour que le cadrage l'intègre.
