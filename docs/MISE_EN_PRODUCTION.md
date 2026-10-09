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
6. Courriels : configurer un SMTP personnalisé (Resend, Phase 4). Le service d'envoi intégré de Supabase est très limité en nombre d'emails par heure.

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

- La tâche planifiée `/api/cron/conservation` est déclarée dans `vercel.json`. Elle tourne chaque nuit à 3 h 17 UTC, et Vercel lui envoie `CRON_SECRET`.

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
