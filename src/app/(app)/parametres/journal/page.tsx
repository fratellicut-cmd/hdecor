import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { formaterDateHeure } from '@/domain/formats';
import { libelleAction, libelleTable, numeroDocument, resumeModification, TABLES_JOURNAL } from '@/domain/journal';
import { EnTeteSection } from '@/components/parametres/EnTeteSection';
import { Bouton } from '@/components/ui/Bouton';
import { Selection } from '@/components/ui/Autres';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Journal des actions' };

const PAR_PAGE = 50;
const filtres = z.object({
  table: z.enum(Object.keys(TABLES_JOURNAL) as [string, ...string[]]).optional().catch(undefined),
  page: z.preprocess((v) => (typeof v === 'string' && /^\d{1,4}$/.test(v) ? Number(v) : 1), z.number().int().min(1).max(1000)),
});

export default async function PageJournal({ searchParams }: PageProps<'/parametres/journal'>) {
  const session = await verifierSession();
  const f = filtres.parse(await searchParams);
  const supabase = await clientServeur();
  let requete = supabase.from('journal_audit').select('id, cree_le, user_id, action, table_nom, ligne_id, avant, apres')
    .order('id', { ascending: false }).range((f.page - 1) * PAR_PAGE, f.page * PAR_PAGE);
  if (f.table) requete = requete.eq('table_nom', f.table);
  const { data, error } = await requete;
  const entrees = (data ?? []).slice(0, PAR_PAGE);
  const suivante = (data ?? []).length > PAR_PAGE;
  const lien = (page: number) => `/parametres/journal?${new URLSearchParams({ ...(f.table ? { table: f.table } : {}), ...(page > 1 ? { page: String(page) } : {}) })}`;

  return (
    <>
      <EnTeteSection titre="Journal des actions" />
      <p className="mb-4 text-encre-douce">
        Trace non modifiable des créations, modifications et suppressions. Les données personnelles des clients n’y figurent pas.
      </p>
      <form action="/parametres/journal" className="mb-4 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <Selection libelle="Afficher" nom="table" defaultValue={f.table ?? ''}>
            <option value="">Tout</option>
            {Object.entries(TABLES_JOURNAL).map(([cle, libelle]) => <option key={cle} value={cle}>{libelle}</option>)}
          </Selection>
        </div>
        <Bouton type="submit" variante="secondaire">Filtrer</Bouton>
      </form>

      {error ? <Message type="erreur">Le journal n’a pas pu être chargé. Réessayez.</Message> : null}
      {!error && !entrees.length ? <p className="rounded-xl border border-trait bg-white p-4 text-encre-douce">Aucune entrée.</p> : null}

      <ol className="flex flex-col gap-2">
        {entrees.map((e) => {
          const numero = numeroDocument(e.avant, e.apres);
          const detail = e.action === 'UPDATE' ? resumeModification(e.avant, e.apres) : null;
          const objet = `${libelleTable(e.table_nom)}${numero ? ` ${numero}` : ''}`;
          return (
            <li key={e.id} className="rounded-xl border border-trait bg-white px-4 py-3">
              <p className="text-sm text-encre-douce">
                {formaterDateHeure(e.cree_le)} · {e.user_id === session.utilisateurId ? 'vous' : e.user_id ? 'autre compte' : 'système'}
              </p>
              <p className="font-semibold">
                {libelleAction(e.action)} :{' '}
                {e.table_nom === 'clients' && e.ligne_id && e.action !== 'DELETE'
                  ? <Link href={`/clients/${e.ligne_id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">{objet}</Link>
                  : objet}
              </p>
              {detail ? <p className="text-sm break-words">{detail}</p> : null}
            </li>
          );
        })}
      </ol>

      {f.page > 1 || suivante ? (
        <nav aria-label="Pages" className="mt-4 flex justify-between gap-3">
          {f.page > 1 ? <Link href={lien(f.page - 1)} className="inline-flex min-h-12 items-center underline underline-offset-4">← Plus récents</Link> : <span />}
          {suivante ? <Link href={lien(f.page + 1)} className="inline-flex min-h-12 items-center underline underline-offset-4">Plus anciens →</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
