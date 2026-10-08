# Phase 0 : arrêt après 5 boucles (RÉSOLU par la refonte autorisée le 08/10/2026)

> Le directeur a autorisé une boucle supplémentaire dédiée à la refonte, avec les propositions par défaut. La refonte est faite : source unique des cumuls (`solde_facture`, `solde_devis`), avoir plafonné au net, acomptes libérés, client du chantier figé, matrice de tests des rattachements et invariants globaux. Le document est conservé pour l'historique.

État au 08/10/2026. **La Phase 0 n'est pas validée.** Le cahier des charges limite à 5 le nombre de boucles de correction ; au-delà, je m'arrête et j'explique le blocage.

## Verdicts de la 5e boucle

| Agent | Verdict |
|---|---|
| securite-rgpd | **APPROUVÉ**. Aucune faille critique ni haute. Il reste un point moyen, impossible à déclencher avant la Phase 7. |
| chef-de-projet | **REFUSÉ**. Deux bloquants, et une demande d'analyse de cause racine. |

Tests : 161 assertions passent, plus 2 tests de concurrence (`bash tests/db/run.sh`).

## Les deux bloquants restants

1. **Annuler une facture finale qui déduisait un acompte.**
   - Scénario : un devis de 1 000 €, un acompte de 300 € non payé, une finale dont le net à payer est de 700 €.
   - Un avoir de 1 000 € sur cette finale est accepté, alors qu'il devrait être plafonné au net de 700 €.
   - Conséquences :
     - un « remboursement » de 300 € devient possible alors que le client n'a rien payé ;
     - une nouvelle finale de 1 000 € est ensuite acceptée, ce qui fait 1 300 € exigibles pour un devis de 1 000 €.
2. **Le client d'un chantier reste modifiable** après l'émission de documents. Les cumuls par chantier deviennent alors faux, et l'anonymisation peut viser le mauvais client.

## Cause racine (partagée par les refus des boucles 3, 4 et 5)

- **Les cumuls sont calculés à 4 endroits**, avec des règles légèrement différentes :
  - le plafond de facturation (`emettre_facture`) ;
  - le contrôle des paiements et remboursements (`controler_paiement`) ;
  - la vue des factures (`v_factures`) ;
  - la vue des chantiers (`v_chantiers`).

  Le lien entre une finale et ses acomptes déduits n'est pas pris en compte partout.
- **La cohérence des rattachements n'est vérifiée qu'au moment où l'on émet un document**, jamais comme une règle permanente sur le document parent (chantier, client).

Chaque correctif ponctuel fermait un chemin, et l'agent en trouvait un autre. Il faut une refonte de ce sous-ensemble, pas une sixième rustine.

## Refonte proposée (environ une demi-journée de travail, soumise à ton accord)

1. **Une seule fonction de référence** qui calcule, par devis : le net exigible, le déjà facturé, les avoirs (de correction et de réduction), les acomptes déduits et le reste à facturer, tous sur la **même base** (net à payer). Les 4 endroits l'utilisent ; aucun autre calcul.
2. **Avoir plafonné au net à payer** de la facture d'origine, moins les avoirs déjà émis. Si une finale est annulée par un avoir, ses acomptes déduits sont libérés et peuvent être déduits par la finale suivante.
3. **Client du chantier figé** dès qu'un document non brouillon y est rattaché (même règle pour le client d'un devis).
4. **Un test par chemin de rattachement** (`devis_id`, `chantier_id`, `facture_origine_id`, déductions, `devis_ligne_id`, client du chantier), chacun combiné avec les avoirs et les paiements.
5. Une nouvelle passe des deux agents.

## Décisions qui te reviennent

- **Autoriser une boucle supplémentaire** consacrée à cette refonte (le cahier des charges impose de te demander).
- **P23, à trancher avec Yorick :** une facture « libre » (travaux supplémentaires) rattachée au chantier doit-elle compter dans le « facturé » du devis ? Aujourd'hui, oui : un chantier peut apparaître « payé » alors que le devis n'a jamais été facturé. Je propose : **non**. Le « reste à facturer » du devis ne compte que les factures liées au devis.
- **Question pour le comptable :** pour annuler une facture finale qui déduisait des acomptes, faut-il un avoir sur le net ou sur le total ? Et les acomptes sont-ils à re-déduire sur la nouvelle finale ? Proposition par défaut : avoir sur le net, acomptes re-déductibles.

## Point moyen accepté par la sécurité (à traiter au plus tard en Phase 7)

L'effacement RGPD échoue si le client a **signé** une attestation de TVA puis refusé le devis : une attestation signée ne peut plus être supprimée. Il faut décider si on la conserve comme preuve, avec une durée documentée, ou si on prévoit une voie d'effacement contrôlée.
