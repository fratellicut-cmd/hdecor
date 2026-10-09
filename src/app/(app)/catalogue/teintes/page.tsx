import type { Metadata } from 'next';
import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { actionTeinte } from '../actions';
import { BadgeStatut } from '@/components/catalogue/BadgeStatut';
import { FormulaireTeinte } from '@/components/catalogue/Formulaires';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { EffacerBrouillon } from '@/components/formulaire/EffacerBrouillon';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Nuancier' };

export default async function PageTeintes({ searchParams }: PageProps<'/catalogue/teintes'>) {
  await verifierSession();
  const sp = await searchParams;
  const supabase = await clientServeur();
  const { data, error } = await supabase.from('teintes').select('*').order('actif', { ascending: false }).order('nom').limit(500);
  return (
    <div className="flex flex-col gap-4">
      {sp.enregistre === '1' ? <EffacerBrouillon cles={(data ?? []).map((t) => `teinte:${t.id}`)} /> : null}
      <Link href="/catalogue" className="inline-flex min-h-12 items-center underline underline-offset-4">← Catalogue</Link>
      <h1 className="text-2xl font-bold">Nuancier</h1>
      {sp.enregistre === '1' ? <Message type="succes">Teinte enregistrée.</Message> : null}
      <Message type="info">Les couleurs à l’écran sont indicatives : seul le nuancier du fabricant fait foi.</Message>
      {error ? <Message type="erreur">Le nuancier n’a pas pu être chargé. Rechargez la page.</Message> : null}
      <ul className="flex flex-col gap-2">
        {(data ?? []).map((t) => (
          <li key={t.id} className={`flex flex-col gap-2 rounded-xl border border-trait bg-white p-3 ${t.actif ? '' : 'opacity-70'}`}>
            <div className="flex items-center gap-3">
              <span aria-hidden className="h-12 w-12 shrink-0 rounded-lg border-2 border-trait" style={{ backgroundColor: t.apercu_hex ?? 'transparent' }} />
              <div className="flex min-w-0 flex-col">
                <span className="flex flex-wrap items-center gap-2 font-semibold">{t.nom} <BadgeStatut statut={t.statut_verification} />{t.actif ? null : <span className="text-sm">(archivée)</span>}</span>
                <span className="text-sm text-encre-douce">{[t.marque, t.code_ral, t.code_ncs, t.code_fabricant].filter(Boolean).join(' · ') || 'Aucun code'}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/catalogue/teintes/${t.id}`} className="inline-flex min-h-12 items-center px-2 font-semibold underline underline-offset-4">Modifier</Link>
              <ActionConfirmee action={actionTeinte} champs={{ id: t.id, quoi: t.actif ? 'archiver' : 'reactiver' }} libelle={t.actif ? 'Retirer' : 'Remettre'} variante="discret" />
            </div>
          </li>
        ))}
      </ul>
      <Carte titre="Ajouter une teinte">
        <FormulaireTeinte teinte={{ nom: '', marque: null, code_ral: null, code_ncs: null, code_fabricant: null, apercu_hex: null, statut_verification: 'a_verifier' }} />
      </Carte>
    </div>
  );
}
