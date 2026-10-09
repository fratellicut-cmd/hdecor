'use client';

import { enregistrerFiscal } from '@/app/(app)/parametres/actions';
import { useFormulaire } from '@/components/formulaire/useFormulaire';
import { MessagesGarde, RappelEnvoi } from '@/components/formulaire/MessagesGarde';
import type { Ligne } from '@/lib/supabase/types';
import { montantVersSaisie, pourcentageVersSaisie, formaterDate } from '@/domain/formats';
import { Bouton } from '@/components/ui/Bouton';
import { Champ } from '@/components/ui/Champ';
import { CaseACocher, TexteLong } from '@/components/ui/Autres';
import { RetourFormulaire } from './RetourFormulaire';

type P = Pick<Ligne<'parametres_entreprise'>, 'regime_tva' | 'mention_franchise' | 'mention_franchise_a_verifier' | 'numero_tva_intra'
  | 'seuil_ca_micro_cents' | 'seuil_franchise_tva_cents' | 'seuils_confirmes_le' | 'seuil_alerte_1_bp' | 'seuil_alerte_2_bp'>;

export function FormulaireFiscal({ p }: { p: P }) {
  const { etat, action, enCours, formRef, garde, surEnvoi } = useFormulaire('parametres:fiscal', enregistrerFiscal);
  const e = etat.erreurs ?? {};
  const sv = etat.valeurs;
  const val = (cle: string, defaut: string) => sv?.[cle] ?? defaut;
  const coche = (cle: string, defaut: boolean) => (sv ? sv[cle] === 'on' : defaut);
  return (
    <form ref={formRef} action={action} onSubmit={surEnvoi} className="flex flex-col gap-4" noValidate>
      <RetourFormulaire etat={etat} />
      <MessagesGarde garde={garde} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Régime de TVA</legend>
        {(['franchise', 'assujetti'] as const).map((r) => (
          <label key={r} className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-trait bg-white px-3">
            <input type="radio" name="regime_tva" value={r} defaultChecked={val('regime_tva', p.regime_tva) === r} className="h-6 w-6 accent-anthracite" />
            {r === 'franchise' ? 'Franchise en base de TVA (micro-entreprise) : aucune TVA facturée' : 'Assujetti à la TVA'}
          </label>
        ))}
        {e.regime_tva ? <p className="text-sm font-semibold text-danger">{e.regime_tva}</p> : null}
      </fieldset>
      <TexteLong libelle="Mention de franchise (sur devis et factures)" nom="mention_franchise" defaultValue={val('mention_franchise', p.mention_franchise)}
        aVerifier={p.mention_franchise_a_verifier} erreur={e.mention_franchise} />
      <p className="text-sm">{p.mention_franchise_a_verifier ? 'État : mention À VÉRIFIER.' : 'État : mention confirmée. Si vous la modifiez, elle repasse À VÉRIFIER.'}</p>
      <CaseACocher nom="mention_franchise_confirmee" libelle="Je confirme cette mention (validée par le comptable)" defaultChecked={coche('mention_franchise_confirmee', false)} />
      <Champ libelle="N° de TVA intracommunautaire (si assujetti)" nom="numero_tva_intra" defaultValue={val('numero_tva_intra', p.numero_tva_intra ?? '')} erreur={e.numero_tva_intra} autoCapitalize="characters" />
      <h3 className="mt-2 text-lg font-bold">Seuils de la micro-entreprise</h3>
      <p className="text-sm text-encre-douce">Aucune valeur n’est préremplie : saisissez les seuils en vigueur confirmés par le comptable. La jauge du tableau de bord reste masquée tant qu’ils ne sont pas confirmés.</p>
      <Champ libelle="Plafond de chiffre d’affaires (€)" nom="seuil_ca_micro_cents" inputMode="decimal" defaultValue={val('seuil_ca_micro_cents', montantVersSaisie(p.seuil_ca_micro_cents))} erreur={e.seuil_ca_micro_cents} aVerifier={!p.seuils_confirmes_le} />
      <Champ libelle="Seuil de franchise de TVA (€)" nom="seuil_franchise_tva_cents" inputMode="decimal" defaultValue={val('seuil_franchise_tva_cents', montantVersSaisie(p.seuil_franchise_tva_cents))} erreur={e.seuil_franchise_tva_cents} aVerifier={!p.seuils_confirmes_le} />
      <p className="text-sm">{p.seuils_confirmes_le
        ? `État : seuils confirmés le ${formaterDate(p.seuils_confirmes_le)}. S’ils changent, ils repassent À VÉRIFIER.`
        : 'État : seuils À VÉRIFIER.'}</p>
      <CaseACocher nom="seuils_confirmes" libelle="Je confirme ces seuils (validés par le comptable)"
        defaultChecked={coche('seuils_confirmes', false)} erreur={e.seuils_confirmes} />
      <div className="grid grid-cols-2 gap-3">
        <Champ libelle="1re alerte (%)" nom="seuil_alerte_1_bp" inputMode="decimal" defaultValue={val('seuil_alerte_1_bp', pourcentageVersSaisie(p.seuil_alerte_1_bp))} erreur={e.seuil_alerte_1_bp} />
        <Champ libelle="2e alerte (%)" nom="seuil_alerte_2_bp" inputMode="decimal" defaultValue={val('seuil_alerte_2_bp', pourcentageVersSaisie(p.seuil_alerte_2_bp))} erreur={e.seuil_alerte_2_bp} />
      </div>
      <RappelEnvoi garde={garde} etat={etat} />
      <Bouton type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</Bouton>
    </form>
  );
}
