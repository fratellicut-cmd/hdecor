import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { formaterDate, formaterEuros } from '@/domain/formats';
import { LIBELLES_STATUT_FACTURE, LIBELLES_TYPE_FACTURE, type TypeFacture } from '@/domain/factures';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Factures' };

const FILTRES = { a_encaisser: 'À encaisser', en_retard: 'En retard', brouillon: 'Brouillons', tous: 'Toutes' } as const;

export default async function PageFactures({ searchParams }: PageProps<'/factures'>) {
  await verifierSession();
  const sp = await searchParams;
  const filtre = z.enum(['a_encaisser', 'en_retard', 'brouillon', 'tous']).catch('a_encaisser').parse(sp.filtre);
  const supabase = await clientServeur();
  let requete = supabase.from('v_factures')
    .select('id, numero, type, statut, statut_affiche, date_emission, date_echeance, net_a_payer_cents, reste_a_payer_cents, reste_a_rembourser_cents, copie_client, client_id, created_at')
    .order('created_at', { ascending: false }).limit(200);
  if (filtre === 'a_encaisser') requete = requete.eq('statut', 'emise').neq('type', 'avoir').gt('reste_a_payer_cents', 0);
  if (filtre === 'en_retard') requete = requete.eq('statut_affiche', 'en_retard');
  if (filtre === 'brouillon') requete = requete.eq('statut', 'brouillon');
  const [{ data, error }, { data: incidents }] = await Promise.all([
    requete,
    supabase.from('incidents_paiement').select('facture_id, montant_cents').is('traite_le', null),
  ]);
  type F = NonNullable<typeof data>[number];
  // Nom du client : copie figée pour un document émis, fiche client pour un brouillon.
  const idsClients = [...new Set((data ?? []).filter((f) => !f.copie_client).map((f) => f.client_id!))];
  const { data: clients } = idsClients.length
    ? await supabase.from('clients').select('id, type, nom, prenom, raison_sociale').in('id', idsClients)
    : { data: [] };
  const nomClient = (f: F) => (f.copie_client as { nom_affiche?: string } | null)?.nom_affiche
    ?? (() => { const c = clients?.find((x) => x.id === f.client_id); return c ? (c.type === 'professionnel' && c.raison_sociale) || [c.prenom, c.nom].filter(Boolean).join(' ') : ''; })();
  const totalAEncaisser = filtre === 'a_encaisser' || filtre === 'en_retard'
    ? (data ?? []).reduce((a, f) => a + BigInt(f.reste_a_payer_cents ?? 0), 0n) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Factures</h1>
        <Link href="/factures/nouvelle" className="inline-flex min-h-12 items-center rounded-xl bg-anthracite px-5 font-semibold text-creme">+ Nouvelle</Link>
      </div>
      {sp.supprime === '1' ? <Message type="succes">Brouillon supprimé.</Message> : null}
      {incidents?.length ? (
        <Message type="erreur">
          {incidents.length} paiement{incidents.length > 1 ? 's' : ''} par carte encaissé{incidents.length > 1 ? 's' : ''} par Stripe mais non enregistré{incidents.length > 1 ? 's' : ''} : à rembourser.{' '}
          {incidents.map((i) => <Link key={i.facture_id} href={`/factures/${i.facture_id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">voir la facture</Link>)}
        </Message>
      ) : null}
      <nav aria-label="Filtres" className="flex flex-wrap gap-2">
        {Object.entries(FILTRES).map(([k, l]) => (
          <Link key={k} href={k === 'a_encaisser' ? '/factures' : `/factures?filtre=${k}`} aria-current={filtre === k ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border-2 px-4 font-semibold ${filtre === k ? 'border-anthracite bg-anthracite text-creme' : 'border-trait bg-white'}`}>
            {l}
          </Link>
        ))}
      </nav>
      {error ? <Message type="erreur">La liste n’a pas pu être chargée. Rechargez la page.</Message> : null}
      {totalAEncaisser !== null && data?.length ? <p className="font-semibold">Reste à encaisser : {formaterEuros(totalAEncaisser)}</p> : null}
      {!error && !data?.length ? <p className="rounded-xl border border-trait bg-white p-4 text-encre-douce">Aucune facture ici. Touchez « + Nouvelle » ou partez d’un devis signé.</p> : null}
      <ul className="flex flex-col gap-2">
        {(data ?? []).map((f) => {
          const avoir = f.type === 'avoir';
          const retard = f.statut_affiche === 'en_retard';
          return (
            <li key={f.id}>
              <Link href={`/factures/${f.id}`} className={`flex min-h-16 flex-col justify-center rounded-xl border bg-white px-4 py-2 ${retard ? 'border-danger' : 'border-trait'}`}>
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{f.numero ?? 'Brouillon'} · {nomClient(f)}</span>
                  {/* Montant mis en avant : ce qui reste à encaisser (le net de la facture sinon). */}
                  <span className="text-lg font-bold">{avoir ? '−' : ''}{formaterEuros(!avoir && f.statut === 'emise' ? f.reste_a_payer_cents! : f.net_a_payer_cents!)}</span>
                </span>
                <span className={`text-sm ${retard ? 'font-semibold text-danger' : 'text-encre-douce'}`}>
                  {[LIBELLES_TYPE_FACTURE[f.type as TypeFacture], LIBELLES_STATUT_FACTURE[f.statut_affiche!] ?? f.statut_affiche,
                    f.date_emission ? `émise le ${formaterDate(f.date_emission)}` : null,
                    !avoir && f.statut === 'emise' && f.reste_a_payer_cents ? `reste ${formaterEuros(f.reste_a_payer_cents)} sur ${formaterEuros(f.net_a_payer_cents!)}, échéance ${formaterDate(f.date_echeance!)}` : null,
                    avoir && f.reste_a_rembourser_cents ? `à rembourser ${formaterEuros(f.reste_a_rembourser_cents)}` : null,
                  ].filter(Boolean).join(' · ')}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
