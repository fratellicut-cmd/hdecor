import type { Metadata } from 'next';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { formaterDate } from '@/domain/formats';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';
import { SuppressionAssurance } from '@/components/parametres/SuppressionAssurance';
import { FormulaireAssurance } from '@/components/parametres/FormulaireAssurance';
import { EnTeteSection } from '@/components/parametres/EnTeteSection';

export const metadata: Metadata = { title: 'Assurances' };
const LIBELLE = { decennale: 'Décennale', rc_pro: 'RC Pro' } as Record<string, string>;

export default async function PageAssurances() {
  await verifierSession();
  const supabase = await clientServeur();
  const { data: assurances, error } = await supabase.from('assurances').select('*').order('debut', { ascending: false });
  return (
    <div className="flex flex-col gap-4">
      <EnTeteSection titre="Assurances" />
      {error ? <Message type="erreur">Les assurances n’ont pas pu être chargées. Vérifiez la connexion et rechargez la page.</Message> : null}
      {!error && (assurances ?? []).length === 0 ? <p>Aucune assurance enregistrée.</p> : null}
      {(assurances ?? []).map((a) => (
        <Carte key={a.id} titre={`${LIBELLE[a.type]} : ${a.assureur}`}>
          <p>Contrat n° {a.numero_contrat}</p>
          <p>Du {formaterDate(a.debut)}{a.fin ? ` au ${formaterDate(a.fin)}` : ''}</p>
          <p>Zone couverte : {a.zone_couverte}</p>
          <SuppressionAssurance id={a.id} />
        </Carte>
      ))}
      <Carte titre="Ajouter une assurance"><FormulaireAssurance /></Carte>
    </div>
  );
}
