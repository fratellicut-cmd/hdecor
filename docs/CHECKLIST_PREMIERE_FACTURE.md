# Check-list « avant la première vraie facture »

À faire **avec le comptable** avant de facturer un vrai client. Rien de ce qui suit n'est affirmé comme exact : chaque ligne décrit **ce que fait l'application aujourd'hui** et pose la question. Le comptable écrit sa décision, la date et ses initiales.

- Dans l'application, **Réglages > Avant la première vraie facture** liste en direct ce qui reste à compléter ou à confirmer dans les réglages (identité, assurances, conditions, statut fiscal, textes, catalogue, logo, double authentification).
- Une décision qui change un texte imprimé se reporte dans **Réglages > Textes des documents** (rétractation, exécution anticipée, « devis reçu », médiateur, réception, autoliquidation), puis la date de validation y est saisie.
- Une décision qui change une **règle** (blocage, calcul) se transmet au développeur : elle demande une modification de l'application.

Abréviations : D = devis, F = facture, A = avoir, PV = procès-verbal de réception.

## 1. Statut fiscal et TVA

| N° | Question | Ce que fait l'application | Imprimé | Décision | Date | Initiales |
|---|---|---|---|---|---|---|
| 1.1 | Libellé exact de la mention de franchise. | « TVA non applicable, art. 293 B du CGI », modifiable (Réglages > Statut fiscal), marqué À VÉRIFIER jusqu'à confirmation. | D, F, A (sous les totaux) | | | |
| 1.2 | Seuils de la micro-entreprise et de la franchise en vigueur ; règle en cas de dépassement en cours d'année. | Aucune valeur préremplie ; jauge masquée tant que le seuil n'est pas saisi, affichée avec « À VÉRIFIER » tant qu'il n'est pas confirmé. Alertes à 80 % et 95 % (modifiables). Jauge à exactement 100 % = « critique », pas « dépassé ». | Tableau de bord | | | |
| 1.3 | Base des jauges : chiffre d'affaires encaissé (date du paiement) de l'année civile. | Encaissements nets des remboursements, par année civile. | Tableau de bord | | | |
| 1.4 | Changement de régime en cours d'année. | Facturer depuis un devis émis sous un autre régime est refusé (facture libre conseillée). Un avoir garde le régime de la facture d'origine. Reprise de la mention 293 B sur un tel avoir : à trancher. | F, A | | | |
| 1.5 | Taux réduits (10 %, 5,5 %) et attestation du client. | **Bloqués** tant que l'application ne produit pas l'attestation (décision de Yorick, Phase 8). Sans objet en franchise. | D | | | |
| 1.6 | Autoliquidation en sous-traitance du bâtiment. | Case par facture, client professionnel exigé, TVA nulle, mention modifiable (Réglages > Textes). Présentation sans « Total TTC » et numéro de TVA du donneur d'ordre : à confirmer. Sans objet en franchise. | F | | | |
| 1.7 | Méthode de calcul : TVA par taux sur le total HT du taux, arrondie au centime ; arrondi commercial (demi supérieur). | Appliqué partout (écran, PDF, base, exports). | D, F, A | | | |

## 2. Mentions des devis

| N° | Question | Ce que fait l'application | Imprimé | Décision | Date | Initiales |
|---|---|---|---|---|---|---|
| 2.1 | Mentions propres à l'EI et à l'artisan (« EI », immatriculation RNE / RM). | « EI » ajouté au nom ; immatriculation imprimée si saisie. Son absence est signalée (non bloquante) à l'émission d'un devis seulement, pas d'une facture. | D, F, A, PV | | | |
| 2.2 | Assurances sur le devis : décennale, RC Pro (obligatoire ou non pour un peintre), coordonnées de l'assureur. | Assureur, n° de contrat, période et zone des assurances en cours à la date du document. Absence de RC Pro signalée, non bloquante. | D, F | | | |
| 2.3 | « Devis reçu avant l'exécution des travaux » : obligation et libellé. | Texte par défaut modifiable (Réglages > Textes). | D (cadre Bon pour accord) | | | |
| 2.4 | Mention « Bon pour accord » saisie au clavier lors d'une signature électronique : valeur équivalente à la mention manuscrite ? | Acceptée (casse et ponctuation libres), conservée telle que tapée, avec nom, date, heure, adresse IP et empreinte du PDF signé. | Page de signature du D | | | |
| 2.5 | Versions : « v2 » avec le même numéro ; mention « annule et remplace la version 1 ». | Même numéro avec « v2 » ; la mention « annule et remplace » est à confirmer. | D | | | |
| 2.6 | Prix des options : en HT ou en TTC pour un particulier. | Options listées hors total, au prix HT de la ligne. | D | | | |
| 2.7 | Médiateur de la consommation : phrase et présence sur les factures. | Phrase modifiable (Réglages > Textes) imprimée sur le devis ; absente des factures. | D | | | |

## 3. Contrat signé chez le client (hors établissement, particulier)

| N° | Question | Ce que fait l'application | Imprimé | Décision | Date | Initiales |
|---|---|---|---|---|---|---|
| 3.1 | Droit de rétractation de 14 jours, point de départ (« à compter de la signature »), texte d'information. | Texte modifiable (Réglages > Textes) et formulaire type joint en page détachable. | D | | | |
| 3.2 | Formulaire de rétractation conforme au modèle en vigueur. | Modèle fixe dans l'application (non modifiable dans les Réglages). | D | | | |
| 3.3 | Interdiction de recevoir un paiement pendant un délai après la signature (7 jours ?). | Paiement demandé à la signature : **signalé** (non bloquant). Facture émise pendant les 14 jours : aucun paiement demandé avant leur terme (texte, ni QR ni paiement en ligne) ; échéance dans le délai bloquante ; paiement saisi pendant le délai : avertissement. | D, F | | | |
| 3.3 bis | Facture **libre** pour un particulier (sans devis) : délai de rétractation applicable ? | Non contrôlé : un signal « délai de rétractation non contrôlé ici » s'affiche à l'émission. | F | | | |
| 3.4 | Début des travaux pendant le délai : demande expresse du client. | Texte d'information modifiable (Réglages > Textes) ; un début prévu dans les 14 jours est signalé. | D | | | |

## 4. Factures, acomptes, avoirs

| N° | Question | Ce que fait l'application | Imprimé | Décision | Date | Initiales |
|---|---|---|---|---|---|---|
| 4.1 | Taux des pénalités de retard (obligatoire) ; opposabilité à un particulier si le devis n'en parle pas ; plancher entre professionnels. | Aucune valeur par défaut : saisie obligatoire avant la première facture. Imprimées pour tous les clients. | F | | | |
| 4.2 | Indemnité forfaitaire de recouvrement (40 €) : réservée aux professionnels ? | Imprimée seulement pour un client professionnel ; montant modifiable. | F | | | |
| 4.3 | Délai de paiement et plafond légal. | Délai par défaut et plafond (60 jours) modifiables, marqués À VÉRIFIER jusqu'à confirmation. | F | | | |
| 4.4 | Escompte pour paiement anticipé. | Texte modifiable (« Pas d'escompte pour paiement anticipé » par défaut). | F | | | |
| 4.5 | Dates de prestation : acompte (aucune date exigée), situation (période), finale et libre (date de fin des travaux). | Comme décrit ; la date de versement d'un acompte n'est pas imprimée. | F | | | |
| 4.6 | Libellé « Net à payer » en franchise. | « Net à payer » imprimé quand des acomptes sont déduits ou en franchise. | F | | | |
| 4.7 | Numérotation : séries DEV, FAC et AVO distinctes, chronologiques, sans trou. | Une série par type et par année ; série AVO distincte pour les avoirs. | D, F, A | | | |
| 4.8 | Geste commercial après facture. | Avoir de réduction (montant TTC choisi), compté en moins dans le chiffre d'affaires et en remboursement dans le livre des recettes s'il est remboursé. | A | | | |
| 4.9 | Annulation d'une finale qui déduisait des acomptes. | Avoir sur le net ; acomptes de nouveau déductibles sur une nouvelle finale ; présentation (TVA nette par taux) à confirmer. | A | | | |
| 4.10 | Remboursement d'un avoir sur une facture payée. | Enregistré en négatif dans le livre des recettes. | Livre des recettes | | | |

## 5. Facturation électronique

| N° | Question | Ce que fait l'application | Imprimé | Décision | Date | Initiales |
|---|---|---|---|---|---|---|
| 5.1 | Calendrier (réception, émission, e-reporting) et plateforme agréée. | Données Factur-X (XML) **préparées et stockées** à l'émission, **non intégrées au PDF** et **non transmises**. Aucune plateforme branchée. | — | | | |
| 5.2 | Contenu Factur-X : identifiant fiscal en franchise, prix net de ligne avec remise ou avancement, validation par un outil officiel. | Non validé par un outil officiel. | — | | | |
| 5.3 | Nouvelles mentions de la facturation électronique. | Aucune ajoutée à ce jour. | F | | | |

## 6. Comptabilité et conservation

| N° | Question | Ce que fait l'application | Imprimé | Décision | Date | Initiales |
|---|---|---|---|---|---|---|
| 6.1 | Livre des recettes : date d'encaissement, remboursements en négatif. | Exports CSV, Excel et PDF par mois ou par année. | Exports | | | |
| 6.2 | Coût des achats dans la marge : TTC en franchise (TVA non récupérée). | Comme décrit, selon le régime actuel (pas celui de la date de l'achat). | Fiche chantier | | | |
| 6.2 bis | « Matière prévue » d'un devis (coût d'achat HT du catalogue) comparée aux achats réels (TTC en franchise). | Comparaison affichée sur la fiche du chantier ; « prévu non calculé » dès qu'une ligne du devis n'a pas de prévision. | Fiche chantier | | | |
| 6.2 ter | « Valeur du temps passé » (heures × taux horaire de vente) et « reste après le temps ». | Indicatifs, présentés comme tels : ce ne sont pas des dépenses. | Fiche chantier | | | |
| 6.3 | Durée de conservation des factures et pièces justificatives (10 ans ?) ; registre des achats obligatoire ou non pour un prestataire de services. | Devis et factures émis immuables, gardés à l'anonymisation RGPD. **Supprimer un achat retire aussi son justificatif** (la trace reste dans le journal) : à confirmer ou à interdire. | — | | | |
| 6.4 | Durée de conservation du journal d'audit. | Conservé sans purge tant que la durée n'est pas donnée. | — | | | |
| 6.5 | Durée de conservation d'une attestation de TVA signée pour un devis refusé. | Conservée comme preuve, même après anonymisation. | — | | | |

## 7. Réception des travaux et avis client

| N° | Question | Ce que fait l'application | Imprimé | Décision | Date | Initiales |
|---|---|---|---|---|---|---|
| 7.1 | Contenu du PV et rappel sur la réception et les garanties (article 1792-6 du Code civil cité). | Texte modifiable (Réglages > Textes) ; « [Références À VÉRIFIER] » imprimé tant qu'il n'est pas validé et retiré du texte. | PV | | | |
| 7.2 | Levée des réserves : faut-il un PV de levée contresigné par le client ? | Levée déclarée et datée par l'entreprise seule, sans document remis au client. | Écran du PV | | | |
| 7.3 | Réception sans réserve : faut-il prévenir le client de sa portée sur les défauts visibles non signalés ? | Phrase simple avant la signature (« vous les acceptez sans réserve »), sans autre avertissement. | Écran de signature | | | |
| 7.4 | Demande d'avis Google : prospection au sens de l'article L34-5 du CPCE ? | Manuelle, une par chantier, après paiement complet de la facture finale ; opposition du client notée et respectée. | Message au client | | | |
| 7.5 | Conservation du PV signé et de l'historique des accords de diffusion des photos. | PV : durée des garanties (À VÉRIFIER). Accords : avec la fiche du chantier. | — | | | |

## 8. À faire par Yorick avant la première facture

- [ ] Réglages complétés jusqu'au vert dans **Réglages > Avant la première vraie facture** : SIRET, adresse, IBAN et BIC, immatriculation, assurances décennale et RC Pro, médiateur, taux des pénalités, conditions confirmées, statut fiscal confirmé, textes validés, logo, double authentification.
- [ ] Produits d'exemple (marqués « fictif ») archivés ; vrais produits saisis et vérifiés sur la fiche technique du fabricant (statut « vérifié », date et source).
- [ ] Réglages de calcul vérifiés : rendements par type de produit, **coefficients de support** (tous à 1,00 au départ), **temps de pose et des étapes de préparation**, **séchage entre couches**, **consommables** (bâches, adhésif, abrasif, lessive : à créer). Sans eux, ni temps ni prix calculés, et une préparation non chiffrée.
- [ ] Prix d'achat des formats saisis au catalogue (sans prix, le choix des pots est indicatif : le moins de pots).
- [ ] Les documents de la **démonstration** (devis, factures, avoir, PV) relus ligne par ligne avec le comptable. Éviter d'émettre une facture « de test » en production : elle prendrait le numéro FAC-AAAA-0001 et devrait être annulée par un avoir.
- [ ] Signature d'un devis et d'un PV essayée sur **votre propre téléphone** (Android ou iPhone), dates au format JJ/MM/AAAA vérifiées.
- [ ] Sauvegarde complémentaire faite et **restauration testée** (voir docs/MISE_EN_PRODUCTION.md).
- [ ] Guide utilisateur lu (docs/GUIDE_UTILISATEUR.md).

Signature du comptable : ____________________ Date : ____ / ____ / ________
