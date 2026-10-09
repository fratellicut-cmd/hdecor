import type { Metadata } from 'next';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { formaterTaux } from '@/domain/formats';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';
import { ActionsTauxTva } from '@/components/parametres/ActionsTauxTva';
import { BadgeAVerifier } from '@/components/ui/Champ';
import { EnTeteSection } from '@/components/parametres/EnTeteSection';

export const metadata: Metadata = { title: 'Taux de TVA' };

export default async function PageTauxTva() {
  await verifierSession();
  const supabase = await clientServeur();
  const { data: taux, error } = await supabase.from('taux_tva').select('*').order('taux_bp');
  return (
    <div className="flex flex-col gap-4">
      <EnTeteSection titre="Taux de TVA" />
      <p className="text-encre-douce">Taux proposés dans les devis lorsque l’entreprise est assujettie. En franchise, aucune TVA n’est facturée. Chaque taux reste « À VÉRIFIER » tant que le comptable ne l’a pas confirmé.</p>
      {error ? <Message type="erreur">Les taux n’ont pas pu être chargés. Vérifiez la connexion et rechargez la page.</Message> : null}
      {(taux ?? []).map((t) => (
        <Carte key={t.taux_bp} titre={formaterTaux(t.taux_bp)}>
          <p className="flex flex-wrap items-center gap-2">{t.libelle} {t.a_verifier ? <BadgeAVerifier /> : null}</p>
          {t.attestation_requise ? <p className="text-sm text-encre-douce">Attestation du client requise pour ce taux (formulaire À VÉRIFIER).</p> : null}
          <ActionsTauxTva tauxBp={t.taux_bp} aVerifier={t.a_verifier} actif={t.actif} />
        </Carte>
      ))}
    </div>
  );
}
