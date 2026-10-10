import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { chargerPv } from '@/lib/pv';
import { nomAffiche } from '@/domain/clients';
import { formaterDate } from '@/domain/formats';
import { dateLimiteLevee, engagementClient, texteDecision } from '@/domain/pv';
import { FormulaireSignaturePv } from '@/components/chantiers/Pv';
import { NoticeSignature } from '@/components/devis/Signature';

export const metadata: Metadata = { title: 'Signature du PV' };

export default async function PageSignerPv({ params }: PageProps<'/chantiers/[id]/pv/[pv]/signer'>) {
  const session = await verifierSession();
  const p = await params;
  const chantierId = z.uuid().safeParse(p.id);
  const pvId = z.uuid().safeParse(p.pv);
  if (!chantierId.success || !pvId.success) notFound();
  const sb = await clientServeur();
  const c = await chargerPv(sb, pvId.data);
  if (!c || c.chantier.id !== chantierId.data) notFound();
  if (c.pv.statut !== 'brouillon' || !c.pv.pdf_sha256) redirect(`/chantiers/${c.chantier.id}/pv/${c.pv.id}`);
  const limite = c.pv.reserves.length ? dateLimiteLevee(c.pv.date_reception, c.pv.delai_levee_jours) : null;
  const { data: e } = await sb.from('parametres_entreprise').select('raison_sociale').eq('organisation_id', session.organisationId).single();
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/chantiers/${c.chantier.id}/pv/${c.pv.id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← Retour</Link>
      <h1 className="text-2xl font-bold">Réception des travaux du {formaterDate(c.pv.date_reception)}</h1>
      <p className="font-semibold">{texteDecision(c.pv.reserves)}</p>
      {c.pv.travaux ? <p><span className="font-semibold">Travaux réceptionnés : </span>{c.pv.travaux}</p> : null}
      {c.pv.reserves.length ? <ol className="list-decimal pl-6">{c.pv.reserves.map((r, i) => <li key={i}>{r.description}</li>)}</ol> : null}
      {limite ? <p>Réserves à lever au plus tard le <strong>{formaterDate(limite)}</strong>.</p> : null}
      <FormulaireSignaturePv engagement={engagementClient(c.pv.reserves, limite)} id={c.pv.id} documentSha256={c.pv.pdf_sha256} lienPdf={`/chantiers/${c.chantier.id}/pv/${c.pv.id}/pdf`}
        nomParDefaut={c.client && c.client.type === 'particulier' && !c.client.anonymise_le ? nomAffiche(c.client) : ''} entreprise={e?.raison_sociale ?? ''} />
      <NoticeSignature entreprise={e?.raison_sociale ?? ''} document="le procès-verbal signé" />
    </div>
  );
}
