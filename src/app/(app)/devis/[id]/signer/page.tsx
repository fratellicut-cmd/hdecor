import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { chargerDevis } from '@/lib/devis';
import { signerSurPlace } from '../../actions';
import { FormulaireSignature } from '@/components/devis/Signature';
import { totalLigne } from '@/domain/devis';
import { formaterEuros } from '@/domain/formats';

export const metadata: Metadata = { title: 'Signature sur place' };

export default async function PageSigner({ params }: PageProps<'/devis/[id]/signer'>) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const c = await chargerDevis(id.data);
  if (!c) notFound();
  const d = c.devis;
  if (d.statut !== 'envoye' || d.statut_affiche === 'expire') redirect(`/devis/${id.data}`);
  const options = c.lignes.filter((l) => l.type === 'ligne' && l.optionnelle).map((l) => ({
    id: l.id, designation: l.designation,
    montant: `${formaterEuros(totalLigne(BigInt(l.quantite_e4!), BigInt(l.prix_unitaire_ht_cents!), l.remise_bp))} HT`,
  }));
  const client = d.copie_client as { nom_affiche?: string; type?: string } | null;
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/devis/${id.data}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← Retour</Link>
      <h1 className="text-2xl font-bold">Signature du devis {d.numero}{d.version! > 1 ? ` (version ${d.version})` : ''}</h1>
      <p>Montant : <strong>{formaterEuros(d.total_ttc_cents!)}{d.regime_tva === 'franchise' ? '' : ' TTC'}</strong> (hors options). Tendez le téléphone au client.</p>
      <FormulaireSignature action={signerSurPlace} champs={{ id: id.data }} documentSha256={d.pdf_sha256!} options={options}
        nomParDefaut={client?.type === 'particulier' ? client.nom_affiche ?? '' : ''} lienPdf={`/devis/${id.data}/pdf`} />
    </div>
  );
}
