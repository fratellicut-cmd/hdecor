import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { rentabiliteChantier } from '@/lib/pilotage';
import { toutLire } from '@/lib/lecture';
import { aujourdHuiParis } from '@/domain/dates';
import { formaterDuree } from '@/domain/chiffrage';
import { formaterDate, formaterDateHeure, formaterEuros, formaterTaux } from '@/domain/formats';
import { supprimerTemps } from '@/app/(app)/planning/actions';
import { FormulairePlanification, FormulaireRappel, FormulaireSechage, FormulaireTemps } from '@/components/planning/Formulaires';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { Carte } from '@/components/ui/Carte';
import { Repliable } from '@/components/ui/Repliable';

const duree = (minutes: number) => formaterDuree(BigInt(Math.abs(minutes)));
const ecartDuree = (minutes: number) => (minutes === 0 ? 'conforme' : `${minutes > 0 ? '+' : '−'}${duree(minutes)}`);
const ecartEuros = (cents: bigint) => (cents === 0n ? 'conforme' : `${cents > 0n ? '+' : '−'}${formaterEuros(cents < 0n ? -cents : cents)}`);

/** Cartes de pilotage d'un chantier : planification, temps passé, rappels, rentabilité. */
export async function CartesPilotage({ chantier }: { chantier: { id: string; date_debut_prevue: string | null; duree_estimee_jours: number | null } }) {
  const session = await verifierSession();
  const sb = await clientServeur();
  const aujourdhui = aujourdHuiParis();
  const [temps, rappels, planifie, r] = await Promise.all([
    toutLire((de, a) => sb.from('temps_passes').select('id, jour, minutes, tache').eq('chantier_id', chantier.id)
      .order('jour', { ascending: false }).order('created_at', { ascending: false }).order('id').range(de, a), 'temps passés'),
    sb.from('rappels').select('id, titre, echeance').eq('chantier_id', chantier.id).eq('statut', 'a_envoyer').order('echeance').limit(50),
    sb.from('evenements').select('debut, fin').eq('chantier_id', chantier.id).eq('type', 'chantier').order('debut').limit(100),
    rentabiliteChantier(chantier.id, session.organisationId),
  ]);
  if (rappels.error || planifie.error) throw new Error('Lecture impossible : pilotage du chantier.');
  const lesTemps = temps;
  // Plages de jours ouvrés du chantier : du début de la première à la fin de la dernière.
  const plages = planifie.data;
  const prevu = plages.length ? { debut: plages[0]!.debut, fin: plages.reduce((a, p) => (p.fin > a ? p.fin : a), plages[0]!.fin) } : null;
  const formulairePlanning = (
    <FormulairePlanification chantierId={chantier.id} debut={chantier.date_debut_prevue ?? aujourdhui}
      duree={chantier.duree_estimee_jours === null ? '' : String(chantier.duree_estimee_jours).replace('.', ',')} />
  );
  const total = lesTemps.reduce((a, t) => a + t.minutes, 0);
  const libelleCout = r.regime === 'franchise' ? 'Achats (TTC, TVA non récupérée)' : 'Achats HT';

  return (
    <>
      <Carte titre="Planning">
        {prevu ? (
          <p>
            Prévu du <strong>{formaterDate(new Date(prevu.debut))}</strong> au <strong>{formaterDate(new Date(prevu.fin))}</strong> (week-ends exclus).{' '}
            <Link href={`/planning?vue=semaine&date=${aujourdHuiParis(new Date(prevu.debut))}`} className="inline-flex min-h-11 items-center underline underline-offset-4">Voir le planning</Link>
          </p>
        ) : <p className="text-encre-douce">Pas encore planifié.</p>}
        {/* Toujours au même endroit : le message de l'enregistrement reste affiché une fois le chantier planifié. */}
        <Repliable titre={prevu ? 'Replanifier…' : 'Planifier'} ouvert={!prevu}>{formulairePlanning}</Repliable>
      </Carte>

      <div id="temps" className="scroll-mt-4"><Carte titre="Temps passé">
        <FormulaireTemps chantierId={chantier.id} aujourdhui={aujourdhui} />
        {lesTemps.length ? (
          <>
            <ul className="mt-3 flex flex-col divide-y divide-trait border-t border-trait">
              {lesTemps.map((t) => (
                <li key={t.id} className="flex flex-col gap-1 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span>{formaterDate(t.jour)}{t.tache ? ` · ${t.tache}` : ''}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{duree(t.minutes)}</span>
                  </div>
                  <ActionConfirmee action={supprimerTemps} champs={{ id: t.id }} libelle="Retirer" variante="discret" />
                </li>
              ))}
            </ul>
            <p className="mt-2 border-t border-trait pt-2 font-semibold tabular-nums">Total : {duree(total)}</p>
          </>
        ) : <p className="mt-3 text-encre-douce">Aucun temps noté.</p>}
      </Carte></div>

      <Carte titre="Rappels du chantier">
        {rappels.data.length ? (
          <ul className="mb-3 flex flex-col divide-y divide-trait">
            {rappels.data.map((x) => <li key={x.id} className="py-2">{x.titre}<span className="block text-sm text-encre-douce">{formaterDateHeure(x.echeance)}</span></li>)}
          </ul>
        ) : null}
        <FormulaireSechage chantierId={chantier.id} heures="" />
        <details className="mt-3">
          <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">Autre rappel…</summary>
          <div className="mt-2"><FormulaireRappel aujourdhui={aujourdhui} chantierId={chantier.id} /></div>
        </details>
      </Carte>

      <Carte titre="Rentabilité">
        <dl className="flex flex-col gap-2 tabular-nums">
          <Ligne libelle="Facturé HT (avoirs déduits)" valeur={formaterEuros(r.factureHtCents)} />
          <Ligne libelle={libelleCout} valeur={formaterEuros(r.achatsCents)} />
          <Ligne libelle="Marge brute" valeur={`${formaterEuros(r.margeBruteCents)}${r.tauxMargeBp === null ? '' : ` (${formaterTaux(r.tauxMargeBp)})`}`} fort />
          {r.devisSignes ? (
            <>
              <Ligne libelle="Achats du chantier / matière prévue" valeur={`${formaterEuros(r.achatsCents)} / ${formaterEuros(r.matierePrevueCents)} (${ecartEuros(r.ecartMatiereCents)})`} />
              <Ligne libelle="Temps : réel / prévu" valeur={`${duree(r.minutesReelles)} / ${duree(r.minutesPrevues)} (${ecartDuree(r.ecartMinutes)})`} />
            </>
          ) : <Ligne libelle="Temps passé" valeur={duree(r.minutesReelles)} />}
          {r.valeurTempsCents !== null ? (
            <>
              <Ligne libelle="Temps passé au taux horaire" valeur={formaterEuros(r.valeurTempsCents)} />
              <Ligne libelle="Reste après le temps" valeur={formaterEuros(r.resultatApresTempsCents!)} fort />
            </>
          ) : null}
        </dl>
        <p className="mt-3 text-sm text-encre-douce">
          {r.devisSignes ? 'Prévu : lignes du ou des devis signés (options retenues comprises). ' : 'Aucun devis signé : pas de prévu à comparer. '}
          Achats : tous ceux rattachés à ce chantier dans la comptabilité (déplacements compris), comparés à la seule matière prévue.
          {r.valeurTempsCents === null ? ' Renseignez le taux horaire dans Paramètres pour valoriser le temps.' : ' La valeur du temps est indicative (ce n’est pas une dépense).'}
        </p>
        <Link href={`/comptabilite/achats/nouveau?chantier=${chantier.id}`} className="mt-2 inline-flex min-h-12 items-center font-semibold underline underline-offset-4">+ Noter un achat pour ce chantier</Link>
      </Carte>
    </>
  );
}

function Ligne({ libelle, valeur, fort }: { libelle: string; valeur: string; fort?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <dt className="text-encre-douce">{libelle}</dt>
      <dd className={fort ? 'font-bold' : ''}>{valeur}</dd>
    </div>
  );
}
