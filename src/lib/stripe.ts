import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Paiement en ligne par carte (Stripe Checkout), FACULTATIF : actif seulement
 * si STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET sont définies (variables
 * d'environnement serveur, jamais dans le code). Le paiement n'est enregistré
 * que par le webhook signé (voir /api/stripe/webhook), jamais au retour du
 * client. Frais, contrat et remboursements : À VÉRIFIER (compte Stripe).
 */
export function stripeConfigure(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;
}

/** Session de paiement Stripe Checkout ; renvoie l'URL de paiement, ou null si Stripe refuse ou ne répond pas. */
export async function creerSessionPaiement(p: {
  factureId: string; organisationId: string; libelle: string; montantCents: bigint; retour: string;
}): Promise<string | null> {
  const cle = process.env.STRIPE_SECRET_KEY;
  if (!cle || p.montantCents <= 0n) return null;
  const corps = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': p.montantCents.toString(),
    'line_items[0][price_data][product_data][name]': p.libelle.slice(0, 250),
    client_reference_id: p.factureId,
    'metadata[facture_id]': p.factureId,
    'metadata[organisation_id]': p.organisationId,
    success_url: `${p.retour}?paiement=en_cours`,
    cancel_url: `${p.retour}?paiement=annule`,
  });
  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST', body: corps, signal: AbortSignal.timeout(15_000),
      // Même facture, même reste, même heure : Stripe renvoie la même session (deux onglets ne créent pas deux paiements),
      // sans jamais renvoyer une session expirée (24 h).
      headers: { authorization: `Bearer ${cle}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': `hdecor-${p.factureId}-${p.montantCents}-${Math.floor(Date.now() / 3_600_000)}` },
    });
    if (!r.ok) { console.error('Stripe : session refusée', r.status); return null; }
    const s = await r.json() as { url?: unknown };
    return typeof s.url === 'string' && s.url.startsWith('https://checkout.stripe.com/') ? s.url : null;
  } catch {
    console.error('Stripe : injoignable');
    return null;
  }
}

/** Tolérance d'horodatage de la signature (rejeu) : 5 minutes. */
export const TOLERANCE_SIGNATURE_S = 300;

/**
 * Vérifie l'en-tête « Stripe-Signature » (t=…, v1=…) : HMAC-SHA256 du corps
 * BRUT préfixé de l'horodatage, comparé en temps constant, horodatage récent.
 */
export function signatureStripeValide(corps: string, entete: string | null, secret: string, maintenantS = Math.floor(Date.now() / 1000)): boolean {
  if (!entete || !secret) return false;
  const parties = entete.split(',').map((x) => x.trim().split('=') as [string, string]);
  const t = Number(parties.find(([k]) => k === 't')?.[1]);
  const signatures = parties.filter(([k, v]) => k === 'v1' && /^[0-9a-f]{64}$/.test(v ?? '')).map(([, v]) => Buffer.from(v, 'hex'));
  if (!Number.isInteger(t) || Math.abs(maintenantS - t) > TOLERANCE_SIGNATURE_S || !signatures.length) return false;
  const attendu = createHmac('sha256', secret).update(`${t}.${corps}`).digest();
  return signatures.some((s) => s.length === attendu.length && timingSafeEqual(s, attendu));
}
