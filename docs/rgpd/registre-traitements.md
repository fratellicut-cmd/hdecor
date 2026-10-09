# Registre des activités de traitement : H'DECOR EI

> Document de travail établi par l'équipe technique le 08/10/2026. **À FAIRE VALIDER** par Yorick et son comptable (et, si besoin, un conseil RGPD). Toute ligne marquée **À VÉRIFIER** n'est pas confirmée.

## Responsable du traitement

- **Identité :** H'DECOR EI, représentée par son dirigeant. Coordonnées : Paramètres > Entreprise, reprises sur chaque devis et facture.
- **Délégué à la protection des données :** aucun désigné (entreprise individuelle, pas de traitement à grande échelle). **À VÉRIFIER**

## Traitement 1 : gestion des clients et prospects

| Rubrique | Contenu |
|---|---|
| Finalités | Établir des devis, réaliser et suivre les chantiers, facturer, encaisser, relancer. |
| Base légale | Mesures précontractuelles et exécution du contrat (devis, chantier). Obligation légale (facturation, comptabilité). Intérêt légitime (suivi d'un prospect sans devis). **À VÉRIFIER** |
| Personnes concernées | Clients particuliers et professionnels (personnes de contact), prospects. |
| Données | Civilité, nom, prénom, raison sociale, SIRET, n° de TVA, email, téléphone, adresse de facturation, adresse de chantier, notes, provenance du contact, documents (devis, factures, paiements), photos de chantier, signature et sa preuve (nom, tracé, date et heure, adresse IP, navigateur, empreinte du devis, options retenues). **Aucune donnée sensible** : le champ « Notes » le rappelle. |
| Destinataires | Le dirigeant (seul utilisateur). Le comptable (exports). Les sous-traitants techniques ci-dessous. |
| Durée : prospect ou client **sans facture émise ni devis accepté** (aucun devis, devis refusé, remplacé ou expiré, chantier non facturé) | Anonymisation automatique après **36 mois** sans activité sur la fiche, ses devis et ses chantiers (durée paramétrable dans Paramètres > Conditions, **À VÉRIFIER**). La tâche planifiée tourne chaque nuit (`/api/cron/conservation`). **Elle ne purge rien tant que cette durée n'est pas confirmée**, car la purge est irréversible. Les PDF des devis non acceptés et les photos sont supprimés du stockage. |
| Durée : factures émises, devis acceptés, signatures | Conservées telles qu'émises au titre de l'obligation de conservation des pièces comptables (**10 ans, À VÉRIFIER** par le comptable). Ces pièces ne sont pas effacées par une demande d'effacement. |
| Durée : attestation de TVA signée d'un devis refusé | Conservée comme preuve (décision du 08/10/2026), durée **À VÉRIFIER** par le comptable. |
| Mesures de sécurité | Voir la section « Mesures de sécurité » plus bas. |

## Traitement 2 : journal des actions (traçabilité)

| Rubrique | Contenu |
|---|---|
| Finalité | Prouver qui a créé, modifié ou supprimé un document, et quand (intégrité de la facturation). |
| Base légale | Intérêt légitime et obligation de sécurité. **À VÉRIFIER** |
| Données | Identifiant du compte, date, type d'action, table, identifiant de la ligne, et seulement les champs **non personnels** (liste blanche : numéros, statuts, montants, dates, taux). Ni nom, ni adresse, ni téléphone, ni adresse IP. |
| Durée | Au moins 1 an (minimum imposé par la base). Durée de purge **À VÉRIFIER**. |

## Traitement 3 : compte utilisateur (authentification)

| Rubrique | Contenu |
|---|---|
| Finalité | Accès sécurisé à l'application (un seul utilisateur). |
| Données | Email, empreinte du mot de passe (gérée par Supabase Auth), facteur de double authentification (TOTP), journaux de connexion de Supabase. |
| Durée | Tant que le compte existe. |

## Sous-traitants (article 28)

| Sous-traitant | Rôle | Localisation | Statut |
|---|---|---|---|
| Supabase | Base de données, authentification, stockage des fichiers | Région UE prévue (Paris ou Francfort) | **À VÉRIFIER** à la création du projet de production ; contrat de sous-traitance (DPA) à accepter |
| Vercel | Hébergement de l'application | Région `cdg1` (Paris) prévue pour les fonctions | **À VÉRIFIER** ; DPA à accepter |
| Resend | Envoi des emails (devis, factures, relance de devis, 3 rappels d'impayés) : email, nom du client, lien du document, montant dû d'une facture | **États-Unis : transfert hors UE, région d'envoi et clauses contractuelles types À VÉRIFIER** | Utilisé depuis la phase 4 si `RESEND_API_KEY` est configurée ; suivi des clics désactivé |
| Stripe (facultatif, inactif sans clés) | Paiement par carte d'une facture (page de paiement Stripe) : numéro et montant de la facture, données de paiement saisies par le client (jamais vues par l'application) | **États-Unis : transfert hors UE, contrat et garanties À VÉRIFIER avant activation** | Webhook signé ; l'adresse de retour ne contient pas le jeton du lien |

## Mesures de sécurité

- **Accès :**
  - un seul compte, inscription publique fermée ;
  - mot de passe d'au moins 12 caractères ;
  - double authentification proposée et, une fois activée, **imposée par la base** (RLS).
- **Cloisonnement :** la RLS est activée sur chaque table, et chaque ligne est rattachée à une organisation (testé automatiquement).
- **Fichiers :**
  - espaces de stockage privés ;
  - chemins préfixés par l'organisation ;
  - liens signés à durée courte.
- **En-têtes :** CSP stricte avec nonce, interdiction d'afficher l'application dans un cadre, Referrer-Policy et Permissions-Policy.
- **Journal :** liste blanche, aucune donnée personnelle (testé automatiquement).
- **Saisie gardée sur le téléphone en cas de coupure :**
  - elle est stockée localement (navigateur) ;
  - effacée après enregistrement, après l'effacement du client, à la déconnexion volontaire ;
  - dans tous les cas, au bout de **24 heures** au plus : les brouillons expirés sont purgés à chaque ouverture de l'application.

## Exercice des droits

| Droit | Comment |
|---|---|
| Accès et portabilité | Fiche client > « Exporter les données de ce client » (fichier JSON). Il contient la fiche, les chantiers, les devis (lignes, échéances), les factures (lignes, paiements), les PV, attestations, signatures, envois, photos et documents. Les fichiers eux-mêmes (PDF, photos) sont désignés par leur nom et transmis à part. |
| Rectification | Fiche client > Modifier. |
| Effacement | Fiche client > « Effacer ce client » (anonymisation définitive : la fiche ne peut plus être modifiée ni « restaurée », règle imposée par la base). Les fichiers sont supprimés du stockage ; en cas d'échec, reprise automatique chaque nuit (10 tentatives, puis alerte). Les pièces comptables sont conservées. |
| Réclamation | Auprès de la CNIL (www.cnil.fr). |
| Délai de réponse | Délai légal d'un mois. **À VÉRIFIER** |

## Information des personnes

Page publique `/confidentialite`. Son adresse est imprimée sur chaque devis ; la page publique de signature et l'écran de signature sur place affichent une information au moment de la collecte (données de preuve) avec un lien vers elle.
