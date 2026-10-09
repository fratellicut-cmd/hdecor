import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { chargerDevis, aCompleter, ligneDomaine } from '@/lib/devis';
import { clientServeur } from '@/lib/supabase/serveur';
import { tauxProposes } from '@/lib/taux';
import { emailConfigure } from '@/lib/email';
import { acompte, ErreurDevis, montantsEcheances, LIBELLES_STATUT_DEVIS, sousTotaux, totalLigne, totauxDevis, type TotauxDevis } from '@/domain/devis';
import { formaterQuantiteE4, UNITES } from '@/domain/devis-document';
import { formaterDate, formaterDateHeure, formaterEuros, formaterTaux, montantVersSaisie, pourcentageVersSaisie } from '@/domain/formats';
import { nomAffiche } from '@/domain/clients';
import { formaterContenance } from '@/domain/peinture';
import {
  archiverSigne, dupliquerDevis, importerPostes, nouvelleVersion, revoquerLiens, supprimerBrouillon, supprimerEcheance, supprimerLigne,
} from '../actions';
import { DeplacerLigne, EnvoiDevis, FormulaireRefus, FormulaireEcheance, FormulaireEntete, FormulaireLigne, type LigneSaisie } from '@/components/devis/Formulaires';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { EffacerBrouillon } from '@/components/formulaire/EffacerBrouillon';
import { BadgeAVerifier } from '@/components/ui/Champ';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Devis' };

/** Raison du prix « à compléter » d'une ligne reprise (gardée dans son origine). */
function raisonACompleter(l: { origine: unknown }): string {
  const o = l.origine as { manque?: unknown } | null;
  return typeof o?.manque === 'string' ? `Prix non calculé : ${o.manque}` : 'Prix non calculé (temps, prix ou surface manquants).';
}

const bouton = 'inline-flex min-h-12 items-center justify-center rounded-xl px-4 font-semibold';
const DECLENCHEURS: Record<string, string> = {
  signature: 'à la signature', debut_travaux: 'au début des travaux', mi_chantier: 'à mi-chantier', fin_travaux: 'à la fin des travaux', date: 'le',
};

function Totaux({ t, franchise, remiseBp }: { t: TotauxDevis; franchise: boolean; remiseBp: number }) {
  const ligne = (l: string, v: string, fort = false) => (
    <div className={`flex justify-between gap-3 ${fort ? 'text-lg font-bold' : ''}`}><dt>{l}</dt><dd className="tabular-nums">{v}</dd></div>
  );
  return (
    <dl className="flex flex-col gap-1">
      {t.remiseGlobaleCents > 0n ? <>{ligne('Total des lignes HT', formaterEuros(t.sommeLignesCents))}{ligne(`Remise ${formaterTaux(remiseBp)}`, `−${formaterEuros(t.remiseGlobaleCents)}`)}</> : null}
      {ligne('Total HT', formaterEuros(t.totalHtCents), true)}
      {franchise ? <p className="text-sm text-encre-douce">TVA non applicable (franchise en base).</p>
        : t.ventilation.map((v) => <div key={v.taux_bp}>{ligne(`TVA ${formaterTaux(v.taux_bp)} sur ${formaterEuros(v.base_ht_cents)}`, formaterEuros(v.tva_cents))}</div>)}
      {ligne(franchise ? 'Net à payer' : 'Total TTC', formaterEuros(t.totalTtcCents), true)}
      {t.optionsHtCents > 0n ? <p className="text-sm text-encre-douce">Options proposées (hors total) : {formaterEuros(t.optionsHtCents)} HT</p> : null}
    </dl>
  );
}

export default async function PageDevis({ params, searchParams }: PageProps<'/devis/[id]'>) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sp = await searchParams;
  const c = await chargerDevis(id.data);
  if (!c) notFound();
  const { devis: d, lignes, echeances, client, chantier } = c;
  const franchise = d.regime_tva === 'franchise';
  // Brouillon dupliqué après un changement de régime : lignes à corriger, pas de plantage.
  let totaux: TotauxDevis;
  let erreurTotaux: string | null = null;
  try { totaux = totauxDevis(lignes.map(ligneDomaine), d.remise_globale_bp!, d.regime_tva); } catch (e) {
    if (!(e instanceof ErreurDevis)) throw e;
    erreurTotaux = `${e.message} Modifiez les lignes concernées.`;
    totaux = { ventilation: [], totalHtCents: 0n, totalTvaCents: 0n, totalTtcCents: 0n, sommeLignesCents: 0n, remiseGlobaleCents: 0n, optionsHtCents: 0n };
  }
  const st = sousTotaux(lignes.map(ligneDomaine));
  const sb = await clientServeur();
  const nomClient = client ? nomAffiche(client) : '';
  const titre = d.numero ? `${d.numero}${d.version! > 1 ? ` (version ${d.version})` : ''}` : `Brouillon${d.version! > 1 ? ` de la version ${d.version}` : ''}`;
  const { data: alertes } = await sb.from('v_alertes_prix').select('marque, designation, contenance, unite_mesure, prix_achat_retenu_cents, prix_actuel_cents').eq('devis_id', d.id);

  const entete = (
    <div className="flex flex-col gap-1">
      <Link href="/devis" className="inline-flex min-h-12 items-center underline underline-offset-4">← Devis</Link>
      <h1 className="text-2xl font-bold">{titre}</h1>
      <p className="text-encre-douce">
        {LIBELLES_STATUT_DEVIS[d.statut_affiche!] ?? d.statut_affiche} · {nomClient}
        {chantier ? <> · <Link href={`/chantiers/${chantier.id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">{chantier.nom}</Link></> : null}
      </p>
    </div>
  );
  const alertesPrix = alertes?.length ? (
    <div className="flex flex-col gap-1 rounded-xl bg-alerte-fond p-3 text-alerte">
      <p className="font-semibold">Prix d’achat changés depuis le chiffrage :</p>
      <ul className="list-disc pl-5 text-sm font-semibold">
        {alertes.map((a, i) => (
          <li key={i}>{a.marque} {a.designation} ({formaterContenance(a.contenance!, a.unite_mesure === 'kg' ? 'kg' : 'L')}) : {a.prix_achat_retenu_cents === null ? 'prix inconnu' : formaterEuros(a.prix_achat_retenu_cents)} → {a.prix_actuel_cents === null ? 'prix inconnu' : formaterEuros(a.prix_actuel_cents)}</li>
        ))}
      </ul>
    </div>
  ) : null;

  // ------------------------------------------------------------------ brouillon
  if (d.statut === 'brouillon') {
    const taux = franchise ? [] : await tauxProposes();
    const saisie = (l: (typeof lignes)[number]): LigneSaisie => ({
      id: l.id, type: l.type, designation: l.designation, description: l.description ?? '',
      quantite: l.quantite_e4 === null ? '' : formaterQuantiteE4(BigInt(l.quantite_e4)).replace(/ /g, ''),
      unite: l.unite ?? 'm2', prix: montantVersSaisie(l.prix_unitaire_ht_cents), remise: pourcentageVersSaisie(l.remise_bp),
      taux: l.taux_tva_bp === null ? '' : String(l.taux_tva_bp), optionnelle: l.optionnelle,
    });
    const nbACompleter = lignes.filter(aCompleter).length;
    const totalEcheances = echeances.reduce((a, e) => a + e.pourcentage_bp, 0);
    const montants = totalEcheances <= 10_000 ? montantsEcheances(totaux.ventilation, echeances.map((e) => e.pourcentage_bp), d.regime_tva) : [];
    return (
      <div className="flex flex-col gap-4">
        {sp.cree === '1' ? <EffacerBrouillon cles={['devis:nouveau']} /> : null}
        {entete}
        {sp.cree === '1' ? <Message type="succes">Brouillon créé. Vérifiez chaque ligne, puis émettez le devis.</Message> : null}
        {sp.duplique === '1' ? <Message type="succes">Copie créée (nouveau brouillon, nouveau numéro à l’émission).</Message> : null}
        {sp.regime === '1' ? <Message type="alerte">Votre régime de TVA a changé depuis le devis copié : vérifiez le taux de TVA de chaque ligne.</Message> : null}
        {sp.reprise === 'totaux' ? <Message type="erreur">Postes repris, mais les totaux n’ont pas pu être recalculés : modifiez une ligne ou rechargez la page.</Message> : null}
        {sp.achats === 'echec' ? <Message type="alerte">Les achats retenus (alerte de prix d’achat) n’ont pas été enregistrés : relancez « Reprendre les postes ».</Message> : null}
        {sp.version === '1' ? <Message type="succes">Nouvelle version en brouillon : l’ancienne est marquée « remplacée » et ses liens sont désactivés.</Message> : null}
        {sp.reprise === 'echec' ? <Message type="erreur">Les postes n’ont pas pu être repris : réessayez avec « Reprendre les postes ».</Message> : null}
        {sp.reprise === 'taux' ? <Message type="erreur">Aucun taux de TVA actif : renseignez-les dans les Paramètres, puis reprenez les postes.</Message> : null}
        {nbACompleter ? <Message type="alerte">{nbACompleter} ligne{nbACompleter > 1 ? 's' : ''} à compléter : prix non calculable (temps, prix ou surface manquants). Ouvrez-la et saisissez le prix.</Message> : null}
        {alertesPrix}
        {erreurTotaux ? <Message type="erreur">{erreurTotaux}</Message> : null}

        <Carte titre="Lignes">
          {!lignes.length ? <p className="text-encre-douce">Aucune ligne. Reprenez les postes du chantier ou ajoutez une ligne.</p> : null}
          <ol className="flex flex-col gap-2">
            {lignes.map((l, i) => (
              <li key={l.id} className={`rounded-xl border p-3 ${l.type === 'section' ? 'border-anthracite bg-creme' : 'border-trait bg-white'}`}>
                {l.type === 'ligne' ? (
                  <div className="flex flex-col gap-0.5">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {l.designation}
                      {l.optionnelle ? <span className="rounded-md border border-anthracite px-2 text-sm">Option</span> : null}
                      {aCompleter(l) ? <BadgeAVerifier texte="PRIX À COMPLÉTER" /> : null}
                    </p>
                    {l.description ? <p className="text-sm text-encre-douce">{l.description}</p> : null}
                    {aCompleter(l) ? <p className="text-sm font-semibold text-alerte">{raisonACompleter(l)} Saisissez le prix au m² ou complétez le calcul (<Link href="/catalogue" className="inline-flex min-h-11 items-center underline underline-offset-4">catalogue</Link>, <Link href="/parametres/calcul" className="inline-flex min-h-11 items-center underline underline-offset-4">réglages</Link>).</p> : null}
                    <p className="text-sm tabular-nums">
                      {formaterQuantiteE4(BigInt(l.quantite_e4!))} {UNITES[l.unite!]} × {formaterEuros(l.prix_unitaire_ht_cents!)}
                      {l.remise_bp ? ` − ${formaterTaux(l.remise_bp)}` : ''}{franchise ? '' : ` · TVA ${formaterTaux(l.taux_tva_bp!)}`}
                      {' = '}<strong>{formaterEuros(totalLigne(BigInt(l.quantite_e4!), BigInt(l.prix_unitaire_ht_cents!), l.remise_bp))} HT</strong>
                    </p>
                  </div>
                ) : l.type === 'section' ? <p className="text-lg font-bold">{l.designation}</p>
                  : l.type === 'sous_total' ? <p className="text-right font-semibold">{l.designation} : {formaterEuros(st.get(i) ?? 0n)} HT</p>
                    : <p className="italic">{l.designation}{l.description ? ` — ${l.description}` : ''}</p>}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <DeplacerLigne devisId={d.id} id={l.id} premier={i === 0} dernier={i === lignes.length - 1} />
                  <details className="w-full">
                    <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">Modifier</summary>
                    <div className="mt-2 flex flex-col gap-3">
                      <FormulaireLigne devisId={d.id} ligne={saisie(l)} franchise={franchise} taux={taux} />
                      <ActionConfirmee action={supprimerLigne} champs={{ devis_id: d.id, id: l.id }} libelle="Supprimer la ligne" variante="danger"
                        confirmation="Je supprime cette ligne" />
                    </div>
                  </details>
                </div>
              </li>
            ))}
          </ol>
          <details className="mt-3 rounded-xl border-2 border-dashed border-trait p-3">
            <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold">+ Ajouter une ligne</summary>
            <div className="mt-2">
              <FormulaireLigne devisId={d.id} franchise={franchise} taux={taux}
                ligne={{ type: 'ligne', designation: '', description: '', quantite: '', unite: 'm2', prix: '', remise: '0', taux: taux[0] ? String(taux[0].taux_bp) : '', optionnelle: false }} />
            </div>
          </details>
          {d.chantier_id ? (
            <div className="mt-3">
              <ActionConfirmee action={importerPostes} champs={{ devis_id: d.id }} libelle="Reprendre les postes de peinture du chantier"
                explication="Ajoute les postes pas encore repris (surface affichée, prix de vente calculé). Les lignes existantes ne changent pas." />
            </div>
          ) : null}
        </Carte>

        <Carte titre="Totaux"><Totaux t={totaux} franchise={franchise} remiseBp={d.remise_globale_bp!} /></Carte>

        <Carte titre="Échéancier">
          {echeances.length ? (
            <ul className="mb-3 flex flex-col gap-2">
              {echeances.map((e, i) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-trait p-3">
                  <span>
                    <strong>{e.libelle}</strong> : {formaterTaux(e.pourcentage_bp)} {e.declencheur === 'date' && e.date_prevue ? `le ${formaterDate(e.date_prevue)}` : DECLENCHEURS[e.declencheur]}
                    {' '}({formaterEuros(montants[i]?.ttcCents ?? 0n)}{franchise ? '' : ' TTC'})
                  </span>
                  <ActionConfirmee action={supprimerEcheance} champs={{ devis_id: d.id, id: e.id }} libelle="Retirer" variante="discret" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-encre-douce">
              Sans échéancier : acompte de {formaterTaux(d.acompte_pct_bp!)} à la signature
              ({formaterEuros(acompte(totaux.ventilation, d.acompte_pct_bp!, d.regime_tva).ttcCents)}{franchise ? '' : ' TTC'}).
            </p>
          )}
          {echeances.length && totalEcheances !== 10_000 ? <Message type="info">Total de l’échéancier : {formaterTaux(totalEcheances)} du devis.</Message> : null}
          <details>
            <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">Ajouter une échéance</summary>
            <div className="mt-2"><FormulaireEcheance devisId={d.id} /></div>
          </details>
        </Carte>

        <Carte titre="En-tête et conditions">
          <FormulaireEntete devisId={d.id} version={d.updated_at!} avecEcheancier={echeances.length > 0} entete={{
            objet: d.objet ?? '', validite_jours: String(d.validite_jours), date_debut_travaux: d.date_debut_travaux ?? '',
            delai_debut_texte: d.delai_debut_texte ?? '', duree_estimee_jours: d.duree_estimee_jours === null ? '' : String(d.duree_estimee_jours).replace('.', ','),
            conditions_paiement: d.conditions_paiement ?? '', hors_etablissement: d.hors_etablissement!, remise_globale_bp: pourcentageVersSaisie(d.remise_globale_bp),
            acompte_pct_bp: pourcentageVersSaisie(d.acompte_pct_bp), notes_client: d.notes_client ?? '',
          }} />
        </Carte>

        {/* Barre d'actions à portée du pouce, au-dessus de la navigation. */}
        <div className="sticky bottom-20 z-10 grid grid-cols-2 gap-2 rounded-2xl border border-trait bg-white/95 p-2 shadow-md">
          <a href={`/devis/${d.id}/pdf`} target="_blank" rel="noopener" className={`${bouton} border-2 border-anthracite bg-white`}>Aperçu PDF</a>
          <Link href={`/devis/${d.id}/emettre`} className={`${bouton} bg-anthracite text-creme`}>Émettre…</Link>
        </div>
        <div className="flex flex-col gap-2">
          <ActionConfirmee action={dupliquerDevis} champs={{ id: d.id }} libelle="Dupliquer" variante="discret" />
          <ActionConfirmee action={supprimerBrouillon} champs={{ id: d.id }} libelle="Supprimer le brouillon" variante="danger" confirmation="Je supprime ce brouillon" />
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ devis émis
  const [{ data: signature }, { data: envois }, { data: liens }, { data: suivante }] = await Promise.all([
    d.signature_id ? sb.from('signatures').select('signataire_nom, signe_le, methode, options_acceptees, pdf_signe_chemin, ip').eq('id', d.signature_id).maybeSingle()
      : Promise.resolve({ data: null }),
    sb.from('envois').select('envoye_le, canal, destinataire, statut, nature, erreur').eq('document_type', 'devis').eq('document_id', d.id).order('envoye_le', { ascending: false }),
    sb.from('liens_publics').select('id, finalite, expire_le, utilise_le, revoque_le').eq('devis_id', d.id),
    d.statut === 'remplace' ? sb.from('devis').select('id, version').eq('devis_precedent_id', d.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const maintenant = new Date().toISOString();
  const liensActifs = (liens ?? []).filter((l) => !l.revoque_le && l.expire_le > maintenant && !(l.finalite === 'signature' && l.utilise_le)).length;
  const signable = d.statut === 'envoye' && d.statut_affiche !== 'expire';
  const optionsRetenues = signature ? lignes.filter((l) => signature.options_acceptees.includes(l.id)).map((l) => l.designation) : [];

  return (
    <div className="flex flex-col gap-4">
      {entete}
      {sp.emis === '1' && d.statut === 'envoye' ? <Message type="succes">Devis émis : numéro attribué, PDF figé. Envoyez-le ou faites-le signer.</Message> : null}
      {d.statut === 'envoye' && !envois?.length && !liens?.length ? <Message type="info">Émis, pas encore envoyé au client : créez un lien ou envoyez-le par email.</Message> : null}
      {suivante ? (
        <Message type="info">
          Remplacé par la version {suivante.version}.{' '}
          <Link href={`/devis/${suivante.id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">Voir la version en cours</Link>
        </Message>
      ) : null}
      {sp.signe === '1' ? <Message type="succes">Devis signé.</Message> : null}
      {sp.archive === '0' || (signature && !signature.pdf_signe_chemin) ? (
        <Message type="alerte">
          Le PDF signé n’a pas encore été archivé (la signature, elle, est enregistrée).
          <span className="mt-2 block"><ActionConfirmee action={archiverSigne} champs={{ id: d.id }} libelle="Archiver le PDF signé" /></span>
        </Message>
      ) : null}
      {d.statut_affiche === 'expire' ? <Message type="alerte">Ce devis a dépassé sa date de validité : il ne peut plus être signé. Créez une nouvelle version.</Message> : null}
      {d.statut === 'envoye' ? alertesPrix : null}

      <Carte titre="Montant">
        <Totaux t={totaux} franchise={franchise} remiseBp={d.remise_globale_bp!} />
        <p className="mt-2 text-sm text-encre-douce">
          Émis le {formaterDate(d.date_emission!)} · valable jusqu’au {formaterDate(d.valide_jusqu_au!)}
          {d.consulte_le ? ` · consulté le ${formaterDateHeure(d.consulte_le)}` : ''}
        </p>
      </Carte>

      {signature ? (
        <Carte titre="Signature">
          <p>Signé par <strong>{signature.signataire_nom}</strong> le {formaterDateHeure(signature.signe_le)} ({signature.methode === 'sur_place' ? 'sur place' : 'par lien'}).</p>
          {optionsRetenues.length ? <p>Options retenues : {optionsRetenues.join(', ')}.</p> : null}
          <p className="font-semibold">Montant accepté : {formaterEuros(d.total_accepte_ttc_cents!)}{franchise ? '' : ' TTC'}</p>
        </Carte>
      ) : null}
      {d.statut === 'refuse' ? <Message type="info">Refusé le {formaterDateHeure(d.refuse_le!)}{d.motif_refus ? ` : ${d.motif_refus}` : ''}.</Message> : null}

      <div className="flex flex-col gap-2">
        <a href={`/devis/${d.id}/pdf`} target="_blank" rel="noopener" className={`${bouton} border-2 border-anthracite bg-white`}>PDF du devis</a>
        {signature?.pdf_signe_chemin ? <a href={`/devis/${d.id}/pdf?signe=1`} target="_blank" rel="noopener" className={`${bouton} border-2 border-anthracite bg-white`}>PDF signé</a> : null}
        {signable ? <Link href={`/devis/${d.id}/signer`} className={`${bouton} bg-anthracite text-creme`}>Faire signer sur place</Link> : null}
        {d.devis_precedent_id ? <Link href={`/devis/${d.id}/comparer`} className={`${bouton} border-2 border-trait bg-white`}>Comparer avec la version précédente</Link> : null}
      </div>

      {signable ? (
        <Carte titre="Envoyer pour signature">
          <EnvoiDevis devisId={d.id} email={client?.email ?? null} emailActif={emailConfigure()} />
          {liensActifs ? (
            <div className="mt-3">
              <ActionConfirmee action={revoquerLiens} champs={{ id: d.id }} libelle={`Désactiver les liens actifs (${liensActifs})`} variante="discret" />
            </div>
          ) : null}
        </Carte>
      ) : null}

      {envois?.length ? (
        <Carte titre="Envois">
          <ul className="flex flex-col gap-1 text-sm">
            {envois.map((e, i) => (
              <li key={i}>
                {formaterDateHeure(e.envoye_le)} · {e.nature === 'relance_devis' ? 'relance' : 'envoi'} · {e.canal === 'email' ? `email à ${e.destinataire}` : 'lien partagé'}
                {e.statut === 'echec' ? <strong className="text-danger"> · échec{e.erreur ? ` (${e.erreur})` : ''}</strong> : null}
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}

      <Carte titre="Autres actions">
        <div className="flex flex-col gap-2">
          {d.statut === 'envoye' ? (
            <ActionConfirmee action={nouvelleVersion} champs={{ id: d.id }} libelle="Modifier : créer une nouvelle version"
              confirmation="Je crée une version suivante (celle-ci sera marquée « remplacée » et ses liens désactivés)" />
          ) : null}
          {d.statut === 'envoye' ? (
            <FormulaireRefus devisId={d.id} />
          ) : null}
          <ActionConfirmee action={dupliquerDevis} champs={{ id: d.id }} libelle="Dupliquer (nouveau devis)" variante="discret" />
        </div>
      </Carte>
    </div>
  );
}
