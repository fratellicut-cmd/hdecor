import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { formaterDate, formaterEuros } from '@/domain/formats';
import { libelleStatut } from '@/domain/statuts';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Devis' };

const FILTRES = { en_cours: 'En cours', brouillon: 'Brouillons', accepte: 'Acceptés', tous: 'Tous' } as const;

export default async function PageDevis({ searchParams }: PageProps<'/devis'>) {
  await verifierSession();
  const sp = await searchParams;
  const filtre = z.enum(['en_cours', 'brouillon', 'accepte', 'tous']).catch('en_cours').parse(sp.filtre);
  const supabase = await clientServeur();
  let requete = supabase.from('v_devis')
    .select('id, numero, version, statut, statut_affiche, objet, date_emission, valide_jusqu_au, total_ttc_cents, regime_tva, copie_client, client_id, created_at')
    .order('created_at', { ascending: false }).limit(200);
  if (filtre === 'en_cours') requete = requete.in('statut', ['brouillon', 'envoye']);
  if (filtre === 'brouillon') requete = requete.eq('statut', 'brouillon');
  if (filtre === 'accepte') requete = requete.eq('statut', 'accepte');
  const { data, error } = await requete;
  // Nom du client : copie figée pour un devis émis, fiche client pour un brouillon.
  const idsClients = [...new Set((data ?? []).filter((d) => !d.copie_client).map((d) => d.client_id!))];
  const { data: clients } = idsClients.length
    ? await supabase.from('clients').select('id, type, nom, prenom, raison_sociale').in('id', idsClients)
    : { data: [] };
  const nomClient = (d: NonNullable<typeof data>[number]) => (d.copie_client as { nom_affiche?: string } | null)?.nom_affiche
    ?? (() => { const c = clients?.find((x) => x.id === d.client_id); return c ? (c.type === 'professionnel' && c.raison_sociale) || [c.prenom, c.nom].filter(Boolean).join(' ') : ''; })();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Devis</h1>
        <Link href="/devis/nouveau" className="inline-flex min-h-12 items-center rounded-xl bg-anthracite px-5 font-semibold text-creme">+ Nouveau</Link>
      </div>
      {sp.supprime === '1' ? <Message type="succes">Brouillon supprimé.</Message> : null}
      <nav aria-label="Filtres" className="flex flex-wrap gap-2">
        {Object.entries(FILTRES).map(([k, l]) => (
          <Link key={k} href={k === 'en_cours' ? '/devis' : `/devis?filtre=${k}`} aria-current={filtre === k ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border-2 px-4 font-semibold ${filtre === k ? 'border-anthracite bg-anthracite text-creme' : 'border-trait bg-white'}`}>
            {l}
          </Link>
        ))}
      </nav>
      {error ? <Message type="erreur">La liste n’a pas pu être chargée. Rechargez la page.</Message> : null}
      {!error && !data?.length ? <p className="rounded-xl border border-trait bg-white p-4 text-encre-douce">Aucun devis ici. Touchez « + Nouveau » ou partez d’un chantier.</p> : null}
      <ul className="flex flex-col gap-2">
        {(data ?? []).map((d) => (
          <li key={d.id}>
            <Link href={`/devis/${d.id}`} className="flex min-h-16 flex-col justify-center rounded-xl border border-trait bg-white px-4 py-2">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{d.numero ? `${d.numero}${d.version! > 1 ? ` v${d.version}` : ''}` : 'Brouillon'} · {nomClient(d)}</span>
                <span className="font-semibold">{formaterEuros(d.total_ttc_cents!)}</span>
              </span>
              <span className="text-sm text-encre-douce">
                {[libelleStatut(d.statut_affiche), d.objet, d.date_emission ? `émis le ${formaterDate(d.date_emission)}` : null,
                  d.statut === 'envoye' && d.valide_jusqu_au ? `valable jusqu’au ${formaterDate(d.valide_jusqu_au)}` : null].filter(Boolean).join(' · ')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
