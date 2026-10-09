# Points reportés : suivi entre les phases

Points relevés par les agents de contrôle, acceptés pour la phase en cours mais **à traiter** à la phase indiquée. Chaque phase relit ce fichier à son cadrage.

| Origine | Point | Phase cible |
|---|---|---|
| Sécurité B11 | La suppression d'un chantier supprime en cascade `photos` et `documents_chantier` sans mettre leurs fichiers dans `fichiers_a_supprimer` : les fichiers restent orphelins dans le stockage. **Traité en Phase 2** : `supprimer_chantier` les met en file avant la suppression. | Fait |
| Sécurité (boucle 3) | La politique `hdecor_suppr` laisse une session supprimer des fichiers de l'espace `justificatifs`. Il faut protéger les justificatifs comptables (`depenses.justificatif_chemin`) comme les PDF émis. | 6 (pilotage) |
| Sécurité M4 | La limitation des tentatives de connexion et d'envoi d'emails se fait sur l'IP du serveur, pas sur celle du visiteur. Prévoir une limite applicative par IP cliente et par email, et un SMTP dédié. | Avant mise en production |
| Sécurité B5 | Pas de durée maximale ni de délai d'inactivité de session (`[auth.sessions]`, offre Pro), ou redemander l'authentification avant les actions sensibles. | Avant mise en production |
| Sécurité B7 | Actions GitHub non épinglées par empreinte (SHA). | Avant mise en production |
| Sécurité B10 | La purge du journal d'audit n'est pas planifiée, la durée étant À VÉRIFIER par le comptable. | Après validation de la durée |
| Fichiers | `src/lib/fichiers.ts` (signature binaire) doit être branché sur le premier dépôt de fichier (logo, photos). | 2 ou 7 |
| Logo | Dépôt du logo officiel. Le service de stockage local est indisponible dans l'environnement de développement actuel. | 7 (documents) |
| Testeur (confort) | Les points suivants sont du confort, à reprendre plus tard : bouton Itinéraire ; ville proposée à partir du code postal ; bouton Enregistrer collant sur Conditions ; annulation d'une confirmation de taux de TVA ; message « Assurance supprimée » ; message français si la case de confirmation n'est pas cochée ; champs date à vérifier sur un vrai Android. | 2 à 8 |
| Testeur | Déconnexion inattendue observée une fois après une 4G faible, non reproduite (probablement une autre session sur le même compte de test). À surveiller. | Suivi |
| Phase 2 (calcul) | Matière des étapes de préparation : chiffrée par TYPE de produit (rendement du référentiel). Le choix d'un produit précis du catalogue et de sa consommation au m² arrive avec le catalogue. | 3 (catalogue) |
| Phase 2 (calcul) | Teinte : saisie libre tant que le catalogue des teintes est vide ; la reprendre dans le catalogue. | 3 (catalogue) |
| Phase 2 (devis) | Le poste de peinture et la liste d'achat ne sont pas encore repris dans un devis : vérifier à la Phase 4 que la quantité du devis est la valeur affichée (R1) et que matière et liste restent cohérentes. | 4 (devis) |
| Phase 2 (photos) | Dépôt de photos de chantier non livré (stockage local indisponible) ; brancher `src/lib/fichiers.ts` à ce moment-là. | 7 (documents) |
| Phase 2 (relecture) | Liste des chantiers limitée à 200 sans pagination. | 6 (pilotage) |
| Phase 2 (relecture) | Migrations sans script de retour arrière (sauvegarde avant chaque mise en production). | Avant mise en production |
| Phase 2 (testeur) | Pièce en L : la surface au sol se calcule à la main (mode mur par mur). Prévoir une forme « deux rectangles ». | 3 ou plus tard |
| Phase 2 (testeur, confort) | Modifier une ouverture ou un élément (aujourd'hui : retirer puis ressaisir) ; alerte d'aperçu pour une valeur hors de l'ordinaire (mur de 85 m saisi en cm) ; « Pièce humide » au niveau de la pièce ; badge À VÉRIFIER plus grand ; recherche dans la liste des clients. | 3 à 8 |
| Phase 2 (audit métier, boucle 2) | Formats de pots par défaut identiques pour tous les liquides : une laque, une lasure ou un antirouille peut être proposée en 10 ou 15 L. Formats par type de produit (ou ceux du catalogue). | 3 (catalogue) |
| Phase 2 (audit métier, boucle 2) | Planning du séchage : seules les couches de finition sont comptées ; séchage impression -> finition et entre passes d'enduit absent ; le total affiche le plus long séchage d'un poste, pas la somme du planning. | 6 (pilotage) |
| Phase 2 (audit métier, boucle 2) | Rebouchage et bande à joint : matière non chiffrable (consommation forfaitaire par étape ou consommable à prévoir) ; le prix de vente reste « incomplet » tant qu'ils sont cochés. | 3 (catalogue) |
| Phase 2 (audit métier, boucle 2) | Matière d'étape avec produit du catalogue : couches de l'étape et coefficient de support non appliqués à la consommation au m². | 3 (catalogue) |
| Phase 2 (audit métier, boucle 2) | Contrôles à ajouter : finition du produit / du poste ; élément « façade » sans case Extérieur ; façade sur enduit ou béton sans fixateur ; carrelage avec impression générique ; avertissement métal malgré un poste antirouille ; alerte de hauteur des éléments (hauteur de la pièce). | 3 (catalogue) |
| Phase 2 (testeur, boucle 2) | Support par défaut « Ancienne peinture » aussi pour les plafonds (rappels d'accrochage) : choisir un défaut par cible. | 3 |
| Phase 2 (audit métier, boucle 3) | Pots sans prix, petits formats chers (laques 0,5 / 2,5 L) : « le moins de pots » peut surestimer l'achat (3,30 L -> 2 × 2,5 L). Tolérance de reste paramétrable ou prix obligatoires au catalogue ; alternatives à plusieurs formats. | 3 (catalogue) |
| Phase 2 (audit métier, boucle 3) | Enduit : valeur de départ 1 m²/kg par passe, probablement prudente pour un lissage (fiches : 0,45 à 0,70 kg/m²). À régler sur la fiche du produit utilisé. | Validation de Yorick |
| Phase 2 (relecture, boucle 3) | Renvoi après réponse perdue AVEC une saisie corrigée entre-temps : la première version est gardée (upsert sans mise à jour), sans message. Comparer avec la fiche existante et prévenir. | 3 |
| Phase 2 (relecture, boucle 3) | Migrations 20261010000100 et 0300 modifiées en place avant tout déploiement : toute base locale qui les a appliquées doit être recréée (`npm run local:start`). À partir du premier déploiement, une nouvelle migration pour chaque changement. | Avant mise en production |

## Bilan de la Phase 3 (catalogue) sur les points ci-dessus

| Point | État |
|---|---|
| Matière d'étape avec produit du catalogue (couches, coefficient de support) | **Fait** : Réglages de calcul > Temps de préparation > « Matière par produit du catalogue ». |
| Rebouchage et bande à joint non chiffrables | **En partie** : enduit de rebouchage ou à joint chiffré par produit du catalogue + consommation par m² et par passe. La bande (vendue au mètre) relève des consommables. |
| Formats par type de produit | **Fait** : Réglages de calcul > Rendements par type > « Formats usuels ». |
| Teinte libre -> catalogue | **Fait** : nuancier ; teinte associable à la pièce et au chantier, proposée d'office sur un nouveau poste. La saisie libre reste possible. |
| Contrôles finition produit / poste, façade sans « Extérieur », façade sur béton ou enduit, carrelage, hauteur des éléments | **Fait**. |
| Pots, petits formats chers | **En partie** : les prix du catalogue font choisir au coût. Alternatives à plusieurs formats affichées : à faire. | 
| Avertissement métal malgré un poste antirouille sur le même élément | Reporté : 4 (devis, regroupement des postes). |
| Pièce en L, modification d'une ouverture, alertes d'aperçu, « Pièce humide » au niveau de la pièce, support par défaut selon la cible | Reporté : 8 (recette, confort). |
| Recherche dans la liste des clients (création de chantier) | Reporté : 4 (devis : même sélecteur). |
| Renvoi après réponse perdue avec une saisie corrigée | Reporté : 4. |
| Phase 3 (relecture interne) | L'alerte de prix compare le prix retenu dans un devis au prix actuel : effective quand les devis existeront (Phase 4) ; testée en SQL. |
| Phase 3 (audits, boucle 1) | Codes RAL et NCS : texte libre, sans contrôle de format (RAL Classic à 4 chiffres, NCS « S 0502-Y »). | 8 (recette) |
| Phase 3 (audits, boucle 1) | Formats usuels par type : choix d'achat, sans effet sur le statut « À VÉRIFIER » du référentiel (ce ne sont pas des données techniques). | Décision |
| Phase 3 (audits, boucle 1) | Matière d'étape portée par un produit : consommation saisie « pertes comprises », sans marge de perte ajoutée (la marge s'applique au chemin « type de produit »). | Décision, à confirmer par Yorick |


## Phase 4 (devis) : points reportés et questions ouvertes

| Origine | Point | Phase / décideur |
|---|---|---|
| Phase 4 (audit légal, boucle 1) | Attestation de TVA à taux réduit (taux marqués « attestation requise ») : signalée à l'émission, PAS encore produite par l'application (formulaire et conditions À VÉRIFIER, point 12 du comptable). | 7 (documents) |
| Phase 4 (audit légal, boucle 1) | Hors établissement : paiement demandé à la signature et début des travaux dans les 14 jours sont SIGNALÉS à l'émission (non bloquants) en attendant la règle confirmée (point 3 du comptable). Si l'interdiction d'encaisser s'applique, bloquer la facture d'acompte. | Comptable, puis 5 (factures) |
| Phase 4 (audit légal, boucle 1) | À faire valider : coordonnées de l'assureur sur le devis ; RC Pro obligatoire ou non sur le devis d'un peintre ; point de départ du délai de rétractation (« à compter de la signature ») ; libellé « Net à payer » en franchise ; formulaire de rétractation conforme au modèle en vigueur ; mention de la version (« annule et remplace la version 1 ») ; prix des options en TTC pour un particulier. | Comptable |
| Phase 4 (audit légal, boucle 1) | Textes légaux types (rétractation, exécution anticipée, « devis reçu avant l'exécution des travaux », médiateur) dans le code, marqués À VÉRIFIER et confirmés à chaque émission : les rendre modifiables dans les Paramètres après validation du comptable. | 7 (documents) |
| Phase 4 (calculs, boucle 1) | Acompte et échéancier imprimés calculés hors options (précisé sur le PDF) ; la facture d'acompte devra partir du montant ACCEPTÉ (options retenues). | 5 (factures) |
| Phase 4 (calculs, boucle 1) | Reprise d'un poste : PU arrondi au centime, écart de ±0,5 centime par m² avec le prix de vente interne. Jugé acceptable ; afficher l'écart à la reprise. | 8 (recette, confort) |
| Phase 4 (sécurité, boucle 1) | Limitation du débit des pages publiques /d (par jeton et par IP) : à mettre en place côté hébergeur (Vercel Firewall) avant l'ouverture au public. Les envois refusés ne déposent plus de fichier. | Avant mise en production |
| Phase 4 (sécurité, boucle 1) | Statut « consulté » : un antivirus de messagerie qui ouvre le lien le déclenche aussi. | Connu, sans action |
| Phase 4 (test terrain, boucle 1) | Recherche dans la liste des devis ; versions remplacées masquées du filtre « Tous ». | 8 (recette) |
| Phase 4 (relecture, boucle 1) | Taux de TVA proposé à la reprise des postes : le premier taux actif (souvent 20 %) ; à rendre paramétrable (taux par défaut des travaux). | 6 |
| Phase 4 (audit légal, boucle 2) | Signal « début des travaux pendant les 14 jours » calculé depuis la date d'ÉMISSION ; le délai court depuis la SIGNATURE. À recontrôler à la signature et à la facture d'acompte. Les échéances « à une date » ou « début des travaux » tombant dans le délai ne sont pas encore signalées. | 5 (factures) |
| Phase 4 (sécurité, boucle 2) | Envoi par email : deux requêtes STRICTEMENT simultanées du même formulaire (rejeu réseau) peuvent envoyer deux emails (contrôle puis action sans verrou ; le bouton est désactivé pendant l'envoi). Réserver l'envoi en base avant l'email. | 5 (factures, même mécanisme d'envoi) |
| Phase 4 (sécurité, boucle 2) | `npm audit` : 0 vulnérabilité en production ; 5 « high » dans la chaîne de développement eslint-config-next (déjà suivi dans docs/securite/dependances.md). | Suivi |
| Phase 4 (relecture, boucle 2) | Relances planifiées sans verrou : deux exécutions simultanées pourraient relancer deux fois (rare sur Vercel). | Avant mise en production |
| Phase 4 (test terrain, boucle 2) | Lien direct vers la fiche produit fautive depuis une ligne « prix à compléter » ; bouton en un geste « acompte -> début des travaux » depuis le signal de rétractation. | 8 (recette, confort) |
| Phase 4 (audit légal, boucle 3) | Mention « Bon pour accord » saisie au clavier (casse et ponctuation libres, conservée telle que tapée) acceptée comme équivalent de la mention manuscrite : force probante à confirmer. Le contrôle du texte est fait par le serveur (zod), pas par la base. | Comptable |
| Phase 4 (calculs et relecture, boucle 3) | Migration 20261014000100_devis_corrections.sql modifiée sur place avant tout déploiement : toute base locale qui l'a appliquée doit être recréée (`npm run local:start`). Après le premier déploiement, une nouvelle migration par changement. | Avant mise en production |
| Phase 4 (sécurité, boucle 3) | Signature dont l'issue est incertaine (réponse perdue) : le tracé est désormais toujours gardé ; un tracé réellement inutilisé reste en stockage (à purger par la file des fichiers orphelins). | 7 (documents) |

## Phase 5 (factures et paiements) : points reportés et questions ouvertes

| Origine | Point | Phase / décideur |
|---|---|---|
| Phase 5 (calculs, boucle 1) | Avoir d'un MONTANT précis : la répartition par taux recherche une base exacte au centime ; si aucune n'existe (fréquent avec plusieurs taux : environ un montant sur quatre), l'application le dit (aucun arrondi caché) et propose un centime de plus ou de moins. L'avoir de TOUT le reste dû (premier avoir) reprend les lignes ET les acomptes déduits de la facture : toujours exact. Après un premier avoir partiel, le solde passe par la répartition (peut demander un centime d'ajustement). | Connu, 8 (confort) |
| Phase 5 (calculs, boucle 1) | Facture d'acompte ou de situation : une correction se fait en totalité (avoir total, puis nouvelle facture), sinon la facture finale ne retomberait plus sur le total accepté ; contrôlé par la base. Avoir de réduction (geste commercial) partiel toujours possible. | Fait |
| Phase 5 (calculs, boucle 1) | Avancement d'une ligne de situation en recul par rapport à la précédente : seul le total est contrôlé ; un avoir d'un montant sur une telle situation est refusé explicitement (taux négatif). | 8 (recette) |
| Phase 5 (calculs, boucle 1) | Déductions figées à la création d'un brouillon de finale : si un acompte est émis ensuite, l'émission est refusée par la base ; il faut supprimer et recréer le brouillon (pas de bouton « recalculer les déductions »). | 8 (confort) |
| Phase 5 (sécurité, boucle 1) | Liens de facture : un seul lien valable à la fois (nouvel envoi ou rappel = l'ancien désactivé) ; bouton « Désactiver le lien envoyé ». Adresse de retour Stripe sans jeton (/f/retour). | Fait |
| Phase 5 (sécurité, boucle 1) | Paiement Stripe encaissé mais refusé par la base : consigné (table incidents_paiement), affiché en rouge sur la facture jusqu'à « C'est remboursé ». Un même payment_intent n'est enregistré qu'une fois ; session Stripe créée avec une clé d'idempotence (facture + reste). | Fait |
| Phase 5 (relecture, boucle 1) | Relances d'impayés espacées : chaque rappel attend l'écart entre les délais depuis l'envoi effectif du précédent ; délais croissants exigés. Un envoi resté « en cours » (plantage) bloque la suite automatique (affiché « envoi non confirmé ») : la relance manuelle permet de continuer. Pas de suspension des relances par facture (litige, échéancier accordé). | 6 (pilotage) |
| Phase 5 (test terrain, boucle 1) | Confort non traité : message « réseau revenu, PAS encore enregistré » ; recherche dans la liste des factures ; répartition d'un paiement sur plusieurs factures d'un client ; texte « reste dû sur le chantier » sur le lien client ; case des textes légaux mémorisée après validation du comptable ; résumé « à encaisser » sur l'accueil. | 6 / 8 |
| Phase 5 (audit légal, boucle 1) | À faire valider : opposabilité des pénalités à un particulier quand le devis n'en parle pas ; plancher légal du taux entre professionnels ; indemnité différente de 40 € ; médiateur absent des factures ; signal à l'émission d'une facture à taux réduit (attestation) ; autoliquidation présentée sans « Total TTC » ; numéro de TVA du donneur d'ordre ; série AVO distincte ; nouvelles mentions de la facturation électronique. | Comptable |
| Phase 5 (audit légal, boucle 1) | Factur-X : ordre du code d'exonération corrigé, vendeur avec « EI » ; restent À VÉRIFIER avant toute transmission : identifiant fiscal en catégorie E (franchise), prix net de ligne avec remise ou avancement, validation par un outil officiel. | 7 (documents) |
| Phase 5 (sécurité, boucle 1) | XML Factur-X : chemin imposé (dossier de la facture), empreinte SHA-256 dans le nom, vérifiée au téléchargement. | Fait |
| Phase 5 (conception) | Factur-X : XML CII (profil EN 16931) préparé et stocké à l'émission, **non intégré au PDF** (PDF/A-3) et non transmis à une plateforme de dématérialisation. Calendrier et plateforme de la facturation électronique obligatoire : À VÉRIFIER. | 7 (documents), comptable |
| Phase 5 (conception) | Autoliquidation (sous-traitance BTP) : case par facture, mention imprimée, TVA nulle, client professionnel exigé ; textes et conditions À VÉRIFIER. | Comptable |
| Phase 5 (audit légal et test terrain, boucle 1) | Dates : acompte = « Début des travaux prévu le … » (aucune date de prestation exigée ; date de versement éventuelle À VÉRIFIER) ; situation = période facturée ; finale et libre = date de fin des travaux exigée, préremplie avec le jour de création (modifiable). | Comptable |
| Phase 5 (conception) | Indemnité forfaitaire de recouvrement (40 €) imprimée seulement pour un client professionnel ; pénalités imprimées pour tous. À VÉRIFIER. | Comptable |
| Phase 5 (conception) | Paiement par carte (Stripe) facultatif, inactif sans clés : frais, contrat, remboursements et registre RGPD À VÉRIFIER avant activation. Un paiement encaissé mais refusé par l'application (facture déjà soldée) se rembourse à la main dans Stripe. | Avant activation |
| Phase 5 (sécurité) | Point Phase 4 « deux envois simultanés » corrigé : chaque email (envoi de devis, de facture, relances) est réservé en base (statut « en cours ») avant l'envoi ; un second envoi identique est refusé (clé du formulaire ou index unique des relances). Un envoi dont la conclusion n'a pas pu être écrite reste « envoi non confirmé » et n'est jamais renvoyé automatiquement. | Fait |
| Phase 5 (conception) | Point Phase 4 « facture d'acompte depuis le montant ACCEPTÉ » : fait (ventilation acceptée, options retenues comprises). | Fait |
| Phase 5 (audit légal, boucle 1) | Rétractation hors établissement (particulier) : une facture émise pendant les 14 jours suivant la signature ne demande aucun paiement avant leur terme (texte sur le PDF, ni QR ni paiement en ligne, lien client idem) ; échéance dans le délai bloquante. Durée exacte de l'interdiction d'encaisser (7 jours ?) et blocage complet de l'acompte : À VÉRIFIER (point 3 du comptable). | Comptable |
| Phase 5 (audit légal, boucle 1) | Avoir d'une facture émise sous un autre régime de TVA : possible (régime de la facture d'origine) ; reprise de la mention 293 B sur un tel avoir : À VÉRIFIER. | Comptable |
| Phase 5 (relecture, boucle 1) | Migration 20261008000600_factures_paiements.sql modifiée sur place (avoir d'annulation qui reprend les déductions, soldes sur le net des avoirs) avant tout déploiement : bases locales à recréer (`npm run local:start`). | Avant mise en production |
| Phase 5 (conception) | Changement de régime de TVA entre le devis et la facture : facturation depuis le devis refusée (facture libre conseillée). | Comptable |

