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
