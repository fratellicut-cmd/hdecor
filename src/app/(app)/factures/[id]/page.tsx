import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { chargerFacture, deductionsDomaine, ligneFactureDomaine, ventilationDomaine } from '@/lib/factures';
import { clientServeur } from '@/lib/supabase/serveur';
import { tauxProposes } from '@/lib/taux';
import { emailConfigure } from '@/lib/email';
import { sousTotaux, type Ventilation } from '@/domain/devis';
import { ErreurFacture, LIBELLES_STATUT_FACTURE, LIBELLES_TYPE_FACTURE, netAPayer, totalLigneFacture, totauxFacture, type Deduction } from '@/domain/factures';
import { formaterQuantiteE4, UNITES } from '@/domain/devis-document';
import { aujourdHuiParis } from '@/domain/dates';
import { formaterDate, formaterDateHeure, formaterEuros, formaterTaux, montantVersSaisie, pourcentageVersSaisie } from '@/domain/formats';
import { nomAffiche } from '@/domain/clients';
import { genererFacturX, marquerEnvoyee, supprimerBrouillonFacture, supprimerLigneFacture } from '../actions';
import { FormulaireLigne, type LigneSaisie } from '@/components/devis/Formulaires';
import {
  AnnulerPaiement, DeplacerLigneFacture, EnvoiFacture, FormulaireAvancement, FormulaireEnteteFacture, FormulairePaiement,
} from '@/components/factures/Formulaires';
import { enregistrerLigneFacture } from '../actions';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { EffacerBrouillon } from '@/components/formulaire/EffacerBrouillon';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Facture' };

const bouton = 'inline-flex min-h-12 items-center justify-center rounded-xl px-4 font-semibold';
const MODES: Record<string, string> = { virement: 'virement', cheque: 'chèque', especes: 'espèces', carte: 'carte', stripe: 'carte en ligne' };

type Montants = { ventilation: Ventilation; totalHtCents: bigint; totalTvaCents: bigint; totalTtcCents: bigint; remiseGlobaleCents: bigint };

function Totaux({ t, franchise, autoliquidation, deductions, net, avoir }: {
  t: Montants; franchise: boolean; autoliquidation: boolean; deductions: Deduction[]; net: bigint; avoir: boolean;
}) {
  const ligne = (l: string, v: string, fort = false) => (
    <div className={`flex justify-between gap-3 ${fort ? 'text-lg font-bold' : ''}`}><dt>{l}</dt><dd className="tabular-nums">{v}</dd></div>
  );
  return (
    <dl className="flex flex-col gap-1">
      {t.remiseGlobaleCents > 0n ? ligne('Remise globale', `−${formaterEuros(t.remiseGlobaleCents)}`) : null}
      {ligne(avoir ? 'Total HT de l’avoir' : 'Total HT', formaterEuros(t.totalHtCents), true)}
      {franchise ? <p className="text-sm text-encre-douce">TVA non applicable (franchise en base).</p>
        : t.ventilation.map((v) => <div key={v.taux_bp}>{ligne(`TVA ${formaterTaux(v.taux_bp)} sur ${formaterEuros(v.base_ht_cents)}`, formaterEuros(autoliquidation ? 0n : v.tva_cents))}</div>)}
      {autoliquidation ? <p className="text-sm text-encre-douce">Autoliquidation : TVA due par le client.</p> : null}
      {franchise ? null : ligne('Total TTC', formaterEuros(t.totalTtcCents))}
      {deductions.map((d) => <div key={d.facture_id}>{ligne(`Déjà facturé ${d.numero}`, `−${formaterEuros(d.ttc)}`)}</div>)}
      {ligne(avoir ? 'Montant de l’avoir' : 'Net à payer', formaterEuros(net), true)}
    </dl>
  );
}

export default async function PageFacture({ params, searchParams }: PageProps<'/factures/[id]'>) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sp = await searchParams;
  const sb = await clientServeur();
  const c = await chargerFacture(id.data, sb);
  if (!c) notFound();
  const { facture: f, lignes, client, chantier, devis, origine } = c;
  const franchise = f.regime_tva === 'franchise';
  const avoir = f.type === 'avoir';
  const deductions = deductionsDomaine(f.deductions);
  const nomClient = (f.copie_client as { nom_affiche?: string } | null)?.nom_affiche ?? (client ? nomAffiche(client) : '');
  const titre = `${LIBELLES_TYPE_FACTURE[f.type]}${f.numero ? ` ${f.numero}` : ' (brouillon)'}`;
  const st = sousTotaux(lignes.map(ligneFactureDomaine));
  const entete = (
    <div className="flex flex-col gap-1">
      <Link href="/factures" className="inline-flex min-h-12 items-center underline underline-offset-4">← Factures</Link>
      <h1 className="text-2xl font-bold">{titre}</h1>
      <p className="text-encre-douce">
        {LIBELLES_STATUT_FACTURE[f.statut_affiche!] ?? f.statut_affiche} · {nomClient}
        {chantier ? <> · <Link href={`/chantiers/${chantier.id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">{chantier.nom}</Link></> : null}
        {devis ? <> · <Link href={`/devis/${devis.id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">devis {devis.numero}</Link></> : null}
        {origine ? <> · sur <Link href={`/factures/${origine.id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">{origine.numero}</Link></> : null}
      </p>
    </div>
  );
  const ligneLue = (l: (typeof lignes)[number], i: number) => l.type === 'ligne' ? (
    <div className="flex flex-col gap-0.5">
      <p className="font-semibold">{l.designation}</p>
      {l.description ? <p className="text-sm text-encre-douce">{l.description}</p> : null}
      <p className="text-sm tabular-nums">
        {formaterQuantiteE4(BigInt(l.quantite_e4!))} {UNITES[l.unite!]} × {formaterEuros(l.prix_unitaire_ht_cents!)}
        {l.remise_bp ? ` − ${formaterTaux(l.remise_bp)}` : ''}{l.avancement_bp !== null ? ` × ${formaterTaux(l.avancement_bp)} réalisé` : ''}
        {franchise ? '' : ` · TVA ${formaterTaux(l.taux_tva_bp!)}`}
        {' = '}<strong>{formaterEuros(l.total_ht_cents!)} HT</strong>
      </p>
    </div>
  ) : l.type === 'section' ? <p className="text-lg font-bold">{l.designation}</p>
    : l.type === 'sous_total' ? <p className="text-right font-semibold">{l.designation} : {formaterEuros(st.get(i) ?? 0n)} HT</p>
      : <p className="italic">{l.designation}{l.description ? ` — ${l.description}` : ''}</p>;

  // ------------------------------------------------------------------ brouillon
  if (f.statut === 'brouillon') {
    let t: Montants;
    let net = 0n;
    let erreurTotaux: string | null = null;
    try {
      t = totauxFacture(lignes.map(ligneFactureDomaine), f.remise_globale_bp!, f.regime_tva, f.autoliquidation!);
      net = netAPayer(t.totalTtcCents, deductions);
    } catch (e) {
      if (!(e instanceof ErreurFacture)) throw e;
      erreurTotaux = `${e.message} Corrigez les lignes concernées.`;
      t = { ventilation: [], totalHtCents: 0n, totalTvaCents: 0n, totalTtcCents: 0n, remiseGlobaleCents: 0n };
    }
    const libre = f.type === 'libre';
    const taux = libre && !franchise ? await tauxProposes() : [];
    const saisie = (l: (typeof lignes)[number]): LigneSaisie => ({
      id: l.id, type: l.type, designation: l.designation, description: l.description ?? '',
      quantite: l.quantite_e4 === null ? '' : formaterQuantiteE4(BigInt(l.quantite_e4)).replace(/ /g, ''),
      unite: l.unite ?? 'm2', prix: montantVersSaisie(l.prix_unitaire_ht_cents), remise: pourcentageVersSaisie(l.remise_bp),
      taux: l.taux_tva_bp === null ? '' : String(l.taux_tva_bp), optionnelle: false,
    });
    return (
      <div className="flex flex-col gap-4">
        {sp.cree === '1' ? <EffacerBrouillon cles={['facture:nouvelle', `facture:avoir:${f.facture_origine_id ?? ''}`]} /> : null}
        {entete}
        {sp.cree === '1' ? <Message type="succes">Brouillon créé. Vérifiez-le, puis émettez-le.</Message> : null}
        {sp.lignes === 'echec' ? <Message type="erreur">Les lignes n’ont pas pu être créées : supprimez ce brouillon et recommencez.</Message> : null}
        {sp.totaux === 'echec' ? <Message type="alerte">Les totaux n’ont pas pu être recalculés : ils le seront à la prochaine modification et à l’émission.</Message> : null}
        {erreurTotaux ? <Message type="erreur">{erreurTotaux}</Message> : null}
        {f.type === 'situation' ? <Message type="info">Situation : ajustez l’avancement de chaque ligne si besoin (pourcentage réalisé depuis le début du chantier).</Message> : null}

        <Carte titre="Lignes">
          {!lignes.length ? <p className="text-encre-douce">Aucune ligne.{libre ? ' Ajoutez une ligne.' : ''}</p> : null}
          <ol className="flex flex-col gap-2">
            {lignes.map((l, i) => (
              <li key={l.id} className={`rounded-xl border p-3 ${l.type === 'section' ? 'border-anthracite bg-creme' : 'border-trait bg-white'}`}>
                {libre && l.type === 'ligne' ? (
                  <p className="text-sm tabular-nums">
                    <strong>{l.designation}</strong> : {formaterQuantiteE4(BigInt(l.quantite_e4!))} {UNITES[l.unite!]} × {formaterEuros(l.prix_unitaire_ht_cents!)}
                    {' = '}<strong>{formaterEuros(totalLigneFacture(BigInt(l.quantite_e4!), BigInt(l.prix_unitaire_ht_cents!), l.remise_bp, null))} HT</strong>
                  </p>
                ) : ligneLue(l, i)}
                {f.type === 'situation' && l.type === 'ligne' ? (
                  <div className="mt-2"><FormulaireAvancement factureId={f.id} ligneId={l.id} avancement={pourcentageVersSaisie(l.avancement_bp ?? 10_000)} /></div>
                ) : null}
                {libre ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <DeplacerLigneFacture factureId={f.id} id={l.id} premier={i === 0} dernier={i === lignes.length - 1} />
                    <details className="w-full">
                      <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">Modifier</summary>
                      <div className="mt-2 flex flex-col gap-3">
                        <FormulaireLigne devisId={f.id} ligne={saisie(l)} franchise={franchise} taux={taux} facture={{ action: enregistrerLigneFacture }} />
                        <ActionConfirmee action={supprimerLigneFacture} champs={{ facture_id: f.id, id: l.id }} libelle="Supprimer la ligne" variante="danger"
                          confirmation="Je supprime cette ligne" />
                      </div>
                    </details>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          {libre ? (
            <details className="mt-3 rounded-xl border-2 border-dashed border-trait p-3">
              <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold">+ Ajouter une ligne</summary>
              <div className="mt-2">
                <FormulaireLigne devisId={f.id} franchise={franchise} taux={taux} facture={{ action: enregistrerLigneFacture }}
                  ligne={{ type: 'ligne', designation: '', description: '', quantite: '', unite: 'forfait', prix: '', remise: '0', taux: taux[0] ? String(taux[0].taux_bp) : '', optionnelle: false }} />
              </div>
            </details>
          ) : null}
        </Carte>

        <Carte titre="Totaux">
          <Totaux t={t} franchise={franchise} autoliquidation={f.autoliquidation!} deductions={deductions} net={net} avoir={avoir} />
        </Carte>

        <Carte titre={avoir ? 'Motif et dates' : 'Dates et conditions'}>
          <FormulaireEnteteFacture factureId={f.id} version={f.updated_at!} remiseModifiable={libre}
            autoliquidationPossible={f.regime_tva === 'assujetti' && !avoir}
            entete={{
              date_prestation_debut: f.date_prestation_debut ?? '', date_prestation_fin: f.date_prestation_fin ?? '',
              delai_paiement_jours: String(f.delai_paiement_jours), notes_client: f.notes_client ?? '',
              remise_globale_bp: pourcentageVersSaisie(f.remise_globale_bp), autoliquidation: f.autoliquidation!,
            }} />
        </Carte>

        <div className="sticky bottom-20 z-10 grid grid-cols-2 gap-2 rounded-2xl border border-trait bg-white/95 p-2 shadow-md">
          <a href={`/factures/${f.id}/pdf`} target="_blank" rel="noopener" className={`${bouton} border-2 border-anthracite bg-white`}>Aperçu PDF</a>
          <Link href={`/factures/${f.id}/emettre`} className={`${bouton} bg-anthracite text-creme`}>Émettre…</Link>
        </div>
        <ActionConfirmee action={supprimerBrouillonFacture} champs={{ id: f.id }} libelle="Supprimer le brouillon" variante="danger" confirmation="Je supprime ce brouillon" />
      </div>
    );
  }

  // ------------------------------------------------------------------ document émis
  const [{ data: paiements }, { data: envois }, { data: avoirs }] = await Promise.all([
    sb.from('paiements').select('id, date_paiement, montant_cents, mode, reference, annule_paiement_id, created_at').eq('facture_id', f.id).order('created_at'),
    sb.from('envois').select('envoye_le, canal, destinataire, statut, nature, erreur').eq('document_type', 'facture').eq('document_id', f.id).order('envoye_le', { ascending: false }),
    avoir ? Promise.resolve({ data: [] }) : sb.from('factures').select('id, numero, statut, net_a_payer_cents').eq('facture_origine_id', f.id).order('created_at'),
  ]);
  // Montants figés (base) ; la remise globale, non stockée, est recalculée depuis les lignes pour l'affichage.
  function remiseAffichee(): bigint {
    try { return totauxFacture(lignes.map(ligneFactureDomaine), f.remise_globale_bp!, f.regime_tva, f.autoliquidation!).remiseGlobaleCents; } catch { return 0n; }
  }
  const annules = new Set((paiements ?? []).filter((p) => p.annule_paiement_id).map((p) => p.annule_paiement_id));
  const t: Montants = {
    ventilation: ventilationDomaine(f.ventilation_tva), totalHtCents: BigInt(f.total_ht_cents!), totalTvaCents: BigInt(f.total_tva_cents!),
    totalTtcCents: BigInt(f.total_ttc_cents!), remiseGlobaleCents: remiseAffichee(),
  };
  const reste = BigInt(avoir ? f.reste_a_rembourser_cents ?? 0 : f.reste_a_payer_cents ?? 0);
  const encaissable = f.statut === 'emise' && reste > 0n;

  return (
    <div className="flex flex-col gap-4">
      {entete}
      {sp.paiement === 'enregistre' ? <><EffacerBrouillon cles={[`facture:paiement:${f.id}`]} /><Message type="succes">{avoir ? 'Remboursement enregistré.' : 'Paiement enregistré.'}</Message></> : null}
      {sp.paiement === 'annule' ? <Message type="succes">Paiement annulé : une écriture d’annulation a été ajoutée.</Message> : null}
      {sp.emise === '1' ? <Message type="succes">{avoir ? 'Avoir émis' : 'Facture émise'} : numéro attribué, PDF figé.{avoir ? '' : ' Envoyez-la au client.'}</Message> : null}
      {f.statut === 'annulee' ? <Message type="info">Annulée par avoir{f.annulee_le ? ` le ${formaterDate(f.annulee_le)}` : ''}.</Message> : null}
      {f.statut_affiche === 'en_retard' ? <Message type="alerte">Échéance dépassée ({formaterDate(f.date_echeance!)}) : {formaterEuros(reste)} restent à payer.</Message> : null}
      {!avoir && f.statut === 'emise' && !f.envoyee_le ? <Message type="info">Émise, pas encore envoyée : les relances d’impayés partent seulement après l’envoi.</Message> : null}

      <Carte titre="Montant">
        <Totaux t={t} franchise={franchise} autoliquidation={f.autoliquidation!} deductions={deductions} net={BigInt(f.net_a_payer_cents!)} avoir={avoir} />
        <dl className="mt-3 flex flex-col gap-1 border-t border-trait pt-2">
          {!avoir && f.avoirs_cents ? <div className="flex justify-between gap-3"><dt>Avoirs</dt><dd className="tabular-nums">−{formaterEuros(f.avoirs_cents)}</dd></div> : null}
          <div className="flex justify-between gap-3"><dt>{avoir ? 'Déjà remboursé' : 'Déjà payé'}</dt><dd className="tabular-nums">{formaterEuros(f.paye_cents ?? 0)}</dd></div>
          <div className="flex justify-between gap-3 text-lg font-bold"><dt>{avoir ? 'Reste à rembourser' : 'Reste à payer'}</dt><dd className="tabular-nums">{formaterEuros(reste)}</dd></div>
        </dl>
        <p className="mt-2 text-sm text-encre-douce">
          Émise le {formaterDate(f.date_emission!)}{avoir ? '' : ` · échéance le ${formaterDate(f.date_echeance!)}`}
          {f.envoyee_le ? ` · envoyée le ${formaterDateHeure(f.envoyee_le)}` : ''}
        </p>
      </Carte>

      <div className="flex flex-col gap-2">
        <a href={`/factures/${f.id}/pdf`} target="_blank" rel="noopener" className={`${bouton} border-2 border-anthracite bg-white`}>PDF {avoir ? 'de l’avoir' : 'de la facture'}</a>
      </div>

      <Carte titre={avoir ? 'Remboursements' : 'Paiements'}>
        {paiements?.length ? (
          <ul className="mb-3 flex flex-col gap-2">
            {paiements.map((p) => (
              <li key={p.id} className={`rounded-xl border border-trait p-3 ${annules.has(p.id) || p.montant_cents < 0 ? 'text-encre-douce' : ''}`}>
                <p className="tabular-nums">
                  {formaterDate(p.date_paiement)} · <strong>{formaterEuros(p.montant_cents)}</strong> · {MODES[p.mode] ?? p.mode}
                  {p.reference ? ` · ${p.reference}` : ''}{p.montant_cents < 0 ? ' (annulation)' : ''}{annules.has(p.id) ? ' (annulé)' : ''}
                </p>
                {p.montant_cents > 0 && !annules.has(p.id) && p.mode !== 'stripe' ? <AnnulerPaiement factureId={f.id} paiementId={p.id} /> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mb-3 text-encre-douce">{avoir ? 'Aucun remboursement.' : 'Aucun paiement reçu.'}</p>}
        {encaissable ? (
          <details open={!paiements?.length && sp.emise !== '1'}>
            <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">
              {avoir ? 'Enregistrer un remboursement' : 'Enregistrer un paiement'}
            </summary>
            <div className="mt-2"><FormulairePaiement factureId={f.id} reste={montantVersSaisie(Number(reste))} aujourdhui={aujourdHuiParis()} remboursement={avoir} /></div>
          </details>
        ) : null}
      </Carte>

      {!avoir && f.statut === 'emise' ? (
        <Carte titre="Envoyer au client">
          <EnvoiFacture factureId={f.id} email={client?.email ?? null} emailActif={emailConfigure()} />
          {!f.envoyee_le ? (
            <div className="mt-3">
              <ActionConfirmee action={marquerEnvoyee} champs={{ id: f.id }} libelle="Marquer envoyée (remise en main propre, courrier…)" variante="discret" />
            </div>
          ) : null}
        </Carte>
      ) : null}

      {envois?.length ? (
        <Carte titre="Envois et relances">
          <ul className="flex flex-col gap-1 text-sm">
            {envois.map((e, i) => (
              <li key={i}>
                {formaterDateHeure(e.envoye_le)} · {e.nature.startsWith('impaye') ? `relance ${e.nature.slice(-1)}` : 'envoi'} · {e.canal === 'email' ? `email à ${e.destinataire}` : 'lien partagé'}
                {e.statut === 'echec' ? <strong className="text-danger"> · échec{e.erreur ? ` (${e.erreur})` : ''}</strong> : null}
                {e.statut === 'en_cours' ? <strong className="text-alerte"> · envoi non confirmé</strong> : null}
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}

      {!avoir ? (
        <Carte titre="Avoirs">
          {avoirs?.length ? (
            <ul className="mb-3 flex flex-col gap-1">
              {avoirs.map((a) => (
                <li key={a.id}>
                  <Link href={`/factures/${a.id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                    {a.numero ?? 'Avoir en brouillon'} · {formaterEuros(a.net_a_payer_cents)}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {f.statut === 'emise' ? (
            <Link href={`/factures/${f.id}/avoir`} className={`${bouton} border-2 border-trait bg-white`}>Corriger ou annuler : établir un avoir</Link>
          ) : null}
        </Carte>
      ) : null}

      <Carte titre="Facture électronique (Factur-X)">
        <p className="mb-2 text-sm">Données structurées préparées au format Factur-X (profil EN 16931), <strong>À VÉRIFIER</strong> : elles ne sont pas encore intégrées au PDF ni transmises à une plateforme.</p>
        {f.facturx_chemin ? (
          <a href={`/factures/${f.id}/facturx`} className={`${bouton} border-2 border-trait bg-white`}>Télécharger le XML</a>
        ) : (
          <ActionConfirmee action={genererFacturX} champs={{ id: f.id }} libelle="Préparer le XML" variante="discret" />
        )}
      </Carte>
    </div>
  );
}
