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
| Données | Civilité, nom, prénom, raison sociale, SIRET, n° de TVA, email, téléphone, adresse de facturation, adresse de chantier, notes, provenance du contact, documents (devis, factures, paiements), photos de chantier, signature (à partir de la phase Devis). **Aucune donnée sensible** : le champ « Notes » le rappelle. |
| Destinataires | Le dirigeant (seul utilisateur). Le comptable (exports). Les sous-traitants techniques ci-dessous. |
| Durée : prospect sans devis, facture ni chantier | Anonymisation automatique après **36 mois** sans activité (durée paramétrable dans Paramètres > Conditions, **À VÉRIFIER**). Tâche planifiée chaque nuit (`/api/cron/conservation`). |
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
| Resend | Envoi des emails (devis, factures) | **À VÉRIFIER** | Phase 4, pas encore utilisé |

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
  - elle est stockée localement ;
  - effacée après enregistrement, à la déconnexion, et au bout de 7 jours au plus.

## Exercice des droits

| Droit | Comment |
|---|---|
| Accès et portabilité | Fiche client > « Exporter les données de ce client » (fichier JSON). |
| Rectification | Fiche client > Modifier. |
| Effacement | Fiche client > « Effacer ce client » (anonymisation). Les fichiers sont supprimés du stockage ; en cas d'échec, une reprise automatique a lieu chaque nuit. Les pièces comptables sont conservées. |
| Réclamation | Auprès de la CNIL (www.cnil.fr). |
| Délai de réponse | Délai légal d'un mois. **À VÉRIFIER** |

## Information des personnes

Page publique `/confidentialite`. Un lien vers cette page figurera sur les devis et la page de consultation publique (Phase 4).
