'use server';

import { redirect } from 'next/navigation';
import { factureParJeton } from '@/lib/facture-publique';
import { jetonBienForme, urlPublique } from '@/lib/liens';
import { creerSessionPaiement, stripeConfigure } from '@/lib/stripe';

/**
 * Paiement par carte (Stripe, facultatif). Action PUBLIQUE : l'autorisation est
 * le jeton, revérifié par la base ; le montant est le reste à payer lu en base
 * (jamais une valeur envoyée par le navigateur).
 */
export async function payerEnLigne(jeton: string): Promise<void> {
  if (!jetonBienForme(jeton) || !stripeConfigure()) redirect(`/f/${encodeURIComponent(jeton)}`);
  let url: string | null = null;
  try {
    const f = await factureParJeton(jeton);
    if (f && f.type !== 'avoir' && f.statut === 'emise' && f.resteAPayerCents > 0n) {
      url = await creerSessionPaiement({
        factureId: f.factureId, organisationId: f.organisationId, libelle: `${f.titre} (${f.entreprise})`,
        montantCents: f.resteAPayerCents, retour: urlPublique(jeton, 'f'),
      });
    }
  } catch { url = null; }
  redirect(url ?? `/f/${jeton}?paiement=indisponible`);
}
