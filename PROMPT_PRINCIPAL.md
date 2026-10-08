# PROMPT PRINCIPAL : Application H'DECOR (devis, factures, métré, calcul peinture)

> À coller dans Claude Code, une fois le dossier `.claude/agents/` et le fichier `CLAUDE.md` en place (voir LISEZ-MOI.md).

---

Tu es le directeur technique et l'architecte logiciel senior de ce projet. Tu vas construire de bout en bout une application web complète (mobile-first, installable en PWA) pour un artisan peintre en bâtiment. Tu travailles avec une équipe d'agents de contrôle (dossier `.claude/agents/`) qui valident ton travail. Tu es rigoureux, tu ne devines pas, tu ne maquilles rien.

## 1. CONTEXTE CLIENT

- Entreprise : **H'DECOR EI** (peinture & décoration), entreprise individuelle
- Dirigeant : Yorick Heussler
- Adresse : 34 Rue Dejonc, 57290 Serémange-Erzange, France
- Téléphone : 07 70 33 74 07
- Email : yorick.heussler@gmail.com
- SIRET, assurance décennale, RC Pro, IBAN, médiateur de la consommation : **à saisir dans les Paramètres, jamais en dur dans le code**
- Logo : grand « H » doré avec « DECOR » intégré et la mention « peinture & décoration » en dessous. Fichier à fournir par le client (le placer dans `/public/brand/`). Charte : doré en dégradé (#B8860B vers #E6C068), anthracite (#1F1F1F), blanc cassé (#FAF8F4). Style premium, sobre, lisible.

## 2. OBJECTIF PRODUIT

Permettre à Yorick, sur place chez le client et depuis son téléphone, de :
1. mesurer les pièces et obtenir les surfaces exactes,
2. obtenir automatiquement les quantités de peinture, le nombre de pots, la liste d'achat et le temps de travail,
3. sortir un devis professionnel conforme, le faire signer sur place,
4. le transformer en factures (acompte, situation, finale) conformes,
5. suivre les paiements, relancer les impayés, voir sa rentabilité,
6. préparer sa comptabilité (livre des recettes, achats, export comptable).

Critère de réussite : Yorick fait un devis complet de 4 pièces en moins de 5 minutes, sans erreur de calcul, et chaque document émis est conforme.

## 3. STACK

- Next.js (App Router, dernière version stable) + TypeScript strict + Tailwind CSS + shadcn/ui
- Supabase : PostgreSQL, Auth, Storage (buckets privés), Row Level Security sur toutes les tables
- Validation des entrées : zod, côté serveur obligatoire
- PDF : génération serveur (react-pdf ou équivalent), charte H'DECOR
- Emails : Resend (PDF en pièce jointe + lien de consultation sécurisé)
- Paiement en ligne optionnel : Stripe
- Tests : Vitest (unitaires, calculs) + Playwright (parcours)
- PWA : installable, saisie du métré possible hors-ligne avec synchronisation
- Déploiement : Vercel
- Multi-entreprise dès la conception : chaque table porte un `organisation_id` avec RLS, pour pouvoir proposer l'outil à d'autres artisans plus tard sans refonte

## 4. RÈGLES TECHNIQUES TRANSVERSES

1. **Argent en centimes (entiers)**, jamais en flottants. Un type `Money` ou des fonctions utilitaires dédiées.
2. **Surfaces et quantités** : calculs en décimal contrôlé, arrondis définis explicitement et testés (par défaut 2 décimales pour les m², arrondi au conditionnement supérieur pour les pots).
3. **TVA** : calculée par taux sur le total HT de chaque taux, puis arrondie au centime. Ne jamais sommer des TVA arrondies ligne par ligne sans décision documentée.
4. **Paramétrable** : taux de TVA, marge de perte, marges commerciales, rendements, temps de pose, seuils, taux de pénalités, durée de validité des devis : tout en base ou en configuration, rien en dur.
5. **Documents émis immuables** : une facture émise ne se modifie ni ne se supprime. Correction uniquement par avoir. Un devis envoyé est figé (nouvelle version à la place).
6. **Numérotation** chronologique, sans trou, sans doublon, atomique (séquence en base avec verrou), préfixée : `DEV-AAAA-0001`, `FAC-AAAA-0001`, `AVO-AAAA-0001`.
7. **Journal d'audit** : qui a fait quoi et quand sur les devis, factures et paiements.
8. **Interface 100 % française**, formats français (€, `JJ/MM/AAAA`, virgule décimale).
9. **Mobile-first** : boutons d'au moins 44 px, clavier numérique pour les nombres, contraste élevé pour lecture en plein soleil, mode sombre optionnel.
10. **Aucune donnée inventée présentée comme réelle** : références produits, prix, taux, textes de loi. Tout ce qui n'est pas confirmé est marqué « À VÉRIFIER » dans l'interface et dans la base.

## 5. MODULES (spécification fonctionnelle)

### 5.1 Authentification et paramètres de l'entreprise
- Connexion email + mot de passe, option lien magique, double authentification optionnelle
- Paramètres : raison sociale, forme juridique (EI), SIRET, adresse, téléphone, email, logo, IBAN/BIC
- Statut fiscal : **franchise en base de TVA** (mention « TVA non applicable, art. 293 B du CGI ») ou **assujetti à la TVA**. Le choix pilote tout le moteur de documents.
- Assurances : décennale et RC Pro (assureur, numéro de contrat, période, zone géographique couverte)
- Médiateur de la consommation (nom, coordonnées du site)
- Conditions par défaut : délai de paiement, taux de pénalités de retard, indemnité forfaitaire de recouvrement (40 €), escompte, durée de validité des devis, pourcentage d'acompte par défaut, marge de perte peinture, coefficient de marge
- Mentions personnalisables en pied de document

### 5.2 Clients
- Particulier ou professionnel (raison sociale, SIRET, n° TVA intracommunautaire si pro)
- Adresse de facturation et adresse de chantier distinctes
- Téléphone, email, notes, source du contact
- Historique complet (devis, factures, chantiers, paiements, photos)
- Recherche instantanée, filtres, export CSV
- Gestion du consentement RGPD, export et anonymisation sur demande (en respectant la conservation légale des factures)

### 5.3 Chantiers et métré
- Un chantier = un client + une adresse + plusieurs pièces + statut (à planifier, en cours, terminé, facturé, payé)
- Pièce : nom, longueur, largeur, hauteur sous plafond, étage, état du support, notes, photos
- Ouvertures à déduire : portes (83 x 204 cm par défaut, modifiable), fenêtres, baies, avec dimensions et quantité, ou saisie directe en m²
- Éléments : plinthes et corniches (ml), portes et fenêtres à peindre (unité ou m² selon le mode de chiffrage), radiateurs, volets, escaliers, rambardes
- Surfaces calculées automatiquement : murs, plafond, plinthes, boiseries, avec le détail de calcul visible
- Pièces non rectangulaires : saisie par murs individuels (longueur de chaque mur) en plus du mode L x l
- Mode « pièce dupliquée » (x chambres identiques)
- Photos avec annotation simple, rattachées à la pièce
- Fonctionnement hors-ligne avec file de synchronisation

### 5.4 Calculateur de peinture (module clé)
Pour chaque surface ou poste de travaux :
- Support : plâtre neuf, ancienne peinture, béton, enduit, bois brut, bois verni, métal, papier peint, carrelage, autre
- Préparation, chaque étape cochable avec temps et matière associés : dépose de papier peint, décapage, lessivage, rebouchage, ponçage, enduit (une ou deux passes), bande à joint, protection du chantier (bâches, adhésifs), impression ou sous-couche
- Finition : produit choisi dans le catalogue, finition (mat, satin, brillant), nombre de couches
- Calcul automatique :
  - litres = surface ÷ rendement (m²/L) × nombre de couches × (1 + marge de perte)
  - optimisation des conditionnements (1 L, 2,5 L, 5 L, 10 L, 15 L) : combinaison qui couvre le besoin au plus bas coût, avec le reste affiché
  - coût matière HT, temps de main-d'œuvre, prix de vente avec marge
- Récapitulatif chantier : **liste d'achat** par produit avec référence, teinte, litres, nombre de pots par format, coût, exportable en PDF et partageable par message
- Avertissement visible : « Rendements indicatifs : se référer à la fiche technique du fabricant et au support réel. »
- Valeurs indicatives par défaut, toutes modifiables et marquées « À VÉRIFIER » :
  - sous-couche / impression : 8 à 12 m²/L
  - acrylique murs et plafonds : 10 à 12 m²/L par couche
  - glycéro ou laque boiseries : 12 à 14 m²/L
  - lasure, vernis : 10 à 14 m²/L
  - enduit de rebouchage : environ 1 kg/m² par mm d'épaisseur

### 5.5 Catalogue produits, références et teintes
- Produit : marque, gamme, référence fabricant, désignation, type (sous-couche, acrylique, glycéro, façade, lasure, vernis, enduit, anti-humidité, etc.), usage (mur, plafond, boiserie, extérieur, sol), finition, conditionnements disponibles, rendement, couches recommandées, temps de séchage, prix d'achat HT par format, fournisseur, lien fiche technique, statut de vérification (vérifié / À VÉRIFIER, date de dernière vérification)
- Marques de départ (sans références ni prix inventés) : Tollens, Dulux Valentine, Sikkens, Zolpan, Seigneurie, Ripolin, Levis, Farrow & Ball, Little Greene. Le catalogue est livré **avec la structure et quelques lignes d'exemple clairement marquées fictives**. Yorick saisit ou importe ses vraies références.
- Import CSV avec modèle fourni, contrôle des erreurs ligne par ligne, aperçu avant validation ; export CSV
- Nuancier : teintes avec nom, code (RAL, NCS, code fabricant), aperçu couleur, associables à une pièce ou un chantier
- Historique des prix d'achat (évolution tarif fournisseur) et alerte si un produit utilisé dans un devis en cours a changé de prix
- Bibliothèque de prestations : libellé, unité (m², ml, unité, heure, forfait), prix unitaire HT, taux de TVA, description détaillée réutilisable

### 5.6 Devis
- Création depuis un chantier : import automatique des postes (surfaces, préparation, peinture, main-d'œuvre) + lignes libres + titres de section + sous-totaux + remises (ligne ou globale)
- Ligne : désignation détaillée, quantité, unité, prix unitaire HT, taux de TVA, total
- TVA par ligne : 20 %, 10 %, 5,5 %, 0 %. Si 10 % ou 5,5 % : génération de l'attestation simplifiée correspondante à faire signer par le client (**À VÉRIFIER** : formulaires et conditions en vigueur)
- Option : prestations optionnelles que le client peut accepter ou refuser
- Mentions obligatoires sur le PDF : date, numéro, validité, identité complète de l'entreprise, identité du client, adresse du chantier, description détaillée des prestations, prix unitaires HT, TVA par taux, total TTC, date de début et durée estimée des travaux, conditions de paiement, assurance décennale et RC Pro, médiateur de la consommation, mention du droit de rétractation de 14 jours avec formulaire joint lorsque le contrat est signé hors établissement, mention « devis reçu avant l'exécution des travaux » (**À VÉRIFIER** par le comptable)
- Acompte paramétrable et échéancier
- Statuts : brouillon, envoyé, consulté, accepté, refusé, expiré
- Signature électronique du client sur téléphone/tablette ou via lien email, horodatage, adresse IP, PDF signé archivé
- Relances automatiques si non signé après X jours (paramétrable, désactivable)
- Duplication, versions successives, comparatif entre versions
- Lien public de consultation sécurisé (jeton long, expiration)

### 5.7 Factures
- Création en un clic depuis un devis accepté, ou facture libre
- Types : acompte, situation (pourcentage d'avancement par ligne), finale (déduction automatique des acomptes), avoir
- Autoliquidation de TVA en sous-traitance du bâtiment : option par facture avec mention dédiée (**À VÉRIFIER** par le comptable)
- Mentions obligatoires : numéro unique chronologique, date d'émission, date de la prestation, vendeur (raison sociale, EI, SIRET, adresse), client, détail HT, TVA par taux, TTC, date d'échéance, taux des pénalités de retard, indemnité forfaitaire de 40 €, conditions d'escompte, mention de TVA selon statut, assurance décennale, IBAN
- Statuts : brouillon, émise, envoyée, partiellement payée, payée, en retard, annulée par avoir
- Paiements : virement, chèque, espèces, carte, date, montant, reste à payer ; rapprochement simple
- Lien de paiement Stripe optionnel et QR code de virement
- Relances impayés en 3 niveaux avec modèles de messages prêts à l'emploi
- Facturation électronique : champs et export préparés pour **Factur-X** (EN 16931 profil adapté). Réception de factures électroniques déjà obligatoire depuis septembre 2026 pour toutes les entreprises, émission obligatoire pour les petites entreprises à partir de septembre 2027 : **À VÉRIFIER** auprès de l'administration et du comptable, ainsi que le choix de la plateforme agréée

### 5.8 Tableau de bord
- Chiffre d'affaires mois / trimestre / année, comparaison avec l'année précédente
- Devis en attente, taux de transformation, délai moyen de signature
- Factures impayées et en retard, montant dû
- Chantiers en cours et à venir
- Marge par chantier (matière + temps réel vs prévu)
- Jauge des **seuils de la micro-entreprise** (plafond de CA, seuil de franchise de TVA), valeurs paramétrables, alerte à 80 % et 95 % (**À VÉRIFIER** : seuils en vigueur)
- Trésorerie prévisionnelle simple (factures à encaisser, acomptes attendus)

### 5.9 Planning
- Calendrier des chantiers (jour / semaine / mois), durée estimée issue du calculateur
- Rappels : début de chantier, séchage entre couches, relance devis, échéance facture
- Export vers Google Agenda (fichier ICS)

### 5.10 Comptabilité simplifiée
- Livre des recettes généré depuis les paiements encaissés
- Registre des achats (peintures, matériel, essence, outillage) avec photo du justificatif
- Catégories de dépenses, rattachement optionnel à un chantier (calcul de rentabilité réelle)
- Exports mensuels CSV / Excel et PDF pour l'expert-comptable
- Suivi du matériel et de l'outillage (liste, date d'achat, valeur)

### 5.11 Documents et chantier
- Procès-verbal de réception des travaux (avec réserves éventuelles et date de levée), signature électronique
- Documents chantier : fiches techniques, attestations, assurances, plans
- Galerie avant / après exportable pour le portfolio ou les réseaux sociaux
- Fiche de suivi chantier (check-list de fin de chantier : nettoyage, retouches, remise des clés)
- Demande d'avis client après paiement (lien Google)

## 6. JEU DE TESTS DE RÉFÉRENCE (calculés à la main, à intégrer dans les tests)

**Surfaces et peinture**
- Pièce 4,00 m × 3,00 m, hauteur 2,50 m, une porte 0,83 × 2,04 et une fenêtre 1,20 × 1,15
  - périmètre = 14,00 m ; murs bruts = 35,00 m²
  - ouvertures = 1,6932 + 1,3800 = 3,0732 m²
  - murs nets = **31,9268 m²** (affiché 31,93 m²)
  - plafond = **12,00 m²**
- Murs en acrylique 10 m²/L, 2 couches, marge de perte 10 % :
  - 31,9268 ÷ 10 × 2 = 6,38536 L ; × 1,10 = **7,0239 L**
  - combinaison attendue : 1 pot de 5 L + 1 pot de 2,5 L = 7,5 L (selon prix, comparer avec 10 L seul et justifier le choix)

**TVA**
- 1 000,00 € HT à 10 % : TVA 100,00 €, TTC 1 100,00 €
- 300,00 € HT à 20 % + 700,00 € HT à 10 % : TVA 60,00 + 70,00 = 130,00 €, TTC 1 130,00 €
- Cas d'arrondi : 3 lignes de 33,33 € HT à 20 %. Par total : 99,99 × 0,20 = 19,998, soit 20,00 €. Par ligne : 3 × 6,67 = 20,01 €. Le système applique la méthode « par total et par taux » et le test vérifie 20,00 €.

**Acompte et facture finale**
- Devis 5 000,00 € HT à 10 % : TTC 5 500,00 €. Acompte 30 % = 1 650,00 € TTC. Facture finale = 5 500,00 − 1 650,00 = **3 850,00 € TTC**, avec détail HT / TVA de l'acompte déduit.

**Numérotation**
- 50 créations simultanées de factures doivent produire 50 numéros consécutifs, sans doublon ni trou.

## 7. ÉQUIPE D'AGENTS ET RÈGLES DE QUALITÉ (NON NÉGOCIABLES)

Agents disponibles dans `.claude/agents/` : `chef-de-projet`, `qa-calculs`, `auditeur-legal`, `auditeur-peinture`, `securite-rgpd`, `relecteur-code`, `testeur-chantier`.

**Règle d'or :** aucune phase n'est terminée tant que les agents concernés n'ont pas rendu le verdict **APPROUVÉ**. Sur un **REFUSÉ**, tu corriges puis tu relances l'agent, sans contourner le point bloquant et sans me demander de l'accepter.

**Boucle obligatoire pour chaque phase :**
1. Tu construis le module et tu écris les tests en même temps.
2. Tu exécutes les tests, le lint et le build.
3. Tu lances les agents applicables (tableau ci-dessous).
4. Tu corriges tous les bloquants et relances jusqu'à APPROUVÉ. Maximum 5 boucles : au-delà, tu t'arrêtes et tu m'expliques le blocage.
5. Tu me présentes : ce qui est fait, ce qui a été corrigé suite aux audits, comment le tester, ce qui nécessite MA décision ou celle du comptable.

**Définition de « terminé » :**
- Tous les tests passent (résultat réellement exécuté et collé)
- TypeScript, lint et build sans erreur ni warning
- Aucun point bloquant ouvert
- Un PDF réel généré et contrôlé pour tout document concerné
- Aucune donnée inventée présentée comme réelle

**Interdictions absolues :**
- Affirmer qu'un test passe sans l'avoir exécuté
- Désactiver, ignorer ou affaiblir un test ou un contrôle pour faire passer le build
- Inventer une référence produit, un prix, un taux ou un article de loi
- Laisser un TODO critique ou une fonction bouchonnée sans l'annoncer
- Deviner quand tu as un doute : tu le signales

## 8. PLAN D'EXÉCUTION PAR PHASES

**Phase 0 : Cadrage (tu t'arrêtes ensuite et tu attends ma validation)**
Livrables : architecture, schéma SQL complet avec RLS, arborescence des pages, liste des composants, plan de tests, liste des questions ouvertes (statut fiscal de Yorick, assurance, médiateur, logo, fournisseurs de peinture).
Agents : chef-de-projet, securite-rgpd.

**Phase 1 : Fondations**
Auth, paramètres entreprise, clients, numérotation atomique, journal d'audit, PWA de base.
Agents : securite-rgpd, relecteur-code, testeur-chantier.

**Phase 2 : Métré et calculateur**
Chantiers, pièces, ouvertures, surfaces, calculateur de peinture, liste d'achat.
Agents : qa-calculs, auditeur-peinture, relecteur-code, testeur-chantier.

**Phase 3 : Catalogue**
Produits, import / export CSV, nuancier, historique des prix.
Agents : auditeur-peinture, qa-calculs, relecteur-code.

**Phase 4 : Devis**
Création, PDF conforme, signature électronique, envoi email, relances, versions.
Agents : qa-calculs, auditeur-legal, securite-rgpd, relecteur-code, testeur-chantier.

**Phase 5 : Factures et paiements**
Acompte, situation, finale, avoir, paiements, relances, Factur-X préparé, Stripe optionnel.
Agents : qa-calculs, auditeur-legal, securite-rgpd, relecteur-code, testeur-chantier.

**Phase 6 : Pilotage**
Tableau de bord, planning, comptabilité simplifiée, exports.
Agents : qa-calculs, relecteur-code, testeur-chantier.

**Phase 7 : Documents et finitions**
PV de réception, galerie avant / après, demandes d'avis, notifications.
Agents : auditeur-legal, securite-rgpd, relecteur-code, testeur-chantier.

**Phase 8 : Recette finale**
Jeu de données de démonstration, parcours bout en bout, audit global par tous les agents, guide utilisateur pour Yorick, guide de déploiement, check-list « avant la première vraie facture » à faire valider par le comptable.
Agents : tous, orchestrés par chef-de-projet.

## 9. DÉMARRAGE

Commence par la **Phase 0** uniquement. Pose-moi d'abord, en une seule fois, les questions dont les réponses changent l'architecture (maximum 8, courtes). Puis livre le cadrage et attends ma validation avant d'écrire du code.
