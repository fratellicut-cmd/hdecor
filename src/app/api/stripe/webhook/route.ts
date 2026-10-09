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
  // Session sans métadonnées de facture : paiement étranger à l'application (autre usage du compte Stripe), ignoré
  // (répondre une erreur ferait réessayer Stripe pendant des jours, jusqu'à désactiver le point d'arrivée).
  if (!s.success) return Response.json({ recu: true, ignore: true });
  if (s.data.payment_status !== 'paid') return Response.json({ recu: true });   // paiement différé : attendu par async_payment_succeeded
  if (s.data.currency !== 'eur') {
    console.error('Stripe : devise inattendue, paiement à traiter à la main', e.id);
    return Response.json({ recu: true });
  }

  const admin = clientAdmin();
  const { facture_id: factureId, organisation_id: organisationId } = s.data.metadata;
  const reference = (s.data.payment_intent ?? s.data.id).slice(0, 140);
  // Événement (ou paiement) déjà enregistré : Stripe le renvoie, rien à faire (avant les contrôles de solde, qui le refuseraient).
  const [parEvenement, parReference] = await Promise.all([
    admin.from('paiements').select('id').eq('stripe_evenement_id', e.id).limit(1),
    admin.from('paiements').select('id').eq('organisation_id', organisationId).eq('mode', 'stripe').eq('reference', reference).limit(1),
  ]);
  if (parEvenement.error || parReference.error) return new Response('Lecture impossible.', { status: 500 });
  if (parEvenement.data.length || parReference.data.length) return Response.json({ recu: true });
  const { error } = await admin.from('paiements').insert({
    organisation_id: organisationId, facture_id: factureId, date_paiement: aujourdHuiParis(), montant_cents: s.data.amount_total,
    mode: 'stripe', reference, stripe_evenement_id: e.id,
  });
  if (!error || error.code === '23505') return Response.json({ recu: true });   // déjà enregistré : idempotent
  if (error.code === 'P0001' || error.code?.startsWith('23')) {
    // Refus métier (facture soldée entre-temps, annulée, paiement déjà enregistré par une autre session…) : l'argent
    // est encaissé par Stripe. Incident CONSIGNÉ et affiché sur la facture, à rembourser dans Stripe.
    const { error: eIncident } = await admin.from('incidents_paiement').insert({
      organisation_id: organisationId, facture_id: factureId, stripe_evenement_id: e.id, reference,
      montant_cents: s.data.amount_total, motif: error.code === 'P0001' ? error.message.slice(0, 300) : 'Paiement déjà enregistré ou refusé par la base.',
    });
    if (!eIncident || eIncident.code === '23505') return Response.json({ recu: true, a_traiter: true });
    console.error('Stripe : incident non consigné, Stripe réessaiera', e.id, eIncident.code);
    return new Response('Enregistrement impossible.', { status: 500 });
  }
  console.error('Stripe : enregistrement impossible, Stripe réessaiera', e.id, error.code);
  return new Response('Enregistrement impossible.', { status: 500 });
}
