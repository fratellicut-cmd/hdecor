# Mise en production (Supabase + Vercel)

> À faire par le directeur, guidé par Claude Code. **Aucun mot de passe ni clé n'est jamais transmis à Claude Code** : les valeurs se saisissent directement dans les tableaux de bord.

Chaque étape **non répétée** sur un vrai projet est signalée comme telle : la procédure a été écrite et contrôlée sur la pile locale, pas sur Supabase et Vercel réels (aucun compte de production disponible pendant la construction).

## 0. Avant de commencer (ordre des opérations)

- [ ] **Offres** : Vercel Pro (l'offre gratuite serait réservée à un usage non commercial) et Supabase payante (pas de mise en pause, sauvegardes quotidiennes). Tarifs et conditions **À VÉRIFIER** sur leurs sites.
- [ ] **Nom de domaine** (par exemple `hdecor.fr`) chez un registraire, avec accès à la zone DNS.
- [ ] Projet Supabase (§ 1), puis projet Vercel (§ 2), puis domaine et emails (§ 2, Resend), puis compte de Yorick (§ 3).
- [ ] Contrôles après déploiement (§ 6) : **tous verts** avant la première vraie facture.
- [ ] **Textes des documents** (Réglages > Textes) validés par le comptable et datés ; en particulier le rappel sur la réception du PV, dont le texte par défaut porte « [Références À VÉRIFIER] » : à remplacer par le texte validé.
- [ ] **Sauvegarde** : le chiffrement actuel (`openssl aes-256-cbc`) ne détecte pas une archive altérée ; passer à un chiffrement authentifié (age, gpg) ou ajouter un HMAC avant de s'y fier (§ 5).
- [ ] **Points reportés** classés « Avant mise en production » dans `docs/SUIVI.md` (section « Clôture du projet ») : tous traités ou acceptés par écrit.
- [ ] Sauvegarde complémentaire faite et **restauration répétée** sur un projet de test (§ 5).
- [ ] Check-list du comptable (`docs/CHECKLIST_PREMIERE_FACTURE.md`) et page **Réglages > Avant la première vraie facture** au vert.
- [ ] **Limitation de débit** (Vercel Firewall) et **durée des sessions** (Supabase) réglées (§ 4).
- [ ] Registre des traitements à jour (`docs/rgpd/registre-traitements.md`) : régions réelles de Supabase, Vercel et Resend, DPA acceptés, dates.

## 1. Projet Supabase

1. Créer le projet en **région UE** (Paris ou Francfort). Noter la région dans `docs/rgpd/registre-traitements.md` (sous-traitants).
2. Accepter le contrat de sous-traitance (DPA) de Supabase.
3. Appliquer les migrations : `npx supabase@2.120.0 link --project-ref <ref>` puis `npx supabase@2.120.0 db push`. Il n'y a pas de migration « retour arrière » : en cas d'erreur, une **nouvelle** migration corrige la précédente. Avant chaque `db push` en production, faire une sauvegarde (tableau de bord > Database > Backups).
4. **Authentification**. Reporter les réglages de `supabase/config.toml`, au choix :
   - avec `npx supabase@2.120.0 config push` ;
   - ou à la main dans le tableau de bord. Réglages à reporter :
     - **Sign In / Providers** : inscription (« Allow new users to sign up ») **désactivée** ; seul le fournisseur Email reste actif, sans connexion anonyme.
     - **Mot de passe** : 12 caractères minimum.
     - **Changement de mot de passe sécurisé** : activé (« Secure password change »).
     - **Durée des liens envoyés par email** : 900 secondes (15 minutes).
     - **MFA** : TOTP activé (enrôlement et vérification).
     - **URL Configuration** : Site URL = l'adresse de production, et seule redirection autorisée = `https://<domaine>/auth/confirmer**`.
     - **Modèles d'emails** : le lien doit passer par `/auth/confirmer`, qui vérifie le jeton côté serveur. `{{ .RedirectTo }}` contient déjà `/auth/confirmer?suite=…`, envoyé par l'application.
       - Magic Link : `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=magiclink`
       - Reset Password : `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery`
       - **À VÉRIFIER** dans le tableau de bord (noms des variables de modèle), en recevant un vrai email de test.
5. **Vérification automatique** des réglages publics. Elle doit afficher 4 fois « OK » :
   `NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… node scripts/verifier-auth.mjs`
6. Courriels de connexion : configurer un SMTP personnalisé (Resend). Le service d'envoi intégré de Supabase est très limité en nombre d'emails par heure.

## 2. Projet Vercel

- Région des fonctions : `cdg1` (Paris).
- Variables d'environnement (Production) :

| Variable | Où la trouver | Secrète |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase > Project Settings > API | non |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem (clé « anon ») | non |
| `NEXT_PUBLIC_SITE_URL` | l'adresse de production (https://…) | non |
| `SUPABASE_SERVICE_ROLE_KEY` | idem (clé « service_role ») | **oui** |
| `CRON_SECRET` | à générer : `openssl rand -hex 32` | **oui** |
| `RESEND_API_KEY` | Resend > API Keys (droit « envoi » seulement) | **oui** |
| `EMAIL_EXPEDITEUR` | adresse d'un domaine vérifié dans Resend, par exemple `H'DECOR <devis@votre-domaine.fr>` | non |
| `STRIPE_SECRET_KEY` | **facultatif** (paiement par carte) : Stripe > Developers > API keys, clé secrète **restreinte** au droit « Checkout Sessions : écriture » | **oui** |
| `STRIPE_WEBHOOK_SECRET` | **facultatif** : Stripe > Developers > Webhooks, secret de signature (`whsec_…`) du point d'arrivée ci-dessous | **oui** |

- Tâches planifiées déclarées dans `vercel.json` (Vercel leur envoie `CRON_SECRET`) :
  - `/api/cron/conservation` : chaque nuit à 3 h 17 UTC (prospects inactifs, fichiers en attente de suppression) ;
  - `/api/cron/relances` : chaque jour à 7 h 43 UTC. Une seule relance automatique par devis envoyé et sans réponse, après le délai des Paramètres ; puis les relances d'impayés (3 niveaux, délais après l'échéance réglables dans Réglages > Messages et relances, seulement pour une facture envoyée ; chaque rappel attend au moins l'écart entre les délais depuis le précédent, jamais deux le même jour). Chaque relance crée un nouveau lien de la facture et désactive le précédent. Sans `RESEND_API_KEY` et `EMAIL_EXPEDITEUR`, rien n'est envoyé. Chaque email est réservé en base avant l'envoi : deux passages simultanés n'envoient pas deux fois la même relance.
  - `/api/cron/notifications` : chaque jour à 6 h 31 UTC. Transforme les rappels échus (séchage, rappels du planning) en notifications de l'application, puis envoie un email récapitulatif aux entreprises qui l'ont activé (Réglages > Notifications), à l'adresse de l'entreprise. Déclarée **une fois par jour** dans `vercel.json`. Avec l'offre Vercel Pro retenue au § 0, la fréquence peut être portée à `*/15 * * * *` pour une alerte de fin de séchage à l'heure (limites de l'offre **À VÉRIFIER**) ; sinon, faire appeler la route par un service externe toutes les 15 minutes avec l'en-tête `Authorization: Bearer <CRON_SECRET>`. Chaque nouvelle route de tâche planifiée doit aussi être déclarée dans `src/proxy.ts` (liste exacte) : sinon elle est renvoyée vers la connexion.
- **Paiement par carte (Stripe), facultatif** : sans les deux variables Stripe, le bouton « Payer par carte » n'apparaît pas et le webhook répond 404.
  - Webhook : point d'arrivée `https://<domaine>/api/stripe/webhook`, événements `checkout.session.completed` et `checkout.session.async_payment_succeeded`.
  - Le paiement n'est enregistré QUE par le webhook signé, une seule fois par événement et par paiement (payment_intent). Un paiement encaissé par Stripe mais refusé par l'application (facture soldée ou annulée entre-temps) est CONSIGNÉ et affiché en rouge sur la facture (« à rembourser dans Stripe »), jusqu'à ce que l'artisan confirme le remboursement.
  - Les événements Stripe sans rapport avec une facture (autre usage du compte) sont acceptés et ignorés.
  - Frais, contrat, remboursements, mentions sur la facture d'un paiement par carte : **À VÉRIFIER** (Stripe et comptable). Stripe est un prestataire américain : à ajouter au registre des traitements avant activation.
- **Resend** :
  - vérifier le domaine d'expédition (enregistrements DNS SPF et DKIM donnés par Resend) ; sans cela, les emails finissent en indésirables ;
  - **désactiver le suivi des clics** (« click tracking ») : il réécrirait les liens de signature, et leur jeton passerait par le domaine de suivi ;
  - Resend est un prestataire américain : vérifier la région d'envoi et l'encadrement du transfert (DPA, clauses contractuelles types), **À VÉRIFIER** ; le registre des traitements et la page Confidentialité le mentionnent.
- **Hébergement Vercel obligatoire** pour la preuve de signature : l'adresse IP enregistrée est lue dans l'en-tête `x-vercel-forwarded-for`, posé par Vercel. Derrière un autre hébergeur, cette IP serait falsifiable (`src/lib/requete.ts` à adapter).
- `NEXT_PUBLIC_SITE_URL` doit être exactement l'adresse publique : elle sert à fabriquer les liens envoyés aux clients (un lien vers une autre adresse ne fonctionne pas).

## 3. Création du compte de Yorick

Sur l'ordinateur du directeur, avec les variables de production dans un fichier `.env.production.local`, qui ne doit **jamais** être versionné :

```
npx tsx --env-file=.env.production.local scripts/creer-compte.ts \
  --email <email> --raison-sociale "H'DECOR" --dirigeant "<nom>"
```

Le mot de passe est demandé au clavier, et la saisie est masquée. Yorick active ensuite la double authentification dans Compte.

## 4. Après la mise en ligne

- Paramètres : compléter tout ce qui est « À COMPLÉTER », puis faire confirmer par le comptable les valeurs « À VÉRIFIER ». La purge automatique des prospects ne démarre qu'une fois leur durée de conservation confirmée.
- Fichiers non supprimés après 10 tentatives : ils apparaissent dans les journaux Vercel (« intervention requise »). Les lignes correspondantes sont dans la table `fichiers_a_supprimer` : supprimer les fichiers à la main dans Storage, puis les lignes.
- **Limitation de débit** (Vercel > Firewall, offre Pro) : la limitation de Supabase compte les tentatives sur l'adresse du serveur Vercel, pas sur celle du visiteur. Ajouter une règle de limitation par adresse IP sur `/connexion`, `/mot-de-passe-oublie`, `/auth/*`, `/d/*` et `/f/*` (par exemple 30 requêtes par minute et par IP ; valeur **À VÉRIFIER** à l'usage). **Non répétée.**
- **Durée des sessions** (Supabase > Authentication > Sessions, offre Pro) : durée maximale (par exemple 30 jours) et déconnexion après inactivité (par exemple 7 jours). Valeurs à choisir avec Yorick. **Non répétée.**
- Actions GitHub : épinglées par empreinte (fait en Phase 8). Pour les mettre à jour, remplacer l'empreinte par celle de la nouvelle étiquette officielle (jamais une étiquette seule).

## 5. Sauvegardes et restauration

- **Sauvegarde de l'hébergeur** : quotidienne sur l'offre payante de Supabase (durée de rétention selon l'offre, **À VÉRIFIER**). Elle couvre la base, **pas** forcément les fichiers du stockage.
- **Sauvegarde complémentaire chiffrée** (base + fichiers référencés : PDF émis, signatures, justificatifs, photos, logo), une fois par semaine au moins, depuis l'ordinateur du directeur :

  ```
  export DB_URL='<chaîne de connexion directe, Supabase > Project Settings > Database>'
  export NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=…
  read -rs SAUVEGARDE_PHRASE && export SAUVEGARDE_PHRASE   # 16 caractères au moins, saisie masquée
  bash scripts/sauvegarde/sauvegarder.sh ~/Sauvegardes/hdecor
  ```

  L'archive est chiffrée (AES-256) : la **phrase secrète** se garde à part (gestionnaire de mots de passe) ; sans elle, l'archive est irrécupérable. Copier l'archive hors de l'ordinateur : disque externe, ou stockage en ligne **en UE** déclaré au registre des traitements (Traitement 5, sous-traitants).
  - Mot de passe de la base dans `~/.pgpass` plutôt que dans `DB_URL` (sinon visible dans la liste des processus).
  - **Rotation** : les archives de plus de 365 jours du dossier sont supprimées à chaque sauvegarde (`SAUVEGARDE_CONSERVATION_JOURS`, durée **À VÉRIFIER**). Les copies hors de l'ordinateur suivent la même règle (à supprimer à la main).
  - **Effacements** : à chaque sauvegarde, garder aussi la liste des clients effacés (identifiants seulement) : `bash scripts/sauvegarde/effacements.sh > effacements.txt`.
- **Restauration** dans une base **vide** (jamais par-dessus la base en service) :

  ```
  DB_CIBLE='<base vide>' EFFACEMENTS=effacements.txt NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
    bash scripts/sauvegarde/restaurer.sh <archive.tar.gz.enc>
  ```

  Le script refuse une base non vide et une phrase fausse, puis contrôle que chaque fichier est présent et que l'empreinte SHA-256 de chaque document émis est identique à celle enregistrée. Avec `EFFACEMENTS=effacements.txt` (la liste la plus récente), les clients effacés après la date de l'archive sont de nouveau effacés : **obligatoire** après la restauration d'une archive ancienne (droit à l'effacement).
- **Testé** sur la pile locale (`bash tests/sauvegarde/restauration.sh` sur la démo : mêmes comptages des 49 tables, invariants respectés, documents identiques). **Non répété** sur Supabase : restaurer une sauvegarde complète dans un projet Supabase neuf (schémas `auth` et `storage` déjà présents) est **À VÉRIFIER** ; à répéter une fois sur un projet de test avant la mise en service, puis une fois par an.

## 6. Contrôles après chaque déploiement

- [ ] `node scripts/verifier-auth.mjs` (variables publiques de production) : 4 fois « OK ».
- [ ] Connexion de Yorick, double authentification demandée.
- [ ] Une tâche planifiée appelée à la main : `curl -H "Authorization: Bearer <CRON_SECRET>" https://<domaine>/api/cron/conservation` répond 200 ; sans l'en-tête, 401.
- [ ] Un email de test reçu (envoi d'un devis de test à sa propre adresse) : expéditeur du domaine, pas en indésirables, lien qui s'ouvre.
- [ ] En-têtes de sécurité présents (outil du navigateur > Réseau > en-têtes de la page) : `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`.
- [ ] Un aperçu de devis en PDF s'ouvre (logo, mentions).
- [ ] Limitation de débit active : une rafale de 50 requêtes en une minute sur `/connexion` depuis la même adresse reçoit des réponses 429. Durée de session réglée (Supabase > Authentication > Sessions).

## 7. Migrations après la mise en service

- La mise en service est marquée par une **étiquette git** (par exemple `v1.0.0`). À partir de là, une migration déjà appliquée en production n'est **plus jamais modifiée** : tout changement passe par une **nouvelle** migration (pendant la construction, certaines ont été modifiées sur place, ce qui n'est sans danger que sans base de production).
- Avant chaque `db push` : sauvegarde (tableau de bord), puis migration essayée sur la pile locale (`npm run local:start`, `npm run test:db`).

## 8. Retour arrière

- **Application** : Vercel > Deployments > le déploiement précédent > « Promote to Production » (immédiat, sans perte de données).
- **Base** : pas de migration « retour arrière ». Une nouvelle migration corrige la précédente ; en dernier recours, restauration de la sauvegarde de l'hébergeur (perte des saisies faites depuis : à éviter).
- **Documents émis** : jamais supprimés ni régénérés ; une erreur sur une facture se corrige par un avoir.
