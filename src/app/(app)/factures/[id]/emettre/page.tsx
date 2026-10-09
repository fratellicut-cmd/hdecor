import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { chargerFacture, ErreurPreparationFacture, preparerEmissionFacture } from '@/lib/factures';
import { clientServeur } from '@/lib/supabase/serveur';
import { FormulaireEmissionFacture } from '@/components/factures/Formulaires';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';
import { formaterDate, formaterEuros } from '@/domain/formats';

export const metadata: Metadata = { title: 'Émettre la facture' };

const LIENS: Record<string, { href: (id: string, chantier: string | null, client: string) => string; libelle: string }> = {
  parametres: { href: () => '/parametres', libelle: 'Paramètres' },
  client: { href: (_, __, client) => `/clients/${client}/modifier`, libelle: 'Fiche client' },
  chantier: { href: (_, chantier) => (chantier ? `/chantiers/${chantier}/modifier` : '/chantiers'), libelle: 'Chantier' },
  devis: { href: (id) => `/factures/${id}`, libelle: 'Brouillon' },
};

export default async function PageEmettreFacture({ params }: PageProps<'/factures/[id]/emettre'>) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sb = await clientServeur();
  const c = await chargerFacture(id.data, sb);
  if (!c) notFound();
  if (c.facture.statut !== 'brouillon') redirect(`/factures/${id.data}`);
  const { data: prev } = await sb.rpc('numero_facture_previsionnel', { p_facture_id: id.data });
  const { numero, date_emission: date, date_echeance: echeance } = (prev ?? {}) as { numero?: string; date_emission?: string; date_echeance?: string };
  if (!numero || !date || !echeance) throw new Error('Numéro prévisionnel indisponible.');
  const avoir = c.facture.type === 'avoir';
  let prep;
  try { prep = await preparerEmissionFacture(sb, c, date); } catch (e) {
    if (!(e instanceof ErreurPreparationFacture)) throw e;
    return (
      <div className="flex flex-col gap-4">
        <Link href={`/factures/${id.data}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← Retour au brouillon</Link>
        <Message type="erreur">{e.message}</Message>
      </div>
    );
  }
  const bloquants = prep.manques.filter((m) => m.bloquant);
  const signales = prep.manques.filter((m) => !m.bloquant);
  const sansLigne = !c.lignes.some((l) => l.type === 'ligne');
  const aZero = (c.facture.total_ht_cents ?? 0) <= 0;
  const bloque = bloquants.length > 0 || sansLigne || aZero;

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/factures/${id.data}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← Retour au brouillon</Link>
      <h1 className="text-2xl font-bold">{avoir ? 'Émettre l’avoir' : 'Émettre la facture'}</h1>
      <p>
        Numéro qui sera attribué : <strong>{numero}</strong>, daté du {formaterDate(date)}
        {avoir ? '' : <>, à régler au plus tard le <strong>{formaterDate(echeance)}</strong></>}.
        {' '}Montant : <strong>{formaterEuros(c.facture.net_a_payer_cents!)}</strong>.
      </p>
      {bloque ? (
        <Carte titre="À corriger avant d’émettre">
          <ul className="flex flex-col gap-2">
            {bloquants.map((m) => (
              <li key={m.cle} className="flex flex-wrap items-center justify-between gap-2 font-semibold text-danger">
                {m.message}
                <Link href={LIENS[m.ou]!.href(id.data, c.facture.chantier_id, c.facture.client_id)} className="inline-flex min-h-12 items-center text-encre underline underline-offset-4">
                  {LIENS[m.ou]!.libelle}
                </Link>
              </li>
            ))}
            {sansLigne ? <li className="font-semibold text-danger">Ajoutez au moins une ligne chiffrée.</li> : null}
            {aZero && !sansLigne ? <li className="font-semibold text-danger">Le montant est nul : rien à facturer.</li> : null}
          </ul>
        </Carte>
      ) : <Message type="succes">Toutes les mentions obligatoires sont renseignées.</Message>}
      {signales.length ? (
        <Carte titre="Points signalés (non bloquants)">
          <ul className="list-disc pl-5 text-sm">{signales.map((m) => <li key={m.cle}>{m.message}</li>)}</ul>
        </Carte>
      ) : null}
      <a href={`/factures/${id.data}/pdf`} target="_blank" rel="noopener"
        className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-anthracite bg-white px-4 font-semibold">Relire l’aperçu du PDF</a>
      <FormulaireEmissionFacture factureId={id.data} textes={prep.textesAVerifier} bloque={bloque} avoir={avoir} />
    </div>
  );
}
