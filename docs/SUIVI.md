# Points reportés : suivi entre les phases

Points relevés par les agents de contrôle, acceptés pour la phase en cours mais **à traiter** à la phase indiquée. Chaque phase relit ce fichier à son cadrage.

| Origine | Point | Phase cible |
|---|---|---|
| Sécurité B11 | La suppression d'un chantier supprime en cascade `photos` et `documents_chantier` sans mettre leurs fichiers dans `fichiers_a_supprimer` : les fichiers restent orphelins dans le stockage. **Traité en Phase 2** : `supprimer_chantier` les met en file avant la suppression. | Fait |
| Sécurité (boucle 3) | La politique `hdecor_suppr` laisse une session supprimer des fichiers de l'espace `justificatifs`. Il faut protéger les justificatifs comptables (`depenses.justificatif_chemin`) comme les PDF émis. | 6 (pilotage) |
| Sécurité M4 | La limitation des tentatives de connexion et d'envoi d'emails se fait sur l'IP du serveur, pas sur celle du visiteur. Prévoir une limite applicative par IP cliente et par email, et un SMTP dédié. | Avant mise en production |
| Sécurité B5 | Pas de durée maximale ni de délai d'inactivité de session (`[auth.sessions]`, offre Pro), ou redemander l'authentification avant les actions sensibles. | Avant mise en production |
| Sécurité B7 | Actions GitHub non épinglées par empreinte (SHA). **Traité en Phase 8.** | Fait |
| Sécurité B10 | La purge du journal d'audit n'est pas planifiée, la durée étant À VÉRIFIER par le comptable. | Après validation de la durée |
| Fichiers | `src/lib/fichiers.ts` (signature binaire) doit être branché sur le premier dépôt de fichier (logo, photos). | 2 ou 7 |
| Logo | Dépôt du logo officiel. **Traité en Phase 8** (Réglages > Logo ; le logo officiel reste à déposer par Yorick). | Fait |
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
| Phase 5 (test terrain, boucle 2) | Relance manuelle : un message préparé n'est noté qu'une fois copié ou partagé ; préparer de nouveau redonne le même rappel ; un rappel plus tôt que l'écart prévu demande « Relancer plus tôt que prévu ». | Fait |
| Phase 5 (calculs, boucle 2) | PDF de l'avoir d'annulation d'une facture qui déduisait des acomptes (audit légal, boucle 3) : totaux bruts « de la facture corrigée », acomptes « facture distincte, non reprise », seul « Montant de l'avoir » porte le crédit avec sa TVA nette par taux ; l'écran d'avoir rappelle de corriger aussi les factures d'acompte pour annuler tout le chantier. Présentation (TVA nette par taux) et sort des acomptes en cas d'annulation complète : À VÉRIFIER avec le comptable. Contrôle en base : ventilation par taux identique à la facture d'origine. Montant d'avoir inatteignable au centime : l'erreur propose le montant atteignable le plus proche en dessous, vérifié (le reste par un second avoir). | Fait |
| Phase 5 (audit légal, boucle 2) | Paiement saisi pendant le délai de rétractation : avertissement dans le formulaire (encaissement possiblement interdit, À VÉRIFIER). Facture libre pour un particulier : signal « délai de rétractation non contrôlé ici ». | Fait / comptable |
| Phase 5 (relecture et sécurité, boucle 2) | Envoi d'une facture ou relance par email : envoi réservé AVANT la création du lien (un second envoi simultané ne désactive plus le lien du premier). Restent : désactivation puis insertion du lien non atomiques (deux liens possibles en cas de requêtes strictement simultanées) ; facture introuvable dans un webhook Stripe -> 500 répété (théorique). | 8 (recette) |
| Phase 5 (test terrain, boucle 2) | Format des champs date (jj/mm/aaaa) à contrôler sur un vrai téléphone Android en français (le navigateur de test affiche mm/jj/aaaa). | 8 (recette, sur téléphone) |
| Phase 5 (sécurité, boucle 3) | Relance préparée sans être partagée : crée un lien sans désactiver celui du client ; au moment où le rappel est noté, seul le lien le plus récent reste valable. Des liens préparés jamais partagés restent valables jusqu'au rappel suivant ou à leur expiration (89 jours au plus) ; « Désactiver le lien envoyé » les coupe tous. | Connu |
| Phase 5 (calculs, boucles 1 à 3) | Restent ouverts : écart d'un centime possible sur le cumul par taux d'avoirs partiels successifs ; cumul des acomptes calculé avec les brouillons (échéance suivante faussée d'un centime si un brouillon est supprimé). | 8 (recette) |
| Phase 5 (validation finale) | Améliorations non bloquantes relevées sur 47fe76d : `catch` à resserrer sur ErreurFacture (PDF d'avoir, lignesAvoirMontant) et commentaire en double ; erreur de désactivation des anciens liens à journaliser (noterRelancePartagee) ; garder le lien du message réellement partagé (identifiant du lien préparé) plutôt que le plus récent ; vérifier que la facture est émise avant de noter un rappel ; relance automatique qui désactive l'ancien lien avant l'email ; complément d'avoir parfois à refaire une 2e fois sur trois taux (14 cas sur 846). | 6 (début de phase) |


## Phase 6 (pilotage) : points reportés et questions ouvertes

À VÉRIFIER avec le comptable :
- **Base du chiffre d'affaires** : encaissements (livre des recettes, date du paiement), remboursements déduits. Pour une entreprise soumise à la TVA, la part HT d'un encaissement est calculée au prorata HT / TTC de sa facture, **en cumulé** (les parts d'une facture totalisent exactement son HT net : 3 × 40 € sur 100 € HT / 120 € TTC donnent 33,33 + 33,34 + 33,33).
- **Jauges des seuils** : comparées au CA HT encaissé de l'année civile en cours. Seuils et alertes (80 / 95 % par défaut) restent paramétrables et marqués À VÉRIFIER tant qu'ils ne sont pas confirmés dans Paramètres.
- **Coût des achats dans la marge** : TTC en franchise (TVA non récupérable), HT sinon.
- **Valeur du temps passé** : temps × taux horaire de vente. C'est un indicatif, pas une dépense.

Limites connues (signalées dans l'interface) :
- **Jours fériés** : la planification d'un chantier exclut les week-ends, pas les jours fériés. La date de fin est à vérifier.
- **Export ICS** : c'est un fichier à importer, pas un abonnement (aucune adresse publique ne donne accès au planning).
- **Photos de justificatif** : elles sont réduites dans le navigateur (2 000 px, JPEG) avant l'envoi, avec une limite de 5,5 Mo. Une photo HEIC que le navigateur ne sait pas lire (hors Safari) est refusée par le serveur, avec un message clair.
- **Navigation** : Planning et Comptabilité s'ouvrent par les tuiles du tableau de bord ; l'onglet Accueil reste allumé sur ces pages (avis du testeur : acceptable ; si le planning devient quotidien, échanger Clients contre Planning plutôt qu'ajouter un 7e onglet).
- **Rappels** : affichés dans « À faire » (tableau de bord) et dans le planning, sans alerte sur le téléphone (dit dans l'interface). Rappel sans heure : 8 h (affiché dans le formulaire).

Avertissements des contrôles (boucle 1), laissés ouverts :
- **Changement de régime de TVA** : le coût des achats dans la marge et la colonne « dont HT » de l'export suivent le régime ACTUEL, pas celui de la date. À reprendre si Yorick sort de la franchise en cours d'année.
- **Matière prévue** : `cout_matiere_prevu_cents` des devis est un coût d'achat HT (catalogue) ; en franchise, il est comparé à des achats TTC. À VÉRIFIER.
- **Suppression d'un achat** : le justificatif est retiré (trace d'audit conservée). Durée de conservation des pièces justificatives à confirmer (auditeur-legal, comptable).
- **Jauge à exactement 100 %** : « critique », pas « dépassé » (dépassement strict). À confirmer.
- **Email de facture en échec** : l'ancien et le nouveau lien restent valables (rien n'a été transmis) ; le prochain envoi réussi ne garde que le sien.
- **Deux « Planifier » simultanés** sur le même chantier peuvent doubler les plages (bouton désactivé pendant l'envoi ; RPC transactionnelle si besoin).
- **Plannings antérieurs à la Phase 6 (boucle 1)** : un chantier enregistré en un seul bloc s'affiche aussi le week-end ; le replanifier une fois suffit.
- **Base existante** : la contrainte `justificatif_chemin_depense` est posée sans `NOT VALID` (aucune base de production à ce jour).

Toujours ouverts depuis la Phase 5 : suspension des relances par facture, recherche dans la liste des factures, message « réseau revenu », taux de TVA par défaut, liste des chantiers limitée à 200.

## Phase 7 (documents et finitions) : points reportés et questions ouvertes

À VÉRIFIER (auditeur-legal, comptable) :
- **PV de réception** : contenu (parties, lieu, travaux, date, décision avec ou sans réserves, délai de levée, observations) et rappel informatif sur la réception et les garanties (article 1792-6 du Code civil cité, marqué « Références À VÉRIFIER » sur le document). Signature sur place seulement (client et entreprise, empreinte du PDF présenté) ; pas de signature à distance du PV.
- **Levée des réserves** : déclarée et datée par l'entreprise seule (« Levée déclarée par l'entreprise le … »), sans annulation ; le PDF signé n'est pas régénéré. Faut-il un « PV de levée des réserves » contresigné par le client et remis à celui-ci ?
- **Demande d'avis** : manuelle (jamais automatique), sur la facture finale (ou libre) entièrement payée, une par chantier, opposition du client notée et respectée ; modèle de message neutre (« quel qu'il soit »). La demande d'avis relève-t-elle de la prospection au sens de l'article L34-5 du CPCE (consentement préalable, opposition) ? À trancher.
- **Mention « [Références À VÉRIFIER] »** imprimée sur le PV remis au client : à retirer seulement après validation du texte par le conseil de l'entreprise, avant la mise en production.
- **Signature du PV** : en deux étapes sur le même téléphone (le client, puis l'entreprise) ; un trait droit est refusé comme signature. Comportement à confirmer sur un vrai Android et un vrai iPhone.
- **Photos diffusées** : accord du client noté (daté) avant tout export de la galerie ; ni nom ni adresse dans les exports ; métadonnées (GPS, appareil) retirées par le serveur. Vérifier visages, plaques, numéros de rue avant publication (rappelé à l'écran).

Limites connues :
- **Notifications** : dans l'application (cloche) et par email récapitulatif ; la tâche planifiée tourne une fois par jour sur l'hébergement de base (voir docs/MISE_EN_PRODUCTION.md). Pas de notification « push » du téléphone (clés VAPID et planificateur fréquent nécessaires).
- **Photos** : JPEG uniquement côté serveur (le téléphone convertit) ; une photo HEIC que le navigateur ne sait pas lire est refusée avec un message. Export limité à 200 photos (archive) et 40 (galerie). L'orientation EXIF est respectée par la réduction dans le navigateur ; un JPEG déposé tel quel (document) garde son orientation d'origine.
- **Unicité de la demande d'avis par chantier** : contrôlée par l'application (la base garantit une seule demande par facture).
- **Confort reporté (testeur-chantier)** : bouton « Partager » vers la feuille de partage du téléphone et montage « avant | après » au format 4:5 pour les réseaux sociaux ; étoile « Galerie » en un appui sur la vignette ; message de demande d'avis modifiable avant partage et formule « Madame / Monsieur » ; liste de fin hors ligne (appui gardé en attente).

Clôture de la Phase 7 (fusionnée dans main le 10/10/2026, commit de fusion 49277a7, dernier commit de la branche 2666f7f) :

| Agent | Verdict | Boucle | Commit audité |
|---|---|---|---|
| auditeur-legal | APPROUVÉ | 2 | b389a4e (remarques non bloquantes traitées dans b0d758b) |
| relecteur-code | APPROUVÉ | 2 | b389a4e |
| testeur-chantier | APPROUVÉ | 2 | b389a4e (retours de confort traités dans 2666f7f) |
| securite-rgpd | APPROUVÉ | 3 | 2666f7f |

Mesures sur 2666f7f : Vitest 730/730, SQL 409/409 (shim et gotrue), e2e 74/74, typecheck, lint et build sans erreur ni avertissement.

## Phase 8 (recette finale) : décisions de Yorick (10/10/2026)

- **Logo** : dépôt dans Réglages, imprimé sur devis, factures et PV.
- **Textes légaux** : modifiables dans Réglages, texte actuel par défaut, marqués « À VÉRIFIER » jusqu'à la validation du comptable.
- **Annotation des photos et mode sombre** : reportés (hors recette).
- **Attestation de TVA à taux réduit** : reportée ; les taux réduits restent bloqués, avec un message, tant qu'elle n'existe pas.
- **Démonstration** : base locale séparée (`hdecor_demo`) seulement.

## Phase 8 : points reportés (audit global)

Aucun de ces points ne produit un montant faux ni un document non conforme connu ; chacun est à reprendre après la mise en service.

| Origine | Point |
|---|---|
| qa-calculs | Facture en autoliquidation : le PDF imprime la colonne du taux, « TVA 20 % … 0,00 € » et « Total TTC ». Montants exacts, présentation à faire valider par le comptable. |
| qa-calculs | Autoliquidation : le contrôle « taux absent des Paramètres » est sauté (taux déjà limité à la saisie ; il figure dans les données Factur-X). |
| qa-calculs / relecteur-code | Avoir partiel sur une finale qui déduit un acompte (plusieurs taux, ou 10 %) : certains montants sont refusés sans proposition. Le message oriente vers l'avoir total puis une nouvelle facture. Élargir la recherche de proposition (au-dessus du montant). |
| qa-calculs | La base accepte un avoir partiel inséré directement (hors application) qui laisse un reste dont la TVA n'est pas l'arrondi de sa base ; l'application ne le produit pas. Contrôle en base à ajouter. |
| qa-calculs / relecteur-code | Les manques de taux d'une facture portent `ou: 'devis'` : le lien de correction peut mener au mauvais écran. |
| relecteur-code | Logo jusqu'à 4096 px intégré en pleine résolution dans chaque PDF (jusqu'à 1,5 s et 600 Ko de plus) : réduire l'image au dépôt. |
| relecteur-code | `controler_emission_recette` : le contrôle « solde sans solder chaque taux » est une défense en profondeur inatteignable (pas de taux négatif + somme nulle ⇒ chaque taux nul). |
| relecteur-code | Droits UPDATE de `parametres_entreprise` accordés colonne par colonne : toute colonne ajoutée par une migration future doit recevoir son `grant update (...)`. |
| relecteur-code | Recherche : si `rechercher_clients` échoue, la liste filtre sur ses propres colonnes (erreur journalisée, pas signalée à l'écran). |
| relecteur-code | `enregistrerTextes` valide avec `lireTexte` plutôt qu'avec zod ; longueur comptée en UTF-16 (JS) et en caractères (SQL). |
| relecteur-code / securite-rgpd | Sauvegarde : chiffrement `aes-256-cbc` sans authentification (passer à age, gpg ou ajouter un HMAC) ; fichiers des clients effacés réimportés avant d'être remis en file de suppression ; test de restauration non lancé en CI ; restauration Supabase réelle à répéter avant la production. |
| relecteur-code | Taux réduits « attestation requise » bloqués sur toutes les factures (acompte, situation, finale) : conforme à la décision de Yorick, à confirmer avec le comptable. |
| auditeur-peinture | Le prévu d'un chantier est masqué dès qu'une ligne manuelle n'a pas de prévision ; fausse alerte « plâtre neuf » ; R3 (pots sans prix) ; marge de la démonstration peu réaliste. |
| auditeur-legal | Pas de rappel des textes légaux avant la signature du PV. |
| securite-rgpd | Caractères de contrôle bidirectionnels (U+202E) acceptés dans les textes ; IBAN d'exemple dans la démonstration (fictif). |
| testeur-chantier | Recherche « Durand Paul » (nom puis prénom) sans résultat ; liste Factures « Toutes » : une facture payée affiche « 0,00 € » (montant de la facture à montrer quand le reste dû est nul). |
| testeur-chantier | Menu TVA d'une ligne (assujetti) : 10 %, 5,5 % et 0 % proposés sans dire qu'ils seront bloqués à l'émission. |
| testeur-chantier | Liens de correction : « numéro de TVA intracommunautaire » mène à /parametres ; « début / durée » mène en haut du brouillon de devis (en-tête sous les lignes). |
| testeur-chantier | PV : la signature du client (étape 1) n'est gardée qu'en mémoire ; un rechargement la fait refaire. « Empreinte SHA-256 » imprimée sur le PV : jargon. |
| testeur-chantier | Confort : pas de bouton « Revenir au texte par défaut » ; repères {mediateur} peu parlants ; fenêtre sans dimensions proposées ; bandeau « pas encore envoyée » sur une facture payée ; pas de message « réseau revenu » ; formulaire de paiement fermé à l'arrivée sur une facture émise ; quelle ligne empêche le « prévu ». |
| testeur-chantier | PDF : l'adresse de la page de confidentialité vient de `NEXT_PUBLIC_SITE_URL` ; à vérifier en production (MISE_EN_PRODUCTION). |
| testeur-chantier (boucle 2) | Messages de la marge de perte sans le nom du champ ; « 0,155 % » refusé sans dire « 2 décimales au plus » ; après « Retirer le logo », l'ancien message vert « Logo enregistré » reste affiché. |

## Clôture de la Phase 8

Branche `phase-8`, dernier commit audité par chef-de-projet : 8dbeed7.

| Agent | Verdict | Boucle | Commit audité |
|---|---|---|---|
| auditeur-peinture | APPROUVÉ | 2 | 64f563e |
| auditeur-legal | APPROUVÉ | 2 | 323c662 |
| securite-rgpd | APPROUVÉ | 2 | 64f563e (remarques traitées dans 58341f7) |
| qa-calculs | APPROUVÉ | 3 | a6e9af7 |
| relecteur-code | APPROUVÉ | 2 | ec35949 (remarques traitées dans de1932f) |
| testeur-chantier | APPROUVÉ | 2 | 1caccbc (confort traité dans 3052ac6) |
| chef-de-projet | APPROUVÉ | 2 | b1e636a (boucle 1 sur 8dbeed7 : bilan de SUIVI manquant, ajouté) |

Mesures sur l'état final : Vitest 766/766 ; SQL 424/424 (shim et gotrue) et 4 tests de concurrence ; e2e 81/81 (3052ac6, puis 8dbeed7 ne change qu'une ligne du test de sauvegarde) ; typecheck, lint et build sans erreur ni avertissement ; démo chargée (7/7) et « conforme » ; sauvegarde et restauration : tous les contrôles OK.

Changement relevé par chef-de-projet, non vu par auditeur-legal : le rappel « Mention d'autoliquidation » à l'émission d'une facture disparaît une fois la validation des textes datée (même règle que le devis). À confirmer par le comptable avec la présentation de l'autoliquidation.

## Clôture du projet : état des points reportés

Chaque point reporté des Phases 1 à 8 qui n'était pas marqué « Fait » dans son tableau, avec son état à la fin de la Phase 8. Vérifié dans le code et l'historique git, pas seulement d'après les comptes rendus.

États : **Fait** ; **Avant mise en production** (repris dans `docs/MISE_EN_PRODUCTION.md`) ; **Comptable / Yorick** (décision humaine, repris dans `docs/CHECKLIST_PREMIERE_FACTURE.md` pour le comptable) ; **Après mise en service** (amélioration, aucun montant faux ni document non conforme connu) ; **Avant activation de Stripe**.

### Faits

| Point (origine) | Où |
|---|---|
| Justificatifs protégés de la suppression par une session (sécurité, boucle 3, cible 6) | Phase 6 : politique `hdecor_suppr` réécrite (migration 20261016000100), puis Phase 8 (plus aucune suppression par session sur le stockage, migration 20261019000100). |
| `src/lib/fichiers.ts` branché sur les dépôts (cible 2 ou 7) | Justificatifs, photos et documents de chantier, logo. |
| Dépôt de photos de chantier (cible 7) | Phase 7. |
| Liste des chantiers limitée à 200 (cible 6) | Phase 8 : pagination « Afficher 100 de plus », recherche. |
| Recherche dans les listes devis, factures et clients (cibles 4, 6, 8) | Phase 8. |
| Textes légaux modifiables (cible 7) | Phase 8 : Réglages > Textes des documents. |
| Phase 2 : formats par type, matière d'étape, teinte, reprise des postes dans le devis (R1) | Phases 3 et 4 (bilan de la Phase 3 et e2e du devis). |
| Envoi par email doublé par deux requêtes simultanées ; relances planifiées sans verrou (Phase 4) | Phase 5 : chaque email réservé en base avant l'envoi, index unique des relances. |
| Améliorations de la validation finale de la Phase 5 (cible 6) | Phase 6, commit 6369139 (liens désactivés après l'envoi ou au partage, rappel noté seulement sur facture émise, erreurs ciblées) ; complément d'avoir sur trois taux : Phase 8 (voir ligne suivante). |
| Écart d'un centime sur le cumul par taux d'avoirs partiels successifs (Phase 5, cible 8) | Phase 8 : `lignesAvoirMontantExact` n'accepte qu'un avoir dont le reste dû par taux garde une TVA conforme ; la base refuse un avoir qui dépasse la facture pour un taux. qa-calculs : 0 écart sur 1 500 tirages par configuration. Reste un cas hors application (voir « Après mise en service »). |
| Cumul des acomptes calculé avec les brouillons (Phase 5, cible 8) | Phase 8 : cumul enregistré à la création (`acompte_cumul_avant_bp`) et contrôlé à l'émission en base, sous le verrou du devis. |
| Complément d'avoir à refaire sur trois taux (14 cas sur 846, Phase 5) | Phase 8 : proposition vérifiée, ou message qui oriente vers l'avoir total puis une nouvelle facture. |
| Actions GitHub épinglées (B7), logo | Phase 8. |

### Avant mise en production

| Point | Origine |
|---|---|
| Limitation du débit (connexion, emails, pages publiques /d et /f) par IP cliente, dans Vercel Firewall ; SMTP dédié (Resend) | Sécurité M4, Phase 4 |
| Durée maximale et délai d'inactivité des sessions | Sécurité B5 |
| Migrations modifiées sur place avant tout déploiement ; aucune migration de retour arrière : à partir de la première mise en ligne, une nouvelle migration par changement et une sauvegarde avant chaque déploiement (MISE_EN_PRODUCTION § 7 et § 8) | Phases 2, 4, 5 |
| Chiffrement de la sauvegarde à authentifier ; restauration réelle à répéter sur un projet Supabase de test ; test de restauration à ajouter à la CI | Phase 8 |
| Texte du PV : « [Références À VÉRIFIER] » à remplacer par le texte validé | Phase 7 |
| Aucune étape de MISE_EN_PRODUCTION n'a été répétée sur de vrais projets Supabase et Vercel | Phase 8 |

### Comptable / Yorick

| Point | Origine |
|---|---|
| Toute la check-list `docs/CHECKLIST_PREMIERE_FACTURE.md` : mention de franchise et seuils, pénalités et indemnité de 40 €, « Net à payer », rétractation et encaissement, avoir d'une finale avec acomptes, autoliquidation (présentation « TVA 20 % … 0,00 € » et « Total TTC », rappel retiré après validation des textes), Factur-X et calendrier de la facturation électronique, durées de conservation, demande d'avis (L34-5), PV et levée des réserves, force probante du « Bon pour accord » tapé | Phases 4 à 8 |
| Taux réduits bloqués tant que l'attestation n'est pas produite, sur devis et sur toutes les factures | Décision de Yorick (Phase 8), à confirmer par le comptable |
| Purge du journal d'audit : durée à fixer | Sécurité B10 |
| Enduit à 1 m²/kg par passe ; matière d'étape « pertes comprises » ; formats usuels sans effet sur « À VÉRIFIER » | Phases 2 et 3 |
| Base du chiffre d'affaires, jauges des seuils, coût des achats en franchise, matière prévue HT comparée à des achats TTC, jauge à exactement 100 % | Phase 6 |
| Activation de Stripe (frais, contrat, registre) | Phase 5 |
| Champs date (JJ/MM/AAAA) et signatures sur un vrai Android et un vrai iPhone | Phases 5 et 7 |

### Avant activation de Stripe

| Point | Origine |
|---|---|
| Webhook : une facture introuvable donne une réponse 500 répétée par Stripe (théorique ; Stripe est inactif sans clés) | Phase 5 |

### Après mise en service (améliorations)

Risque qualifié pour les deux points de calcul et de sécurité qui visaient la Phase 8 :
- **Désactivation puis insertion d'un lien de facture non atomiques** : seulement si deux requêtes strictement simultanées partent pour la même facture. Conséquence : deux liens valables pour le même client, chacun limité à la facture de ce client et à 89 jours ; « Désactiver le lien envoyé » les coupe tous. Aucun montant, aucune donnée d'un autre client exposée. Risque faible, accepté.
- **Avoir partiel inséré directement en base (hors application)** qui laisse un reste dont la TVA n'est pas l'arrondi de sa base : l'application ne le produit pas, et la RLS réserve l'écriture à l'entreprise elle-même. Le reste se solde par l'annulation exacte. Risque faible, accepté ; contrôle en base à ajouter.

Autres améliorations :
- Métré : pièce en L (« deux rectangles ») ; modifier une ouverture ou un élément ; alertes d'aperçu pour une valeur hors de l'ordinaire ; « Pièce humide » au niveau de la pièce ; support par défaut selon la cible ; dimensions par défaut d'une fenêtre.
- Calcul : planning du séchage complet (impression → finition, passes d'enduit, somme) ; avertissement métal malgré un poste antirouille ; alternatives à plusieurs formats de pots ; fausse alerte « plâtre neuf » ; prévu masqué dès qu'une ligne manuelle n'a pas de prévision, sans dire laquelle.
- Catalogue : contrôle du format des codes RAL et NCS.
- Devis et factures : taux de TVA par défaut des travaux ; écart de ±0,5 centime par m² affiché à la reprise d'un poste ; lien direct vers la fiche produit fautive ; bouton « acompte → début des travaux » ; bouton « recalculer les déductions » d'une finale ; avancement de situation en recul contrôlé ligne par ligne ; menu TVA qui signale les taux bloqués ; propositions d'avoir au-dessus du montant.
- Relances et paiements : suspension des relances par facture (litige, échéancier accordé) ; répartition d'un paiement sur plusieurs factures ; résumé « à encaisser » sur l'accueil.
- Saisie : renvoi après une réponse perdue avec une saisie corrigée entre-temps (la première version est gardée sans message) ; message « réseau revenu, pas encore enregistré ».
- Toutes les remarques de confort des testeurs (Phases 1 à 8) listées plus haut, et la section « Phase 8 : points reportés (audit global) ».
- Hors périmètre, par décision : annotation des photos, mode sombre, attestation de TVA, notifications « push », hors-ligne complet, jours fériés.
