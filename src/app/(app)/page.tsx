import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { chargerTableauDeBord } from '@/lib/pilotage';
import { evolutionBp, LIBELLES_TRANCHES, type Jauge, type Tranche } from '@/domain/pilotage';
import { formaterDate, formaterEuros, formaterTaux } from '@/domain/formats';
import { libelleStatut } from '@/domain/statuts';
import { marquerRappelFait } from './planning/actions';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { BadgeAVerifier } from '@/components/ui/Champ';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

const tuile = 'flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-anthracite bg-white px-2 text-center font-semibold';

function Evolution({ courant, precedent }: { courant: bigint; precedent: bigint }) {
  const e = evolutionBp(courant, precedent);
  if (e === null) return <span className="text-sm text-encre-douce">pas de comparaison (rien l’an dernier)</span>;
  const signe = e > 0 ? '+' : e < 0 ? '−' : '';
  return <span className={`text-sm font-semibold ${e < 0 ? 'text-danger' : 'text-succes'}`}>{signe}{formaterTaux(Math.abs(e))} vs l’an dernier ({formaterEuros(precedent)})</span>;
}

const COULEURS: Record<Jauge['niveau'], string> = {
  non_renseigne: 'fill-trait', ok: 'fill-succes', alerte: 'fill-or-fonce', critique: 'fill-danger', depasse: 'fill-danger',
};

function JaugeSeuil({ titre, j, seuilCents }: { titre: string; j: Jauge; seuilCents: number | null }) {
  if (j.niveau === 'non_renseigne') {
    return (
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{titre}</p>
        <p className="text-sm">Seuil non renseigné : <Link href="/parametres/fiscal" className="inline-flex min-h-11 items-center underline underline-offset-4">le saisir dans Statut fiscal</Link></p>
      </div>
    );
  }
  const largeur = Math.min(100, (j.pourcentBp ?? 0) / 100);
  const texte = { ok: 'Marge confortable', alerte: 'Attention : seuil bientôt atteint', critique: 'Seuil presque atteint : voir le comptable', depasse: 'Seuil DÉPASSÉ : voir le comptable', non_renseigne: '' }[j.niveau];
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap justify-between gap-2 font-semibold"><span>{titre}</span><span className="tabular-nums">{formaterTaux(j.pourcentBp ?? 0)}</span></p>
      {/* SVG plutôt qu'un style en ligne : la politique de sécurité (CSP) refuse les attributs style. */}
      <svg className="h-4 w-full overflow-hidden rounded-full ring-1 ring-trait" role="meter" aria-label={titre}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(largeur)} viewBox="0 0 100 4" preserveAspectRatio="none">
        <rect width="100" height="4" className="fill-creme" />
        <rect width={largeur} height="4" className={COULEURS[j.niveau]} />
      </svg>
      <p className={`text-sm ${j.niveau === 'ok' ? 'text-encre-douce' : 'font-semibold text-danger'}`}>
        {texte} · seuil {formaterEuros(seuilCents ?? 0)}{j.resteCents !== null && j.resteCents > 0n ? `, reste ${formaterEuros(j.resteCents)}` : ''}
      </p>
    </div>
  );
}

export default async function Accueil() {
  const session = await verifierSession();
  const supabase = await clientServeur();
  const [{ data: param }, { count: nbAssurances }, t] = await Promise.all([
    supabase.from('parametres_entreprise').select('raison_sociale, siret, iban, taux_penalites_bp, mediateur_nom, valeurs_a_verifier, seuil_ca_micro_cents, seuil_franchise_tva_cents')
      .eq('organisation_id', session.organisationId).maybeSingle(),
    supabase.from('assurances').select('id', { count: 'exact', head: true }),
    chargerTableauDeBord(session.organisationId),
  ]);
  const manques = [
    !param?.raison_sociale && 'raison sociale', !param?.siret && 'SIRET', !param?.iban && 'IBAN',
    !param?.taux_penalites_bp && 'taux des pénalités de retard', !param?.mediateur_nom && 'médiateur de la consommation',
    !nbAssurances && 'assurances décennale et RC Pro',
  ].filter(Boolean) as string[];
  const ht = t.regime === 'assujetti';
  const montant = (c: { ttcCents: bigint; htCents: bigint }) => (ht ? c.htCents : c.ttcCents);
  const tranches = (Object.keys(LIBELLES_TRANCHES) as Tranche[]).filter((k) => t.tresorerie.aEncaisser[k] > 0n);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Bonjour</h1>
      {manques.length > 0 ? (
        <Message type="alerte">
          <p>Avant la première facture, complétez dans les Paramètres : {manques.join(', ')}.</p>
          <Link href="/parametres" className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-anthracite px-4 text-creme">Compléter les paramètres</Link>
        </Message>
      ) : null}

      <nav aria-label="Raccourcis" className="grid grid-cols-3 gap-2">
        <Link href="/planning" className={tuile}><span aria-hidden className="text-xl">▤</span>Planning</Link>
        <Link href="/comptabilite" className={tuile}><span aria-hidden className="text-xl">≡</span>Compta</Link>
        <Link href="/comptabilite/achats/nouveau" className={tuile}><span aria-hidden className="text-xl">＋</span>Un achat</Link>
      </nav>

      <Carte titre="À faire">
        {!t.aFaire.length ? <p className="text-encre-douce">Rien d’urgent aujourd’hui.</p> : (
          <ul className="flex flex-col divide-y divide-trait">
            {t.aFaire.slice(0, 10).map((a) => (
              <li key={a.cle} className="flex flex-col gap-1 py-2">
                <Link href={a.lien} className={`flex min-h-12 items-center gap-2 font-semibold ${a.urgence === 'retard' ? 'text-danger' : ''}`}>
                  <span aria-hidden>{a.urgence === 'retard' ? '⚠' : a.urgence === 'aujourdhui' ? '●' : '○'}</span>{a.texte}
                </Link>
                {a.rappelId ? <ActionConfirmee action={marquerRappelFait} champs={{ id: a.rappelId }} libelle="C’est fait" variante="discret" /> : null}
              </li>
            ))}
          </ul>
        )}
        {t.aFaire.length > 10 ? <p className="mt-2 text-sm text-encre-douce">Et {t.aFaire.length - 10} autre(s).</p> : null}
      </Carte>

      <Carte titre={`Chiffre d’affaires encaissé${ht ? ' (HT)' : ''}`}>
        <dl className="flex flex-col gap-3">
          {([['mois', 'Ce mois-ci'], ['trimestre', 'Ce trimestre'], ['annee', 'Cette année']] as const).map(([k, l]) => (
            <div key={k} className="flex flex-col">
              <div className="flex items-baseline justify-between gap-3"><dt>{l}</dt><dd className="text-xl font-bold tabular-nums">{formaterEuros(montant(t.ca[k].courant))}</dd></div>
              <Evolution courant={montant(t.ca[k].courant)} precedent={montant(t.ca[k].precedent)} />
            </div>
          ))}
        </dl>
        <p className="mt-2 text-sm text-encre-douce">Sommes réellement encaissées (remboursements déduits), comparées à la même période l’an dernier.{ht ? ' Part HT calculée au prorata de chaque facture (À VÉRIFIER).' : ''}</p>
      </Carte>

      <Carte titre="Seuils de la micro-entreprise">
        <div className="flex flex-col gap-4">
          {!t.seuils.confirmes ? <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">Valeurs des seuils <BadgeAVerifier /> avec le comptable (Paramètres &gt; Statut fiscal).</p> : null}
          <JaugeSeuil titre="Plafond de chiffre d’affaires" j={t.seuils.ca} seuilCents={param?.seuil_ca_micro_cents ?? null} />
          {t.regime === 'franchise' ? <JaugeSeuil titre="Franchise en base de TVA" j={t.seuils.franchise} seuilCents={param?.seuil_franchise_tva_cents ?? null} /> : null}
          <p className="text-sm text-encre-douce">Encaissé depuis le 1er janvier : {formaterEuros(t.seuils.base.htCents)}{ht ? ' HT' : ''}. Mode de calcul des seuils (année civile, encaissements) : À VÉRIFIER.</p>
        </div>
      </Carte>

      <Carte titre="Trésorerie à venir" action={<Link href="/factures" className="inline-flex min-h-12 items-center px-2 font-semibold underline underline-offset-4">Factures</Link>}>
        <dl className="flex flex-col gap-1">
          {tranches.map((k) => (
            <div key={k} className={`flex justify-between gap-3 ${k === 'en_retard' ? 'font-semibold text-danger' : ''}`}>
              <dt>{LIBELLES_TRANCHES[k]}</dt><dd className="tabular-nums">{formaterEuros(t.tresorerie.aEncaisser[k])}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 border-t border-trait pt-1 text-lg font-bold"><dt>À encaisser</dt><dd className="tabular-nums">{formaterEuros(t.tresorerie.totalAEncaisserCents)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Reste à facturer (devis signés)</dt><dd className="tabular-nums">{formaterEuros(t.tresorerie.aFacturerCents)}</dd></div>
        </dl>
        {t.impayes.enRetard ? <p className="mt-2 text-sm font-semibold text-danger">{t.impayes.enRetard} facture{t.impayes.enRetard > 1 ? 's' : ''} en retard.</p> : null}
      </Carte>

      <Carte titre="Devis" action={<Link href="/devis" className="inline-flex min-h-12 items-center px-2 font-semibold underline underline-offset-4">Voir</Link>}>
        <dl className="flex flex-col gap-1">
          <div className="flex justify-between gap-3"><dt>En attente de signature</dt><dd className="tabular-nums">{t.devis.enAttente.nombre} · {formaterEuros(t.devis.enAttente.montantCents)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Taux de transformation (12 mois)</dt>
            <dd className="tabular-nums">{t.devis.tauxTransformationBp === null ? '—' : `${formaterTaux(t.devis.tauxTransformationBp)} (${t.devis.acceptes} sur ${t.devis.tranches})`}</dd></div>
          <div className="flex justify-between gap-3"><dt>Délai moyen de signature</dt>
            <dd className="tabular-nums">{t.devis.delaiMoyenSignatureDixiemes === null ? '—' : `${(t.devis.delaiMoyenSignatureDixiemes / 10).toString().replace('.', ',')} j`}</dd></div>
        </dl>
      </Carte>

      <Carte titre="Chantiers en cours et à venir" action={<Link href="/chantiers" className="inline-flex min-h-12 items-center px-2 font-semibold underline underline-offset-4">Tous</Link>}>
        {!t.chantiers.length ? <p className="text-encre-douce">Aucun chantier en cours.</p> : (
          <ul className="flex flex-col divide-y divide-trait">
            {t.chantiers.map((c) => (
              <li key={c.id}>
                <Link href={`/chantiers/${c.id}`} className="flex min-h-14 flex-col justify-center py-2">
                  <span className="font-semibold">{c.nom}</span>
                  <span className="text-sm text-encre-douce">
                    {[libelleStatut(c.statut), c.debut ? `début ${formaterDate(c.debut)}` : 'non planifié',
                      c.resteAFacturerCents > 0n ? `reste à facturer ${formaterEuros(c.resteAFacturerCents)}` : null].filter(Boolean).join(' · ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Carte>
    </div>
  );
}
