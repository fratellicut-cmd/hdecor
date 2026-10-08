import type { Metadata } from 'next';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { majTauxTva } from '../actions';
import { formaterTaux } from '@/domain/formats';
import { Carte } from '@/components/ui/Carte';
import { Bouton } from '@/components/ui/Bouton';
import { BadgeAVerifier } from '@/components/ui/Champ';
import { EnTeteSection } from '@/components/parametres/EnTeteSection';

export const metadata: Metadata = { title: 'Taux de TVA' };

export default async function PageTauxTva() {
  await verifierSession();
  const supabase = await clientServeur();
  const { data: taux } = await supabase.from('taux_tva').select('*').order('taux_bp');
  return (
    <div className="flex flex-col gap-4">
      <EnTeteSection titre="Taux de TVA" />
      <p className="text-encre-douce">Taux proposés dans les devis lorsque l’entreprise est assujettie. En franchise, aucune TVA n’est facturée. Chaque taux reste « À VÉRIFIER » tant que le comptable ne l’a pas confirmé.</p>
      {(taux ?? []).map((t) => (
        <Carte key={t.taux_bp} titre={formaterTaux(t.taux_bp)}>
          <p className="flex flex-wrap items-center gap-2">{t.libelle} {t.a_verifier ? <BadgeAVerifier /> : null}</p>
          {t.attestation_requise ? <p className="text-sm text-encre-douce">Attestation du client requise pour ce taux (formulaire À VÉRIFIER).</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {t.a_verifier ? (
              <form action={majTauxTva}>
                <input type="hidden" name="taux_bp" value={t.taux_bp} /><input type="hidden" name="champ" value="confirmer" />
                <Bouton type="submit" variante="secondaire">Confirmé par le comptable</Bouton>
              </form>
            ) : null}
            <form action={majTauxTva}>
              <input type="hidden" name="taux_bp" value={t.taux_bp} /><input type="hidden" name="champ" value="actif" />
              <input type="hidden" name="valeur" value={t.actif ? '0' : '1'} />
              <Bouton type="submit" variante="discret">{t.actif ? 'Ne plus proposer' : 'Proposer à nouveau'}</Bouton>
            </form>
          </div>
        </Carte>
      ))}
    </div>
  );
}
