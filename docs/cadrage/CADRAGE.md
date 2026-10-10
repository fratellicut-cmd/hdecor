# H'DECOR : cadrage (Phase 0)

> Statut : **validé** (Phase 0), puis appliqué des Phases 1 à 8. Document d'origine, conservé tel quel ; les écarts décidés depuis sont dans `docs/SUIVI.md`.

---

## 1. Décisions prises

| Sujet | Décision | Conséquence |
|---|---|---|
| Dépôt | Nouveau dépôt GitHub `hdecor`, séparé de nutriclair | Secrets, déploiements et historique séparés |
| Hébergement | **Vercel + Supabase** (Postgres, Auth, Storage) | Région UE pour les deux (Supabase : Paris ou Francfort ; Vercel : `cdg1`) |
| Statut fiscal | **Micro-entreprise, franchise en base de TVA** | Le moteur gère aussi le régime assujetti (bascule dans les Paramètres), mais les PDF en franchise sont contrôlés en premier |
| Revente | **Non** | Le multi-entreprise reste « dormant » : `organisation_id` et RLS partout, aucune inscription libre, pas d'abonnement |
| Utilisateurs | **Yorick seul** | Un seul rôle (`proprietaire`) ; le compte est créé par script, l'inscription publique est désactivée |
| Hors-ligne | **Retiré** | Voir l'écart ci-dessous |
| Signature | **Signature électronique simple, faite maison** | Tracé au doigt, nom, mention « Bon pour accord », horodatage serveur, IP, navigateur, empreinte SHA-256 du PDF, PDF signé archivé et non modifiable |

### Écart volontaire avec le cahier des charges
Le cahier des charges demande un métré hors-ligne avec synchronisation (§3, §5.3, parcours 10 du testeur-chantier). **Tu l'as retiré.**
- Ce qui reste : l'application est installable sur l'écran d'accueil (PWA : manifeste et icônes), mais elle a besoin du réseau.
- Pour ne pas perdre de saisie lors d'une coupure 4G :
  - chaque champ du métré est **enregistré sur le serveur dès qu'il est modifié** ;
  - le formulaire en cours est **aussi gardé dans le téléphone** jusqu'à la confirmation du serveur ;
  - un bandeau « Hors connexion : vos saisies seront envoyées au retour du réseau » s'affiche.

  Ce n'est pas un vrai mode hors-ligne : sans réseau, impossible d'ouvrir un chantier pas encore chargé.
- Le parcours 10 du testeur-chantier devient : « coupure réseau pendant la saisie : aucune perte ».

---

## 2. Architecture

```
Téléphone de Yorick (navigateur / PWA)
        │  HTTPS
        ▼
Next.js 16.4 sur Vercel (App Router, rendu serveur)
  ├─ proxy.ts ............ rafraîchit la session Supabase (vérification « optimiste » seulement)
  ├─ app/(app)/… ......... pages protégées : la session est vérifiée dans la couche d'accès aux données (DAL)
  ├─ Server Actions ...... toute écriture : zod → DAL → Supabase avec le jeton de Yorick (la RLS s'applique)
  ├─ src/domain/ ......... TOUS les calculs (surfaces, peinture, pots, TVA, totaux, acomptes) : fonctions pures testées
  ├─ src/lib/pdf/ ........ PDF générés avec pdf-lib (charte H'DECOR), empreinte SHA-256
  ├─ src/lib/email.ts .... Resend, appelé par son API (fetch) : PDF joint + lien sécurisé
  └─ src/lib/supabase/admin.ts . clé de service : liens publics, fichiers, tâches planifiées
                            (fichiers autorisés listés dans eslint.config.mjs)
        │
        ▼
Supabase (UE)
  ├─ Postgres : RLS sur toutes les tables, FK composites par organisation,
  │             triggers d'immuabilité, numérotation atomique, journal d'audit
  ├─ Auth : email + mot de passe, lien magique, TOTP (double authentification) optionnel
  └─ Storage : 5 buckets privés, chemins préfixés par l'organisation, URL signées à durée courte
```

### Versions vérifiées le 08/10/2026 sur le registre npm
`next` 16.4.0, `@supabase/supabase-js` 2.117.3, `@supabase/ssr` 0.12.7, `@react-pdf/renderer` 4.9.0, `zod` 4.6.5, `tailwindcss` 4.3.3, `vitest` 5.0.3, `@playwright/test` 1.64.0, `resend` 6.32.1.

> **Écart de réalisation (constaté en Phase 8)** : les PDF sont produits avec `pdf-lib` 1.17.1 (et non `@react-pdf/renderer`), Resend est appelé par son API HTTP (sans le paquet `resend`), et le code serveur est rangé dans `src/lib/` (et non `src/server/`). Les versions réellement utilisées sont celles de `package.json`.

Ce qui change dans Next 16 (lu dans la documentation fournie avec le paquet) :
- le fichier `middleware.ts` est **déprécié** et devient `proxy.ts` ;
- la documentation recommande une **couche d'accès aux données (DAL)**. Le proxy ne sert qu'à des vérifications optimistes, jamais à l'autorisation.

Le mode `cacheComponents` reste **désactivé** : toutes les données de l'application sont propres à l'utilisateur et doivent être fraîches.

### Règles d'architecture
1. **Un calcul n'existe qu'à un seul endroit : `src/domain/`.** L'interface, le PDF et le serveur appellent les mêmes fonctions. La base ne recalcule pas : elle **contrôle** à l'émission (somme des lignes, ventilation, arrondi de la TVA par taux, net à payer). C'est un garde-fou, pas une seconde implémentation.
2. **Toute écriture passe par une Server Action** : validation zod, puis vérification de session dans la DAL, puis requête avec le jeton de l'utilisateur. Aucune écriture ne court-circuite la RLS.
3. **La clé de service n'est utilisée que par les fichiers autorisés** (`src/lib/supabase/admin.ts` et la liste de `eslint.config.mjs` : stockage des fichiers, liens publics, tâches planifiées, webhook Stripe), tous `import 'server-only'`. Une règle ESLint interdit de l'importer ailleurs.
4. **Documents émis :**
   - le PDF est généré **avant** l'émission ;
   - son empreinte est figée en base ;
   - le fichier est déposé dans un bucket où ni la mise à jour ni la suppression ne sont autorisées.
5. **Copies figées :** à l'émission, l'identité de l'entreprise, du client et du chantier est copiée dans le document. Modifier les Paramètres ou la fiche client ne change jamais un document déjà émis.

---

## 3. Modèle de données

Les fichiers sont dans `supabase/migrations/` (9 migrations) et ont été **exécutés et testés sur PostgreSQL 16**. Ils posent la structure de toutes les fonctions du cahier des charges (§5.1 à §5.11) pour que l'architecture soit figée dès maintenant ; ce n'est pas une garantie que chaque détail soit juste avant la phase qui l'implémente. Les ajustements de détail se feront phase par phase, par de nouvelles migrations.

| Migration | Contenu |
|---|---|
| `0100_socle` | organisations, membres, `est_membre()`, politique RLS standard, journal d'audit, numérotation `prochain_numero()` |
| `0200_parametres_clients` | paramètres entreprise (régime TVA, conditions, seuils), assurances, taux de TVA, clients, anonymisation |
| `0300_catalogue` | produits (statut `verifie` / `a_verifier` / `fictif`), conditionnements, historique des prix (automatique), teintes, prestations, étapes de préparation, référentiel de rendements, coefficients de support |
| `0400_chantiers_metre` | chantiers (statut stocké : à planifier, en cours, terminé ; « facturé » et « payé » dérivés), pièces (rectangle ou mur par mur, multiplicateur « x pièces identiques »), ouvertures, éléments, postes de travaux, préparations, **temps passés** (rentabilité réelle) |
| `0500_devis` | devis, lignes (avec coût matière et minutes **prévus**, figés), **achats retenus** (conditionnement et prix d'achat au chiffrage, pour l'alerte de changement de prix), **échéancier** (≤ 100 %), versions, signatures, émission, refus, nouvelle version, contrôle des totaux contre les lignes, vue `v_devis` |
| `0600_factures_paiements` | factures (acompte, situation, finale, libre, avoir ; remise globale), lignes, acomptes déduits vérifiés, paiements en ajout seul, remboursements sur avoir plafonnés au trop-perçu réel, annulation d'un paiement erroné même sur facture annulée, délai de paiement plafonné par le paramètre, vue `v_factures` (statuts dérivés, restes bornés à zéro) |
| `0650_liens_publics` | liens de consultation et de signature (devis) et de consultation (facture), clés étrangères composites, durée maximale de 90 jours, révocation définitive, fonctions par jeton réservées au serveur |
| `0700_pilotage_documents` | modèles de messages, envois et relances, **rappels et notifications**, dépenses, catégories, matériel, planning, photos, documents de chantier, check-list de fin de chantier, PV de réception, attestations TVA (taux rattaché au paramétrage), livre des recettes (vue, remboursements en négatif), vue `v_chantiers` (« facturé » / « payé » rapportés au total accepté des devis, reste à facturer), références polymorphes vérifiées dans la même organisation |
| `0800_stockage_droits` | buckets privés et politiques, chemins de fichiers obligatoirement dans le dossier de l'organisation, origine des paiements (Stripe réservé au webhook), anonymisation RGPD, retrait des droits du rôle anonyme, fonctions fermées par défaut |

### Choix structurants
- **Unités entières partout :**
  - argent en **centimes** (`bigint`) ;
  - taux en **points de base** (`2000` = 20 %, `550` = 5,5 %) ;
  - longueurs en **millimètres** ;
  - quantités de ligne × 10 000.

  La pièce de référence donne **31 926 800 mm² = 31,9268 m² exactement**, ce qui est vérifié par un test.
- **Clés étrangères composites `(organisation_id, id)`.** Les contrôles de clé étrangère ignorent la RLS. Sans cette précaution, quelqu'un qui connaîtrait l'identifiant d'un client d'une autre organisation pourrait le rattacher à son chantier. C'est vérifié par un test.
- **Montant accepté calculé par la base.** La signature (sur place ou par lien) ne transmet aucun montant : la base calcule le total accepté à partir des lignes fermes, des options choisies et de la remise.
- **Émissions sérialisées.** L'émission d'une facture verrouille son devis : deux acomptes simultanés ne peuvent pas dépasser le devis, et un acompte ne peut pas être déduit deux fois.
- **Aucun montant cru sur parole.** À l'émission d'un devis ou d'une facture et à la signature, la base recontrôle les totaux contre les lignes : somme, remise globale (arrondie selon R5), ventilation par taux, arrondi de la TVA par taux, acomptes déduits (chacun doit être une facture d'acompte ou de situation émise du même devis, avec son numéro et ses montants exacts, déduite une seule fois).
- **PV de réception et attestations de TVA signés figés.** La signature n'est posée que par les fonctions de signature (Phase 7) et doit être celle de CE document. Ensuite, le document n'est ni modifiable ni supprimable.
- **Lignes reprises d'un devis :** uniquement depuis le devis de leur facture (même client).
- **JSON de montants à forme stricte.** Ventilations de TVA et acomptes déduits n'acceptent que leurs clés numériques, avec des UUID en minuscules. Aucun texte libre ne peut s'y glisser, et un même acompte ne peut pas être déduit deux fois sous une autre écriture.
- **Autoliquidation :** les lignes gardent leur taux, la TVA facturée est nulle (mention dédiée sur le PDF).
- **Journal d'audit sans données personnelles.** Il fonctionne par **liste blanche** : identifiants, numéros, statuts, montants, taux, quantités, dates et empreintes. Aucun texte libre, nom, adresse, IP ni copie client. En modification, seules les colonnes changées sont enregistrées. La purge de conservation est réservée au serveur.
- **Statuts dérivés plutôt que stockés.**
  - Pour les factures, « envoyée », « partiellement payée », « payée » et « en retard » sont calculés à partir des paiements et de l'échéance.
  - Pour les devis, « consulté » et « expiré » sont calculés de la même façon.

  Ainsi, aucun statut ne peut contredire la réalité des encaissements.
- **Numéro attribué à l'émission seulement.** Un brouillon n'a pas de numéro. Le compteur est une ligne verrouillée et non une `SEQUENCE` : il revient en arrière si l'émission échoue, donc il n'y a jamais de trou.
- **Versions de devis :** une nouvelle version garde le même numéro, avec un suffixe (`DEV-2026-0007 v2`). L'ancienne version passe à « remplacé ». *(Choix par défaut ; dis-moi si tu préfères un nouveau numéro par version.)*
- **Avoir :** montants positifs, le type donne le sens. Un avoir égal au total de la facture la passe en « annulée ». Chaque avoir a une **nature** :
  - **correction** (erreur, annulation) : la somme redevient à facturer ;
  - **réduction** (geste commercial) : la somme est abandonnée. Elle ne se refacture pas et le chantier peut être soldé.
- **Paiements :** une écriture fausse se corrige par une écriture d'annulation (montant opposé, référence à l'écriture annulée), jamais par une modification.

### Ce que les tests de schéma prouvent déjà (exécutés)
```
$ bash tests/db/run.sh
 tests_passes
--------------
          180
NOTICE:  OK numérotation concurrente : 60 sessions simultanées, 10 annulées
         -> 50 numéros FAC-2026-0001 à FAC-2026-0050, sans trou ni doublon
NOTICE:  OK course à l'émission : 2 acomptes de 60,00 simultanés sur un devis
         de 100,00 -> 1 seul émis
NOTICE:  OK course émission / client du chantier : changement de client refusé
         après l'émission
NOTICE:  OK course avoir / finale : dans les deux ordres, une seule émission ;
         invariants I1 à I9 respectés
```
Ce qui est couvert :
- **Structure :**
  - la RLS est active sur 100 % des tables et chaque table porte `organisation_id` ;
  - toutes les fonctions `SECURITY DEFINER` fixent `search_path` ;
  - la liste exacte des fonctions `SECURITY DEFINER` appelables par une session est contrôlée. La liste **complète** des fonctions appelables est elle aussi testée : 8 fonctions métier (`SECURITY DEFINER`, appartenance vérifiée) et 6 fonctions pures sans accès privilégié (`ventilation_attendue`, `ventilation_bien_formee`, `deductions_bien_formees`, `aujourd_hui_paris`, `chemin_de_l_organisation`, `organisation_du_chemin`) ;
  - une future fonction est fermée par défaut.
- **Isolation :**
  - B ne voit, ne modifie et ne supprime rien de A (tables, vues, journal, fichiers, temps, rappels, achats, échéancier) ;
  - les FK composites bloquent les vols de référence, y compris un **lien public vers un devis de A** ;
  - le rôle anonyme n'a accès à rien.
- **Immuabilité :**
  - devis envoyé, lignes, échéancier et achats retenus sont figés, et une ligne de brouillon ne peut pas être déplacée vers un document émis ;
  - une facture émise n'est ni modifiable ni supprimable, même directement en base ;
  - les paiements, le journal, l'historique des prix et les signatures sont en ajout seul.
- **Calculs contrôlés en base :**
  - TVA par taux ;
  - remise globale (une remise de 10 % sur 100,00 € donne 90,00 €, et 95,00 € est refusé) ;
  - montant accepté à la signature recontrôlé contre les lignes (un total gonflé à 1 000 000 € est refusé) ;
  - acompte déduit inexistant ou déduit deux fois : refusé.
- **Cas de référence :**
  - devis de 5 000 € HT à 10 %, acompte de 1 650 € TTC, finale avec un net de **3 850,00 €** ;
  - devis remisé : 2 × 1 000 € avec 10 % de remise, acompte de 540 €, finale avec un net de **1 260,00 €** ;
  - refus de facturer plus que le devis accepté.
- **Paiements :**
  - partiel, refus d'un paiement supérieur au reste à payer, statut « payée » dérivé ;
  - avoir sur une facture payée et remboursement plafonné (livre des recettes à +100,00 € puis −100,00 €) ;
  - le mode Stripe est réservé au webhook et l'auteur du paiement est imposé.
- **Liens publics :**
  - durée de 90 jours au maximum ;
  - date de création imposée ;
  - pas de lien sur un brouillon ;
  - révocation définitive ;
  - fonctions par jeton réservées au serveur ;
  - jeton inconnu refusé et consultation tracée.
- **Fichiers :**
  - chemin hors du dossier de l'organisation refusé, `..` refusé ;
  - pas de SVG pour le logo ;
  - un PDF émis ne se supprime pas.
- **RGPD :**
  - l'anonymisation efface la fiche client, les chantiers, les pièces, le planning, les rappels, les temps passés, les check-lists, les envois et les photos. Les devis jamais acceptés perdent tous leurs textes libres (objet, notes, conditions, délai, motif, lignes, échéances). Tous les liens publics du client (devis et factures) sont révoqués, un devis encore « envoyé » ne peut plus être signé, et son PDF est renvoyé pour suppression ;
  - les factures émises gardent leur copie figée (conservation) ;
  - le journal ne contient aucune donnée personnelle ;
  - la purge est réservée au serveur et refusée pour des entrées récentes.
- **Divers :**
  - échéancier supérieur à 100 % refusé ;
  - historique des prix automatique et détection d'un changement de prix sur un devis en cours ;
  - statut de chantier dérivé et rapporté au devis : un chantier dont seul l'acompte est payé reste « à facturer » (700,00 € restants), il n'apparaît jamais « payé » ;
  - avoir partiel sur une facture non payée : aucun remboursement possible, reste à payer 700,00 €, livre des recettes juste ;
  - geste commercial de 100 € sur une finale de 1 000 € payée 900 € : chantier « payé », la somme abandonnée ne se refacture pas ;
  - annuler un encaissement déjà remboursé au client : refusé ;
  - situation : avancement obligatoire sur chaque ligne ;
  - paiement erroné annulable même après annulation de la facture par avoir ;
  - une seule source pour l'acompte (le devis doit correspondre à l'échéancier) ;
  - délai de paiement supérieur au maximum paramétré : refusé ;
  - temps passés et rappels.

Ces tests tournent sur un Postgres nu avec un « shim » qui reproduit `auth.uid()`, les rôles et `storage` de Supabase. **Limite :** ils ne remplacent pas un passage sur la vraie pile Supabase locale (`supabase start`). Ce passage est prévu en Phase 1, dans l'intégration continue.

---

## 4. Règles de calcul et d'arrondi (documentées, testées en Phase 2 et 4)

| # | Règle |
|---|---|
| R1 | Surfaces calculées **exactement** en mm². Affichage et quantité de ligne de devis : m² arrondis à 0,01, au demi supérieur. **La quantité du devis est la valeur affichée** (31,93 m² × prix unitaire), pour que le client puisse refaire le calcul. |
| R2 | Litres = surface exacte ÷ (rendement × coefficient de support) × couches × (1 + marge de perte), en décimal exact. Valeur conservée à 4 décimales (7,0239 L) et affichée à 2 décimales. |
| R3 | Pots : combinaison qui **couvre** le besoin au **coût minimal**. En cas d'égalité : le moins de reste, puis le moins de pots. Sans prix connu pour tous les formats (révisé en Phase 2, boucle 3, arbitrage entre l'audit métier et le contrôle des calculs) : seules les combinaisons dont le reste est **inférieur au plus petit format** ou **au plus égal à la tolérance** (paramètre « reste toléré », 10 % du besoin au départ) sont retenues ; parmi elles, **le moins de pots**, puis le moins de reste ; présenté comme « indicatif ». Exemples avec 1 / 2,5 / 5 / 10 / 15 L : 9,2 L -> 10 L ; 13,86 L -> 15 L ; 44 L -> 3 × 15 L ; 7,02 L -> 5 + 2,5 L ; 1,1 L (pots de 1 et 15 L) -> 2 × 1 L. Si les pots retenus ont un prix, leur coût est indicatif et le total n'est pas présenté comme complet. Le reste est toujours affiché. |
| R4 | Ligne HT = arrondi au centime (demi supérieur), **en une seule fois**, de quantité × prix unitaire × (1 − remise de ligne) × avancement (situation). Contrainte en base sur chaque ligne. Exemple : 31,93 m² × 12,50 € = 399,125 → 399,13 €. |
| R5 | Remise globale = arrondi demi-supérieur(somme HT × taux de remise), appliquée **avant** la TVA. Répartition entre les taux : partie entière de (lignes du taux × remise ÷ somme), puis les centimes restants un par un aux plus forts restes (à reste égal, taux le plus élevé d'abord). **La base calcule elle-même cette ventilation** (`ventilation_attendue`) et exige l'égalité stricte : impossible de reporter la remise sur un taux pour sous-déclarer la TVA. `src/domain` implémente la même règle, testée sur les mêmes cas. |
| R6 | TVA = **par taux**, arrondi(base HT du taux × taux). Jamais une somme de TVA arrondies ligne par ligne. Cas 3 × 33,33 € à 20 % : **20,00 €**. |
| R7 | TTC = HT + TVA, exact au centime (contrainte en base). |
| R8 | Franchise en base : TVA = 0 pour toutes les lignes, mention de franchise, pas d'attestation de TVA réduite, pas d'autoliquidation (contraintes en base). |
| R9 | **Source unique des cumuls** : trois fonctions, `solde_facture`, `solde_avoir` et `solde_devis`, calculent tous les montants cumulés (dû, payé, remboursé, reste à payer, trop-perçu, engagé, reste à facturer). L'émission des factures, le contrôle des paiements, la vue des factures et la vue des chantiers les lisent ; aucun autre calcul n'existe. Base commune : le **net à payer** (une finale ne recompte jamais les acomptes qu'elle déduit). Acompte : base HT de chaque taux × %, puis TVA selon R6. Finale : totaux du devis accepté, **moins** chaque acompte ventilé par taux (HT, TVA, TTC). Un avoir est plafonné au net à payer de sa facture d'origine. Quand il l'annule, les acomptes qu'elle déduisait sont **libérés** et se re-déduisent sur la facture suivante. Un acompte déduit par une facture valable ne se corrige pas directement. Engagé d'un devis = nets des factures émises − avoirs de **correction** (un avoir de **réduction** ne libère rien). Il ne dépasse jamais le total accepté, et cet invariant est testé sur toutes les données. Rattachements contraints : avoir rattaché par sa seule facture d'origine, facture avec le client et le chantier de son devis, client du chantier figé dès qu'un document est émis. |
| R10 | L'arrondi « demi supérieur » (arrondi commercial) est **À FAIRE VALIDER PAR LE COMPTABLE**. |

---

## 5. Arborescence des pages

```
/connexion · /mot-de-passe-oublie · /reinitialiser · /double-authentification
/                         Tableau de bord (CA, devis en attente, impayés, chantiers, jauge des seuils)
/clients                  liste + recherche instantanée + export CSV
/clients/nouveau · /clients/[id]                       historique complet, RGPD (export, anonymisation)
/chantiers · /chantiers/nouveau
/chantiers/[id]                                        résumé, statut, pièces
/chantiers/[id]/pieces/[pieceId]                       métré, ouvertures, éléments, photos
/chantiers/[id]/peinture                               postes, préparation, finition, calcul
/chantiers/[id]/liste-achat                            par produit / teinte / pots ; PDF ; partage
/chantiers/[id]/documents · /photos · /reception (PV) · /fin-de-chantier
/devis · /devis/[id] (édition, échéancier, options) · /devis/[id]/apercu · /devis/[id]/signer (sur place) · /devis/[id]/versions
/factures · /factures/nouvelle · /factures/[id] · /factures/[id]/paiement · /factures/[id]/avoir
/catalogue/produits · /catalogue/produits/[id] · /catalogue/import · /catalogue/teintes
/catalogue/prestations · /catalogue/preparations · /catalogue/rendements
/planning                 jour / semaine / mois, export de fichier ICS, rappels
/notifications            rappels à venir et passés (séchage, début de chantier, relance devis, échéance facture)
/chantiers/[id]/temps     saisie des heures passées
/chantiers/[id]/rentabilite   prévu (devis) vs réel (temps passés + achats rattachés)
/comptabilite/recettes · /comptabilite/achats · /comptabilite/materiel · /comptabilite/exports
/parametres/entreprise · /fiscal · /assurances · /conditions · /mentions · /messages · /compte · /donnees

Public (sans compte, par jeton) :
/d/[jeton]                consultation + signature à distance du devis
/f/[jeton]                consultation de facture (+ QR code de virement, paiement Stripe si activé)

API :
/api/cron/relances        relances devis et impayés (cron Vercel, secret vérifié)
/api/stripe/webhook       signature vérifiée, idempotent (si Stripe est activé)
(L'export agenda est un **fichier ICS téléchargé** depuis /planning, avec la session : aucun flux public.)
```

Navigation mobile : barre du bas à 5 entrées (Accueil, Chantiers, Devis, Factures, Plus) et un bouton flottant « + » pour l'action rapide (nouveau chantier, devis ou paiement).

---

## 6. Composants

**Base (shadcn/ui + Tailwind)** : boutons d'au moins 44 px, champs, feuille latérale, boîte de dialogue, onglets, liste, badge de statut, notification. **Composants propres à l'application :**

| Composant | Rôle |
|---|---|
| `ChampNombre` | clavier numérique (`inputmode="decimal"`), accepte la virgule, unités affichées, conversion en entiers au bord du domaine |
| `ChampMontant` | saisie en euros, stockage en centimes |
| `ChampDimension` | saisie en m ou en cm, stockage en mm |
| `BadgeAVerifier` | marque « À VÉRIFIER » partout où une donnée n'est pas confirmée |
| `EditeurPiece` | rectangle ou mur par mur, ouvertures avec valeurs par défaut (porte 83 × 204), duplication |
| `DetailCalcul` | affiche chaque étape du calcul de surface et de peinture |
| `ChoixPots` | combinaison retenue, alternatives comparées, reste |
| `ListeAchat` | regroupement par produit, teinte et format ; PDF ; partage par message |
| `EditeurLignes` | sections, lignes, sous-totaux, remises, options, réordonnancement |
| `RecapTVA` | ventilation par taux ou mention de franchise |
| `PadSignature` | tracé au doigt, nom, mention, affichage du document signé |
| `StatutDocument` | statut dérivé avec couleur et libellé français |
| `SaisieHorsConnexion` | bandeau de coupure réseau et garde locale de la saisie en cours |
| `JaugeSeuils` | masquée tant que les seuils n'ont pas été saisis et confirmés |
| `EditeurEcheancier` | échéances en % avec déclencheur (signature, début, mi-chantier, fin, date) ; total ≤ 100 % |
| `ComparatifVersions` | différences ligne à ligne entre deux versions d'un devis |
| `AlertePrix` | « Le prix de ce produit a changé depuis le devis » (prix courant ≠ prix retenu) |
| `SaisieTemps` | heures du jour sur un chantier, en deux touches |
| `Rentabilite` | marge prévue vs réelle (matière + temps) |
| `Calendrier` | jour / semaine / mois, durées issues du calculateur |
| `GalerieAvantApres` | comparaison avant / après, export pour le portfolio |
| `QRVirement` | QR code de virement (IBAN, montant, référence de facture) |
| `ApercuImportCSV` | erreurs ligne par ligne avant validation |
| `CentreNotifications` | rappels à venir et passés |

PDF : `DevisPDF`, `FacturePDF` (acompte, situation, finale, avoir), `ListeAchatPDF`, `PVReceptionPDF`, `FormulaireRetractationPDF`, `AttestationTVAPDF` (assujetti seulement).

Charte : doré en dégradé (#B8860B → #E6C068), anthracite (#1F1F1F), blanc cassé (#FAF8F4). **Le doré n'est jamais une couleur de texte sur fond clair** (contraste insuffisant au soleil) : il sert aux aplats, filets et logo. Les contrastes sont vérifiés par un test.

---

## 7. Plan de tests

| Niveau | Outil | Contenu | Quand |
|---|---|---|---|
| Domaine | Vitest | Tous les cas de la §6 du cahier des charges, **attendus calculés à la main** et écrits en dur : 31,9268 m², 12,00 m², 7,0239 L, pots 5 + 2,5 L comparés à 10 L, TVA 100,00 / 130,00 / 20,00 €, finale 3 850,00 €. Cas limites : zéro, valeurs négatives, ouvertures plus grandes que le mur, mur par mur, pièces dupliquées, rendement nul, franchise. Tests de propriétés : HT + TVA = TTC sur 10 000 devis aléatoires. | Phases 2, 4, 5 |
| Base | `tests/db/` (Postgres réel) | RLS, isolation A / B, immuabilité, numérotation concurrente (50 en parallèle), contrôles d'émission. **204 tests (dont les 9 invariants globaux I1 à I9) et 4 tests de concurrence passent (Phase 1, 08/10/2026), dans les deux modes : schéma auth simulé et vrai schéma GoTrue.** | Dès maintenant, puis à chaque migration |
| Supabase local | `supabase start` (Docker) | Mêmes tests sur la vraie pile : Auth, Storage, PostgREST | Phase 1, intégration continue |
| Serveur | Vitest | Server Actions : zod refuse les entrées invalides, session exigée, aucun montant venant du client sans recalcul | Toutes les phases |
| PDF | Vitest + extraction de texte | Chaque mention obligatoire présente dans le PDF réel : grille de l'auditeur-légal, franchise et assujetti, particulier et professionnel, hors établissement | Phases 4, 5, 7 |
| Parcours | Playwright, viewport mobile (iPhone 13) | Les 12 parcours du testeur-chantier, chronométrés (devis de 4 pièces en moins de 5 minutes) | Phases 1 à 8 |
| Accessibilité | Playwright + axe | Contraste, libellés, cibles de 44 px | Phases 1 à 8 |
| Qualité | `tsc --noEmit`, ESLint, `next build`, `npm audit` | Zéro erreur, zéro warning | À chaque commit (GitHub Actions) |

---

## 8. Sécurité et RGPD (résumé)

- **Authentification :**
  - inscription publique désactivée ;
  - mot de passe d'au moins 12 caractères ;
  - TOTP proposé ;
  - cookies HttpOnly, Secure et SameSite gérés par `@supabase/ssr` ;
  - limitation des tentatives par Supabase Auth.
- **Autorisation :**
  - RLS sur chaque table ;
  - privilèges de colonne pour les champs de cycle de vie ;
  - fonctions `SECURITY DEFINER` qui vérifient elles-mêmes l'appartenance, avec un `search_path` fixé (vérifié par un test).
- **Liens publics :**
  - jeton de 256 bits ;
  - **seule son empreinte SHA-256 est stockée** ;
  - expiration ;
  - usage unique pour la signature (verrou de ligne) ;
  - même message d'erreur quelle que soit la cause ;
  - fonctions appelables par le serveur seulement, pour que l'IP enregistrée soit celle relevée par le serveur, pas celle déclarée par le navigateur.
- **Fichiers :**
  - 5 buckets privés avec type MIME et taille limités ;
  - noms aléatoires, préfixés par l'organisation ;
  - URL signées de quelques minutes ;
  - ni suppression ni remplacement des PDF émis et des signatures.
- **En-têtes :** CSP stricte, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- **RGPD :**
  - registre des traitements (une page) ;
  - mentions d'information sur le devis et la page publique ;
  - export JSON / CSV d'un client ;
  - anonymisation : les documents émis gardent leur copie figée au titre de l'obligation de conservation, dont la durée est À VÉRIFIER (10 ans pour les pièces comptables) ;
  - aucune donnée personnelle dans les logs.
- **Sauvegardes :**
  - sauvegardes quotidiennes Supabase (offre payante) ;
  - export hebdomadaire chiffré des PDF et de la base vers un second stockage ;
  - **restauration testée en Phase 8**.

- **Reporté en Phase 1, car non vérifiable sans application** (relevé par l'audit sécurité de Phase 0) :
  - `supabase/config.toml` versionné : inscription désactivée, mot de passe d'au moins 12 caractères, durée du JWT, limitation des tentatives, TOTP ;
  - en-têtes CSP et anti-iframe ;
  - zod sur chaque Server Action ;
  - vérification de la signature binaire des images déposées ;
  - durée de conservation des prospects et clients sans document, et purge planifiée ;
  - registre des traitements et mentions d'information ;
  - `npm audit`.

---

## 9. Plan des phases (ajusté)

| Phase | Contenu | Agents |
|---|---|---|
| 1 Fondations | Projet Next, Supabase local et distant, migrations, auth + TOTP, Paramètres, clients, numérotation, journal, PWA installable (sans hors-ligne), CI | securite-rgpd, relecteur-code, testeur-chantier |
| 2 Métré et calculateur | Chantiers, pièces, ouvertures, éléments, `src/domain` surfaces / peinture / pots, préparation, liste d'achat + PDF | qa-calculs, auditeur-peinture, relecteur-code, testeur-chantier |
| 3 Catalogue | Produits, import / export CSV, teintes, historique des prix, alerte de changement de prix, prestations | auditeur-peinture, qa-calculs, relecteur-code |
| 4 Devis | Éditeur, PDF conforme, formulaire de rétractation, signature sur place et à distance, Resend, relances, versions | qa-calculs, auditeur-legal, securite-rgpd, relecteur-code, testeur-chantier |
| 5 Factures | Acompte, situation, finale, avoir, paiements, relances d'impayés, QR code de virement, données Factur-X, Stripe (si tu le veux) | qa-calculs, auditeur-legal, securite-rgpd, relecteur-code, testeur-chantier |
| 6 Pilotage | Tableau de bord, seuils, planning et ICS, recettes, achats, matériel, exports | qa-calculs, relecteur-code, testeur-chantier |
| 7 Documents | PV de réception, galerie avant / après, avis Google, notifications | auditeur-legal, securite-rgpd, relecteur-code, testeur-chantier |
| 8 Recette | Données de démonstration, parcours de bout en bout, guide de Yorick, guide de déploiement, check-list « avant la première vraie facture » | tous |

---

## 10. Ce qui attend une décision ou une information

### Décisions prises le 08/10/2026 (propositions par défaut validées par le directeur)
- Rappels et notifications : **dans l'application** (canal par défaut).
- Temps passé : saisi **par jour et par chantier**.
- Échéancier : **en pourcentages** avec déclencheurs.
- Agent testeur-chantier : parcours 10 remplacé par « coupure réseau pendant la saisie : aucune perte ».
- P23 : une facture « libre » (travaux supplémentaires) **ne solde pas** le devis du chantier.
- Annulation d'une finale qui déduisait des acomptes : avoir sur le **net**, acomptes **re-déductibles** (à confirmer par le comptable, point 17).
- Attestation de TVA **signée** d'un devis non accepté : **conservée** comme preuve, même après anonymisation (durée à confirmer par le comptable, point 18).

### Toi (directeur) : encore ouvert
1. ~~Créer le dépôt GitHub `hdecor`~~ : **fait** (fratellicut-cmd/hdecor).
2. **Comptes Supabase et Vercel.** Attention :
   - l'offre gratuite de Vercel (« Hobby ») serait réservée à un **usage non commercial** selon leurs conditions (**À VÉRIFIER** sur leurs conditions actuelles). H'DECOR est un usage commercial, il faudrait donc l'offre Pro ;
   - l'offre gratuite de Supabase **met le projet en pause** après une période d'inactivité et n'inclut pas les sauvegardes quotidiennes.

   **Je recommande les deux offres payantes avant la première vraie facture.** Les tarifs exacts sont À VÉRIFIER sur leurs sites.
3. **Nom de domaine** (par exemple `hdecor.fr`, si disponible) : il en faut un pour envoyer les emails depuis Resend sans finir en spam (configuration DNS).
4. **Versions de devis :** même numéro avec « v2 » (choix par défaut, appliqué) ou nouveau numéro ?
5. **Stripe :** le garder pour la Phase 5, ou se contenter du QR code de virement ? Ça a un coût par transaction, et en franchise, chaque euro de frais compte.

(Rappels, temps passé, échéancier et agent testeur : tranchés, voir « Décisions prises » ci-dessus.)

### Yorick (à saisir dans l'application en Phase 1, rien en dur)
SIRET, immatriculation, assurances décennale et RC Pro (assureur, contrat, période, zone), médiateur de la consommation, IBAN / BIC, logo en haute qualité, taux horaire, marge, taux des pénalités de retard, fournisseurs et tarifs, anciens devis et factures servant de modèles.

### À FAIRE VALIDER PAR LE COMPTABLE
Rien de ce qui suit n'est affirmé comme vrai : ce sont des points à confirmer avant la première vraie facture.
1. **Libellé exact de la mention de franchise** (« TVA non applicable, art. 293 B du CGI »), stocké comme modifiable et marqué À VÉRIFIER.
2. **Seuils de la micro-entreprise et de la franchise de TVA en vigueur**, et règle applicable en cas de dépassement en cours d'année. **Aucune valeur n'est préremplie** : la jauge reste masquée tant qu'ils ne sont pas saisis.
3. **Contrat signé chez le client (hors établissement) :**
   - droit de rétractation de 14 jours et formulaire joint ;
   - **possible interdiction de recevoir un paiement avant un délai de 7 jours après la signature**. Si elle s'applique, elle conditionne la facture d'acompte : l'application avertira, elle ne bloquera pas tant que ce n'est pas confirmé ;
   - cas d'un client qui demande que les travaux commencent pendant le délai de rétractation.
4. **Indemnité forfaitaire de 40 €** : elle viserait les clients professionnels. Faut-il l'afficher sur les factures adressées à des particuliers ?
5. **Mentions propres à l'EI et à l'artisan** (mention « EI », immatriculation RNE / RM) et mentions d'assurance sur les devis et les factures.
6. **Taux des pénalités de retard** : aucune valeur par défaut. C'est un champ obligatoire avant la première facture.
7. **Arrondi commercial** (demi supérieur, règle R10) et méthode de TVA par taux (R6).
8. **Facturation électronique :**
   - réception obligatoire depuis septembre 2026 ;
   - émission prévue en septembre 2027 pour les petites entreprises ;
   - e-reporting pour les clients particuliers ;
   - choix de la plateforme agréée.

   L'application prépare les données Factur-X ; le calendrier et la plateforme sont à confirmer.
9. **Durées de conservation** des factures et des pièces (10 ans pour les pièces comptables) et anonymisation RGPD compatible.
10. **Mention « devis reçu avant l'exécution des travaux »** : obligation et libellé.
11. **Autoliquidation en sous-traitance du bâtiment** : applicabilité (a priori sans objet en franchise de TVA) et mention.
12. **Attestations de TVA à taux réduit** : formulaires et conditions en vigueur (sans objet en franchise, à préparer pour une éventuelle bascule). Aucun taux n'est codé en dur : un taux paramétré porte le drapeau « attestation requise ».
13. **Avoir sur une facture déjà payée** : modalités de remboursement et écriture dans le livre des recettes (l'application enregistre le remboursement en négatif).
14. **Délai de paiement maximal** : plafond légal applicable (paramètre `delai_paiement_max_jours`, 60 jours par défaut, À VÉRIFIER).
15. **Durée de conservation du journal d'audit** (purge paramétrable, au moins un an).
16. **Geste commercial après facture** : avoir de réduction (choix de l'application) ou autre traitement, et effet sur le chiffre d'affaires et le livre des recettes.
17. **Annulation d'une facture finale qui déduisait des acomptes** : avoir sur le net à payer et acomptes re-déduits sur la nouvelle finale (choix de l'application).
18. **Durée de conservation d'une attestation de TVA signée** pour un devis finalement refusé.

---

## 11. Risques identifiés

| Risque | Mesure |
|---|---|
| Une donnée légale fausse sur un PDF | Rien n'est en dur ; drapeaux À VÉRIFIER ; grille de l'auditeur-légal sur le PDF réel ; validation par le comptable avant la première facture |
| Erreur d'arrondi | Entiers partout ; une seule implémentation ; attendus calculés à la main ; contrôle en base à l'émission |
| Fuite entre organisations | RLS, FK composites (y compris liens publics), tests d'isolation dans l'intégration continue |
| Montant falsifié par un bug d'interface | Totaux recontrôlés en base contre les lignes à l'émission et à la signature |
| Facture modifiée après émission | Triggers, privilèges de colonne, bucket sans suppression, journal |
| Perte de données | Sauvegardes payantes, second export, restauration testée |
| Coupure réseau sur chantier | Enregistrement à chaque champ, garde locale de la saisie en cours (hors-ligne complet retiré par décision) |
| Valeur probante de la signature faite maison | Dossier de preuve complet (empreinte, horodatage, IP, PDF archivé). Moins fort qu'un prestataire qualifié : c'est ton choix, documenté |
| Agents qui partagent les angles morts du codeur | Attendus calculés à la main ; comptable et fiches techniques en dernier recours |
| Émissions simultanées (deux onglets, double envoi) | Verrous : devis, facture d'origine, acomptes déduits et chantier (lecture partagée), dans un ordre stable. Une attestation ne se signe que pour un devis envoyé ou accepté. Quatre tests de concurrence réels (numérotation, puis trois courses à l'émission), plus les invariants globaux contrôlés après chacun |
| Finale qui déduit un acompte partiellement corrigé par avoir | Pas de sur-facturation (le reste à facturer apparaît), mais le document peut dérouter. À cadrer en Phase 5 avec le comptable (point 17) : interdire, ou expliquer à l'écran |
| Avoir de réduction égal au net d'une facture | Il annule la facture et libère ses acomptes, tout en restant acquis. Les chiffres sont cohérents ; l'écran devra l'expliquer (Phase 5) |
| Finale entièrement couverte par les acomptes (net = 0) | Elle ne peut pas être annulée par avoir (plafond = net). Cas rare, à traiter en Phase 5 |
