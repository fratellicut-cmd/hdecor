import type { ResultatPoste } from '@/domain/calculateur';
import { formaterDuree } from '@/domain/chiffrage';
import { formaterEuros, pourcentageVersSaisie } from '@/domain/formats';
import { formaterSurface } from '@/domain/metre';
import { formaterContenance, formaterQuantite, formaterQuantiteCourte, quantiteDepuisFraction } from '@/domain/peinture';
import type { Combinaison } from '@/domain/pots';
import { BadgeAVerifier } from '@/components/ui/Champ';

const SOURCES = { force: 'saisi sur le poste', produit: 'fiche produit', referentiel: 'bas de la fourchette indicative (prudent)' } as const;

export function texteCombinaison(c: Combinaison, unite: 'L' | 'kg') {
  return c.pots.map((p) => `${p.nombre} × ${formaterContenance(p.contenanceMl, unite)}`).join(' + ') || 'aucun pot';
}

/** Résultat d'un poste : chaque valeur avec sa provenance ; rien n'est caché. */
export function ResultatPosteVue({ r, communs }: { r: ResultatPoste; communs?: Set<string> }) {
  const u = r.unite;
  // Messages et rappels communs à plusieurs postes : affichés une seule fois en haut de la page.
  const propre = (m: string) => !communs?.has(m);
  const manques = r.manques.filter(propre);
  const avertissements = r.avertissements.filter(propre);
  const sechage = r.sechage && propre(r.sechage) ? r.sechage : null;
  const tempsInconnu = r.temps !== null && r.incomplet.temps && r.temps.minutes === 0n;
  return (
    <div className="flex flex-col gap-2">
      {manques.map((m) => <p key={m} className="rounded-lg bg-danger-fond px-3 py-2 text-sm font-semibold text-danger">{m}</p>)}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 tabular-nums">
        <div><dt className="text-sm text-encre-douce">Surface</dt><dd className="font-semibold">{r.surfaceMm2 === null ? '—' : formaterSurface(r.surfaceMm2)}</dd></div>
        <div>
          <dt className="text-sm text-encre-douce">Quantité</dt>
          <dd className="font-semibold">{r.quantite ? `${formaterQuantiteCourte(r.quantite)} ${u}` : '—'}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-sm text-encre-douce">Pots</dt>
          <dd className="font-semibold">
            {r.pots ? (
              <>
                {texteCombinaison(r.pots.retenue, u)}
                <span className="block text-sm font-normal text-encre-douce">
                  Reste : {formaterContenance(Number(r.pots.retenue.resteMl), u)} · {r.pots.choixAuCout ? 'choix au moindre coût' : 'prix inconnus : le moins de pots (indicatif)'}
                </span>
              </>
            ) : '—'}
          </dd>
        </div>
        <div><dt className="text-sm text-encre-douce">Coût matière HT{r.matierePreparation.length ? ' (hors préparation)' : ''}</dt><dd className="font-semibold">{r.coutMatiereCents === null ? 'prix à renseigner' : formaterEuros(r.coutMatiereCents)}</dd></div>
        <div><dt className="text-sm text-encre-douce">Temps{r.incomplet.temps && !tempsInconnu ? ' (partiel)' : ''}</dt><dd className="font-semibold">
          {r.temps === null ? '—' : tempsInconnu ? 'non renseigné' : formaterDuree(r.temps.minutes)}
          {r.coutMainOeuvreCents !== null && !tempsInconnu ? ` · ${formaterEuros(r.coutMainOeuvreCents)}` : ''}
        </dd></div>
      </dl>
      {r.matierePreparation.length ? (
        <p className="text-sm">
          Préparation (comptée dans la liste d’achat) :{' '}
          {r.matierePreparation.map((m) => `${m.libelle} ${formaterQuantiteCourte(quantiteDepuisFraction(m.quantite))} ${m.unite}`).join(' ; ')}
        </p>
      ) : null}
      {avertissements.map((a) => <p key={a} className="rounded-lg bg-alerte-fond px-3 py-2 text-sm font-semibold text-alerte">⚠ {a}</p>)}
      {sechage ? <p className="text-sm">{sechage}</p> : null}
      {r.aVerifier.length ? (
        <p className="flex flex-wrap items-center gap-2 text-sm"><BadgeAVerifier /> {r.aVerifier.join(', ')}</p>
      ) : null}
      <details className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">Détail du calcul</summary>
        <ul className="mt-1 flex flex-col gap-1 text-encre-douce">
          {r.rendementCentiemes !== null && r.sourceRendement ? (
            <li>Rendement : {formaterQuantite(BigInt(r.rendementCentiemes) * 100n, 2)} m²/{u} par {u === 'kg' ? 'passe' : 'couche'} ({SOURCES[r.sourceRendement]}).</li>
          ) : null}
          <li>Rendement retenu pour ce support : {pourcentageVersSaisie(r.coefSupportBp)} % du rendement indiqué.</li>
          {r.quantite ? <li>Quantité exacte : {formaterQuantite(r.quantite.dixMilliemes, 4)} {u} ; à couvrir : {formaterContenance(Number(r.quantite.aCouvrirMl), u)} (arrondi au ml supérieur).</li> : null}
          {r.pots?.alternatives.length ? (
            <li>
              Autres possibilités :{' '}
              {r.pots.alternatives.map((a) => `${texteCombinaison(a, u)} (${a.coutCents === null ? 'prix inconnu' : formaterEuros(a.coutCents)}, reste ${formaterContenance(Number(a.resteMl), u)})`).join(' ; ')}.
            </li>
          ) : null}
        </ul>
      </details>
    </div>
  );
}
