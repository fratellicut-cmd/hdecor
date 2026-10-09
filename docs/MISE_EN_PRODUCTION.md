# Mise en production (Supabase + Vercel)

> À faire par le directeur, guidé par Claude Code. **Aucun mot de passe ni clé n'est jamais transmis à Claude Code** : les valeurs se saisissent directement dans les tableaux de bord.

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
- Restes connus, à traiter avant l'ouverture au public :
  - limitation des tentatives de connexion par adresse IP du client (aujourd'hui, Supabase compte les tentatives sur l'adresse du serveur Vercel) ;
  - durée maximale des sessions (`[auth.sessions]`, offre Pro) ;
  - épinglage des actions GitHub par empreinte.
