import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

export default async function Accueil() {
  const session = await verifierSession();
  const supabase = await clientServeur();
  const [{ data: param }, { count: nbClients }] = await Promise.all([
    supabase.from('parametres_entreprise').select('raison_sociale, siret, iban, taux_penalites_bp, mediateur_nom, valeurs_a_verifier').eq('organisation_id', session.organisationId).maybeSingle(),
    supabase.from('clients').select('id', { count: 'exact', head: true }).is('anonymise_le', null),
  ]);
  const { count: nbAssurances } = await supabase.from('assurances').select('id', { count: 'exact', head: true });

  const manques = [
    !param?.raison_sociale && 'raison sociale',
    !param?.siret && 'SIRET',
    !param?.iban && 'IBAN',
    !param?.taux_penalites_bp && 'taux des pénalités de retard',
    !param?.mediateur_nom && 'médiateur de la consommation',
    !nbAssurances && 'assurances décennale et RC Pro',
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Bonjour</h1>
      {manques.length > 0 ? (
        <Message type="alerte">
          Avant la première facture, complétez dans les Paramètres : {manques.join(', ')}.{' '}
          <Link href="/parametres" className="underline underline-offset-4">Compléter</Link>
        </Message>
      ) : null}
      {param?.valeurs_a_verifier?.length ? (
        <Message type="info">{param.valeurs_a_verifier.length} valeur(s) par défaut restent À VÉRIFIER dans les conditions.</Message>
      ) : null}
      <Carte titre="Clients" action={<Link href="/clients/nouveau" className="inline-flex min-h-12 items-center rounded-xl bg-anthracite px-4 font-semibold text-creme">+ Nouveau</Link>}>
        <p><Link href="/clients" className="underline underline-offset-4">{nbClients ?? 0} client(s)</Link></p>
      </Carte>
    </div>
  );
}
