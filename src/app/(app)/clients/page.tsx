import type { Metadata } from 'next';
import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { schemaFiltresClients } from '@/lib/validation/clients';
import { formaterTelephone, nomAffiche } from '@/domain/clients';
import { RechercheClients } from '@/components/clients/RechercheClients';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Clients' };

const PAR_PAGE = 50;

export default async function PageClients({ searchParams }: PageProps<'/clients'>) {
  await verifierSession();
  const f = schemaFiltresClients.parse(await searchParams);
  const supabase = await clientServeur();
  // Une ligne de plus que la page : indique s'il existe une page suivante.
  const { data, error } = await supabase.rpc('rechercher_clients', {
    p_texte: f.q, p_type: f.type, p_inclure_anonymises: f.anonymises,
    p_limite: PAR_PAGE + 1, p_decalage: (f.page - 1) * PAR_PAGE,
  });
  const clients = (data ?? []).slice(0, PAR_PAGE);
  const suivante = (data ?? []).length > PAR_PAGE;
  const lienPage = (n: number) => {
    const p = new URLSearchParams();
    if (f.q) p.set('q', f.q);
    if (f.type) p.set('type', f.type);
    if (f.anonymises) p.set('anonymises', '1');
    if (n > 1) p.set('page', String(n));
    const s = p.toString();
    return s ? `/clients?${s}` : '/clients';
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Clients</h1>
        <Link href="/clients/nouveau" className="inline-flex min-h-12 items-center rounded-xl bg-anthracite px-5 font-semibold text-creme">
          + Nouveau
        </Link>
      </div>
      <RechercheClients filtres={{ q: f.q, type: f.type, anonymises: f.anonymises }} />

      {error ? <Message type="erreur">La liste n’a pas pu être chargée. Vérifiez la connexion et réessayez.</Message> : null}
      {!error && clients.length === 0 ? (
        <p className="rounded-xl border border-trait bg-white p-4 text-encre-douce">
          {f.q || f.type ? 'Aucun client ne correspond à la recherche.' : 'Aucun client pour l’instant. Touchez « + Nouveau » pour en créer un.'}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {clients.map((c) => (
          <li key={c.id}>
            <Link href={`/clients/${c.id}`} className="flex min-h-16 flex-col justify-center rounded-xl border border-trait bg-white px-4 py-2">
              <span className="font-semibold">{nomAffiche(c)}</span>
              <span className="text-sm text-encre-douce">
                {[c.type === 'professionnel' ? 'Professionnel' : null, c.fact_ville, c.telephone ? formaterTelephone(c.telephone) : null].filter(Boolean).join(' · ') || ' '}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {f.page > 1 || suivante ? (
        <nav aria-label="Pages" className="flex justify-between gap-3">
          {f.page > 1 ? <Link href={lienPage(f.page - 1)} className="inline-flex min-h-12 items-center underline underline-offset-4">← Précédents</Link> : <span />}
          {suivante ? <Link href={lienPage(f.page + 1)} className="inline-flex min-h-12 items-center underline underline-offset-4">Suivants →</Link> : null}
        </nav>
      ) : null}

      <a href="/clients/export" download className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-anthracite bg-white px-5 font-semibold">
        Exporter tous les clients (tableur)
      </a>
    </div>
  );
}
