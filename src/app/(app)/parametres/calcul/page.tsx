import type { Metadata } from 'next';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { libelleType } from '@/domain/calculateur';
import { formaterEuros, pourcentageVersSaisie } from '@/domain/formats';
import { formaterContenance } from '@/domain/peinture';
import { longueurVersSaisie } from '@/domain/saisie';
import { LIBELLES_SUPPORT, type TypeProduit } from '@/domain/systemes';
import { TYPES_PRODUIT } from '@/lib/validation/chantiers';
import { actionConsommable } from './actions';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { EnTeteSection } from '@/components/parametres/EnTeteSection';
import { FormulaireConsommable, FormulaireMetre, LigneCoefficient, LigneEtape, LigneReferentiel } from '@/components/parametres/ReglagesCalcul';
import { FormulaireMatiereEtape } from '@/components/catalogue/Formulaires';
import { Carte } from '@/components/ui/Carte';
import { BadgeAVerifier } from '@/components/ui/Champ';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Réglages de calcul' };

const num = (v: number | null) => (v === null ? '' : String(v).replace('.', ','));
/** 450 min -> « 7,5 » (heures). */
const formaterHeures = (minutes: number) => num(Math.round(minutes / 6) / 10);
const typesProduit = TYPES_PRODUIT.map((t) => ({ valeur: t, libelle: libelleType(t) }));

export default async function PageReglagesCalcul() {
  const session = await verifierSession();
  const supabase = await clientServeur();
  const [ref, coefs, etapes, conso, param, produits] = await Promise.all([
    supabase.from('referentiel_calcul').select('*').order('type_produit'),
    supabase.from('coefficients_support').select('*'),
    supabase.from('etapes_preparation').select('*').eq('actif', true).order('ordre'),
    supabase.from('consommables').select('*').eq('actif', true).order('libelle'),
    supabase.from('parametres_entreprise').select('porte_largeur_mm, porte_hauteur_mm, formats_pots_ml, formats_sacs_g, hauteur_alerte_mm, minutes_par_jour, tolerance_reste_bp').eq('organisation_id', session.organisationId).single(),
    supabase.from('produits').select('id, marque, gamme, designation, unite_mesure, actif').order('marque').order('designation').limit(2000),
  ]);
  if (ref.error || coefs.error || etapes.error || conso.error || param.error || produits.error) throw new Error('Lecture impossible : réglages de calcul.');
  // Produits déjà liés à une étape : toujours présents dans la liste (archivés ou au-delà de la limite).
  const manquants = [...new Set(etapes.data.map((e) => e.produit_id).filter((x): x is string => !!x && !produits.data.some((p) => p.id === x)))];
  if (manquants.length) {
    const { data } = await supabase.from('produits').select('id, marque, gamme, designation, unite_mesure, actif').in('id', manquants);
    produits.data.push(...(data ?? []));
  }
  const produitsAuChoix = (choisi: string | null) => produits.data.filter((p) => p.actif || p.id === choisi)
    .map((p) => ({ id: p.id, libelle: `${[p.marque, p.gamme, p.designation].filter(Boolean).join(' ')}${p.actif ? '' : ' (archivé)'}`, unite: p.unite_mesure }));
  const coefDe = new Map(coefs.data.map((c) => [c.support, c]));

  return (
    <div className="flex flex-col gap-4">
      <EnTeteSection titre="Réglages de calcul" />
      <Message type="alerte">Valeurs indicatives : se référer à la fiche technique du fabricant et au support réel. Tant qu’une valeur n’est pas confirmée, elle reste « À VÉRIFIER ».</Message>

      <Carte titre="Métré et pots">
        <FormulaireMetre porteLargeur={longueurVersSaisie(param.data.porte_largeur_mm, 'cm')} porteHauteur={longueurVersSaisie(param.data.porte_hauteur_mm, 'cm')}
          formats={param.data.formats_pots_ml.map((f) => formaterContenance(f).replace(/ L$/, '')).join(' ; ')}
          sacs={param.data.formats_sacs_g.map((f) => formaterContenance(f).replace(/ L$/, '')).join(' ; ')}
          hauteurAlerte={longueurVersSaisie(param.data.hauteur_alerte_mm, 'm')}
          heuresParJour={formaterHeures(param.data.minutes_par_jour)} toleranceReste={pourcentageVersSaisie(param.data.tolerance_reste_bp)} />
      </Carte>

      <Carte titre="Rendements par type de produit">
        <p className="mb-2 text-sm text-encre-douce">Sans produit du catalogue, le calcul prend le rendement mini (choix prudent).</p>
        {ref.data.map((r) => (
          <LigneReferentiel key={r.type_produit} type={r.type_produit} libelle={libelleType(r.type_produit as TypeProduit)}
            min={num(r.rendement_min)} max={num(r.rendement_max)} minutes={num(r.minutes_par_m2_couche)} sechage={num(r.sechage_recouvrable_h)}
            formats={(r.formats_ml ?? []).map((f) => formaterContenance(f).replace(/ L$/, '')).join(' ; ')} aVerifier={r.statut_verification !== 'verifie'} />
        ))}
      </Carte>

      <Carte titre="Coefficient de rendement par support">
        {Object.entries(LIBELLES_SUPPORT).map(([s, l]) => {
          const c = coefDe.get(s);
          return <LigneCoefficient key={s} support={s} libelle={l} pourcentage={pourcentageVersSaisie(c?.coef_rendement_bp ?? 10000)} aVerifier={c?.statut_verification !== 'verifie'} />;
        })}
      </Carte>

      <Carte titre="Temps de préparation">
        <p className="mb-2 text-sm text-encre-douce">Aucun temps n’est fourni par défaut : renseignez les vôtres. La matière d’une étape (enduit, impression…) est comptée avec le rendement de son type de produit.</p>
        {etapes.data.map((e) => (
          <div key={e.id} className="flex flex-col gap-2 border-t border-trait first:border-t-0">
            <LigneEtape id={e.id} libelle={e.libelle} minutes={num(e.minutes_par_m2)} typeProduit={e.type_produit ?? ''} couches={String(e.couches)}
              avecMatiere={e.avec_matiere} types={typesProduit} aVerifier={e.statut_verification !== 'verifie'} />
            {e.avec_matiere ? (
              <details className="pb-3">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold underline underline-offset-4">
                  Matière par produit du catalogue{e.produit_id ? ' (renseignée)' : ''}
                </summary>
                <p className="mt-1 text-sm text-encre-douce">Prioritaire sur le type de produit : consommation de la fiche technique, par m² et par passe.</p>
                <div className="mt-2">
                  <FormulaireMatiereEtape id={e.id} produitId={e.produit_id ?? ''} produits={produitsAuChoix(e.produit_id)}
                    consommation={e.consommation_par_m2 === null ? '' : String(e.consommation_par_m2).replace('.', ',')} />
                </div>
              </details>
            ) : null}
          </div>
        ))}
      </Carte>

      <Carte titre="Consommables (rouleaux, bâches, adhésif, abrasif)">
        {conso.data.length ? (
          <ul className="mb-3 flex flex-col divide-y divide-trait">
            {conso.data.map((k) => (
              <li key={k.id} className="flex flex-col gap-1 py-2">
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {k.libelle} : {formaterEuros(k.prix_ht_cents)} {k.mode === 'par_m2' ? 'par m² peint' : 'par chantier'}
                  {k.statut_verification !== 'verifie' ? <BadgeAVerifier /> : null}
                </span>
                <div className="flex flex-wrap gap-2">
                  {k.statut_verification !== 'verifie' ? <ActionConfirmee action={actionConsommable} champs={{ id: k.id, quoi: 'confirmer' }} libelle="Confirmer le prix" variante="secondaire" /> : null}
                  <ActionConfirmee action={actionConsommable} champs={{ id: k.id, quoi: 'retirer' }} libelle="Retirer" variante="discret" />
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="mb-3 text-encre-douce">Aucun consommable : ils ne sont pas comptés.</p>}
        <details>
          <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">+ Ajouter un consommable</summary>
          <div className="mt-2"><FormulaireConsommable /></div>
        </details>
      </Carte>
    </div>
  );
}
