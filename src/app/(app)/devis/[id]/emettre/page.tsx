import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { chargerDevis, preparerEmission } from '@/lib/devis';
import { clientServeur } from '@/lib/supabase/serveur';
import { FormulaireEmission } from '@/components/devis/Formulaires';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';
import { formaterDate } from '@/domain/formats';

export const metadata: Metadata = { title: 'Émettre le devis' };

const LIENS: Record<string, { href: (id: string, chantier: string | null, client: string) => string; libelle: string }> = {
  parametres: { href: () => '/parametres', libelle: 'Paramètres' },
  client: { href: (_, __, client) => `/clients/${client}/modifier`, libelle: 'Fiche client' },
  chantier: { href: (_, chantier) => (chantier ? `/chantiers/${chantier}/modifier` : '/chantiers'), libelle: 'Chantier' },
  devis: { href: (id) => `/devis/${id}`, libelle: 'Devis' },
};

export default async function PageEmettre({ params }: PageProps<'/devis/[id]/emettre'>) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sb = await clientServeur();
  const c = await chargerDevis(id.data, sb);
  if (!c) notFound();
  if (c.devis.statut !== 'brouillon') redirect(`/devis/${id.data}`);
  const { data: prev } = await sb.rpc('numero_devis_previsionnel', { p_devis_id: id.data });
  const { numero, date_emission: date } = (prev ?? {}) as { numero?: string; date_emission?: string };
  if (!numero || !date) throw new Error('Numéro prévisionnel indisponible.');
  const prep = await preparerEmission(sb, c, date);
  const bloquants = prep.manques.filter((m) => m.bloquant);
  const signales = prep.manques.filter((m) => !m.bloquant);
  const sansLigne = !c.lignes.some((l) => l.type === 'ligne' && !l.optionnelle);
  const bloque = bloquants.length > 0 || prep.aCompleter.length > 0 || sansLigne;

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/devis/${id.data}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← Retour au brouillon</Link>
      <h1 className="text-2xl font-bold">Émettre le devis</h1>
      <p>Numéro qui sera attribué : <strong>{numero}{c.devis.version! > 1 ? ` (version ${c.devis.version})` : ''}</strong>, daté du {formaterDate(date)}.</p>
      {bloquants.length || prep.aCompleter.length || sansLigne ? (
        <Carte titre="À corriger avant d’émettre">
          <ul className="flex flex-col gap-2">
            {bloquants.map((m) => (
              <li key={m.cle} className="flex flex-wrap items-center justify-between gap-2 font-semibold text-danger">
                {m.message}
                <Link href={LIENS[m.ou]!.href(id.data, c.devis.chantier_id, c.devis.client_id)} className="inline-flex min-h-12 items-center text-encre underline underline-offset-4">
                  {LIENS[m.ou]!.libelle}
                </Link>
              </li>
            ))}
            {prep.aCompleter.length ? <li className="font-semibold text-danger">Prix à compléter : {prep.aCompleter.join(', ')}.</li> : null}
            {sansLigne ? <li className="font-semibold text-danger">Ajoutez au moins une ligne chiffrée (hors option).</li> : null}
          </ul>
        </Carte>
      ) : <Message type="succes">Toutes les mentions obligatoires sont renseignées.</Message>}
      {signales.length ? (
        <Carte titre="Points signalés (non bloquants)">
          <ul className="list-disc pl-5 text-sm">{signales.map((m) => <li key={m.cle}>{m.message}</li>)}</ul>
        </Carte>
      ) : null}
      <a href={`/devis/${id.data}/pdf`} target="_blank" rel="noopener"
        className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-anthracite bg-white px-4 font-semibold">Relire l’aperçu du PDF</a>
      <FormulaireEmission devisId={id.data} textes={prep.textesAVerifier} bloque={bloque} />
    </div>
  );
}
