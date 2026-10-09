import type { Metadata } from 'next';
import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { formaterEuros, formaterTaux } from '@/domain/formats';
import { UNITES_PRESTATION } from '@/lib/validation/catalogue';
import { actionPrestation } from '../actions';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { EffacerBrouillon } from '@/components/formulaire/EffacerBrouillon';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Prestations' };

export default async function PagePrestations({ searchParams }: PageProps<'/catalogue/prestations'>) {
  await verifierSession();
  const sp = await searchParams;
  const supabase = await clientServeur();
  const { data, error } = await supabase.from('prestations').select('*').order('actif', { ascending: false }).order('libelle').limit(500);
  return (
    <div className="flex flex-col gap-4">
      {sp.enregistre === '1' ? <EffacerBrouillon cles={['prestation:nouvelle', ...(data ?? []).map((p) => `prestation:${p.id}`)]} /> : null}
      <Link href="/catalogue" className="inline-flex min-h-12 items-center underline underline-offset-4">← Catalogue</Link>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Prestations</h1>
        <Link href="/catalogue/prestations/nouvelle" className="inline-flex min-h-12 items-center rounded-xl bg-anthracite px-5 font-semibold text-creme">+ Nouvelle</Link>
      </div>
      {sp.enregistre === '1' ? <Message type="succes">Prestation enregistrée.</Message> : null}
      {error ? <Message type="erreur">La liste n’a pas pu être chargée. Rechargez la page.</Message> : null}
      {!error && !data?.length ? <p className="rounded-xl border border-trait bg-white p-4 text-encre-douce">Aucune prestation : créez celles que vous reprenez souvent dans vos devis.</p> : null}
      <ul className="flex flex-col gap-2">
        {(data ?? []).map((p) => (
          <li key={p.id} className={`flex flex-col gap-1 rounded-xl border border-trait bg-white p-3 ${p.actif ? '' : 'opacity-70'}`}>
            <span className="font-semibold">{p.libelle}{p.actif ? '' : ' (archivée)'}</span>
            <span className="tabular-nums">{formaterEuros(p.prix_unitaire_ht_cents)} HT / {UNITES_PRESTATION[p.unite as keyof typeof UNITES_PRESTATION] ?? p.unite} · TVA {formaterTaux(p.taux_tva_bp)}</span>
            {p.description ? <span className="text-sm text-encre-douce">{p.description}</span> : null}
            <div className="flex flex-wrap gap-2">
              <Link href={`/catalogue/prestations/${p.id}`} className="inline-flex min-h-12 items-center px-2 font-semibold underline underline-offset-4">Modifier</Link>
              <ActionConfirmee action={actionPrestation} champs={{ id: p.id, quoi: p.actif ? 'archiver' : 'reactiver' }} libelle={p.actif ? 'Retirer' : 'Remettre'} variante="discret" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
