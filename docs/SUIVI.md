# Points reportés : suivi entre les phases

Points relevés par les agents de contrôle, acceptés pour la phase en cours mais **à traiter** à la phase indiquée. Chaque phase relit ce fichier à son cadrage.

| Origine | Point | Phase cible |
|---|---|---|
| Sécurité B11 | La suppression d'un chantier supprime en cascade `photos` et `documents_chantier` sans mettre leurs fichiers dans `fichiers_a_supprimer` : les fichiers restent orphelins dans le stockage. | 2 (chantiers) |
| Sécurité (boucle 3) | La politique `hdecor_suppr` laisse une session supprimer des fichiers de l'espace `justificatifs`. Il faut protéger les justificatifs comptables (`depenses.justificatif_chemin`) comme les PDF émis. | 6 (pilotage) |
| Sécurité M4 | La limitation des tentatives de connexion et d'envoi d'emails se fait sur l'IP du serveur, pas sur celle du visiteur. Prévoir une limite applicative par IP cliente et par email, et un SMTP dédié. | Avant mise en production |
| Sécurité B5 | Pas de durée maximale ni de délai d'inactivité de session (`[auth.sessions]`, offre Pro), ou redemander l'authentification avant les actions sensibles. | Avant mise en production |
| Sécurité B7 | Actions GitHub non épinglées par empreinte (SHA). | Avant mise en production |
| Sécurité B10 | La purge du journal d'audit n'est pas planifiée, la durée étant À VÉRIFIER par le comptable. | Après validation de la durée |
| Fichiers | `src/lib/fichiers.ts` (signature binaire) doit être branché sur le premier dépôt de fichier (logo, photos). | 2 ou 7 |
| Logo | Dépôt du logo officiel. Le service de stockage local est indisponible dans l'environnement de développement actuel. | 7 (documents) |
| Testeur (confort) | Les points suivants sont du confort, à reprendre plus tard : bouton Itinéraire ; ville proposée à partir du code postal ; bouton Enregistrer collant sur Conditions ; annulation d'une confirmation de taux de TVA ; message « Assurance supprimée » ; message français si la case de confirmation n'est pas cochée ; champs date à vérifier sur un vrai Android. | 2 à 8 |
| Testeur | Déconnexion inattendue observée une fois après une 4G faible, non reproduite (probablement une autre session sur le même compte de test). À surveiller. | Suivi |
