'use server';

import { redirect } from 'next/navigation';
import { factureParJeton } from '@/lib/facture-publique';
import { jetonBienForme } from '@/lib/liens';
import { envPublique } from '@/lib/env';
import { aujourdHuiParis } from '@/domain/dates';
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
    if (f && f.type !== 'avoir' && f.statut === 'emise' && f.resteAPayerCents > 0n && !(f.paiementApresLe && aujourdHuiParis() < f.paiementApresLe)) {
      url = await creerSessionPaiement({
        factureId: f.factureId, organisationId: f.organisationId, libelle: `${f.titre} (${f.entreprise})`,
        // Adresse de retour SANS le jeton (elle est conservée par Stripe).
        montantCents: f.resteAPayerCents, retour: `${envPublique.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')}/f/retour`,
      });
    }
  } catch { url = null; }
  redirect(url ?? `/f/${jeton}?paiement=indisponible`);
}
