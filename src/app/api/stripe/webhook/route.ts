import { z } from 'zod';
import { clientAdmin } from '@/lib/supabase/admin';
import { signatureStripeValide } from '@/lib/stripe';
import { aujourdHuiParis } from '@/domain/dates';

/**
 * Webhook Stripe (paiement en ligne FACULTATIF). Seule source d'un paiement
 * « stripe » : signature vérifiée (STRIPE_WEBHOOK_SECRET), puis paiement
 * enregistré une seule fois par événement (stripe_evenement_id unique).
 * La facture et l'organisation viennent des métadonnées posées par le serveur
 * à la création de la session, recontrôlées en base.
 */
export const dynamic = 'force-dynamic';

const session = z.object({
  id: z.string(),
  payment_status: z.string(),
  currency: z.string(),
  amount_total: z.number().int().positive(),
  payment_intent: z.string().nullable().optional(),
  metadata: z.object({ facture_id: z.uuid(), organisation_id: z.uuid() }),
});
const evenement = z.object({ id: z.string().min(1).max(255), type: z.string(), data: z.object({ object: z.unknown() }) });

export async function POST(requete: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response('Paiement en ligne non configuré.', { status: 404 });
  const corps = await requete.text();
  if (!signatureStripeValide(corps, requete.headers.get('stripe-signature'), secret)) return new Response('Signature invalide.', { status: 400 });

  let e;
  try { e = evenement.parse(JSON.parse(corps)); } catch { return new Response('Événement illisible.', { status: 400 }); }
  if (e.type !== 'checkout.session.completed' && e.type !== 'checkout.session.async_payment_succeeded') return Response.json({ recu: true });
  const s = session.safeParse(e.data.object);
  if (!s.success) return new Response('Session illisible.', { status: 400 });
  if (s.data.payment_status !== 'paid') return Response.json({ recu: true });   // paiement différé : attendu par async_payment_succeeded
  if (s.data.currency !== 'eur') {
    console.error('Stripe : devise inattendue, paiement à traiter à la main', e.id);
    return Response.json({ recu: true });
  }

  const admin = clientAdmin();
  const { facture_id: factureId, organisation_id: organisationId } = s.data.metadata;
  const { error } = await admin.from('paiements').insert({
    organisation_id: organisationId, facture_id: factureId, date_paiement: aujourdHuiParis(), montant_cents: s.data.amount_total,
    mode: 'stripe', reference: (s.data.payment_intent ?? s.data.id).slice(0, 140), stripe_evenement_id: e.id,
  });
  if (!error || error.code === '23505') return Response.json({ recu: true });   // déjà enregistré : idempotent
  if (error.code === 'P0001' || error.code?.startsWith('23')) {
    // Refus métier (facture soldée entre-temps, annulée…) : l'argent est encaissé par Stripe, à rembourser à la main.
    console.error('Stripe : paiement encaissé mais refusé par la base (remboursement à faire dans Stripe)', e.id, error.code);
    return Response.json({ recu: true, a_traiter: true });
  }
  console.error('Stripe : enregistrement impossible, Stripe réessaiera', e.id, error.code);
  return new Response('Enregistrement impossible.', { status: 500 });
}
