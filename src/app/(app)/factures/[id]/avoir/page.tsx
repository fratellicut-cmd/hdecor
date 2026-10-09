import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { formaterEuros } from '@/domain/formats';
import { deductionsDomaine } from '@/lib/factures';
import { FormulaireAvoir } from '@/components/factures/Formulaires';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Établir un avoir' };

export default async function PageAvoir({ params }: PageProps<'/factures/[id]/avoir'>) {
  await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sb = await clientServeur();
  const { data: f } = await sb.from('v_factures').select('id, numero, type, statut, net_a_payer_cents, avoirs_cents, paye_cents, deductions').eq('id', id.data).maybeSingle();
  if (!f) notFound();
  if (f.type === 'avoir' || f.statut !== 'emise') redirect(`/factures/${id.data}`);
  const du = (f.net_a_payer_cents ?? 0) - (f.avoirs_cents ?? 0);
  const deduits = deductionsDomaine(f.deductions).map((d) => d.numero);
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/factures/${f.id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← Facture {f.numero}</Link>
      <h1 className="text-2xl font-bold">Avoir sur la facture {f.numero}</h1>
      <p>Une facture émise ne se modifie pas : l’avoir la corrige (en totalité ou en partie). Il reçoit son propre numéro (AVO-…) à l’émission.</p>
      {deduits.length ? (
        <Message type="alerte">
          Cette facture déduit {deduits.length > 1 ? 'les factures' : 'la facture'} {deduits.join(', ')} : l’avoir ne {deduits.length > 1 ? 'les' : 'la'} reprend pas.
          Pour annuler tout le chantier, établissez aussi un avoir sur {deduits.length > 1 ? 'chacune' : 'elle'} (après celui-ci).
        </Message>
      ) : null}
      {(f.paye_cents ?? 0) > 0 ? <Message type="info">Le client a déjà payé {formaterEuros(f.paye_cents!)} : si l’avoir crée un trop-perçu, enregistrez ensuite le remboursement sur l’avoir.</Message> : null}
      {du <= 0 ? <Message type="info">Cette facture est déjà entièrement couverte par des avoirs.</Message> : <FormulaireAvoir factureId={f.id!} reste={formaterEuros(du)} totalSeulement={f.type === 'acompte' || f.type === 'situation'} />}
    </div>
  );
}
