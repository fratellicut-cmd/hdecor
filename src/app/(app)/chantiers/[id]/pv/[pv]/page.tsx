import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { chargerPv } from '@/lib/pv';
import { aujourdHuiParis } from '@/domain/dates';
import { formaterDate, formaterDateHeure } from '@/domain/formats';
import { dateLimiteLevee, etatReserves, texteDecision } from '@/domain/pv';
import { archiverPv, presenterPv, supprimerPv } from '../../../pv-actions';
import { FormulaireLevee, FormulairePv } from '@/components/chantiers/Pv';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { EffacerBrouillon } from '@/components/formulaire/EffacerBrouillon';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'PV de réception' };

export default async function PagePv({ params, searchParams }: PageProps<'/chantiers/[id]/pv/[pv]'>) {
  await verifierSession();
  const p = await params;
  const sp = await searchParams;
  const chantierId = z.uuid().safeParse(p.id);
  const pvId = z.uuid().safeParse(p.pv);
  if (!chantierId.success || !pvId.success) notFound();
  const sb = await clientServeur();
  const c = await chargerPv(sb, pvId.data);
  if (!c || c.chantier.id !== chantierId.data) notFound();
  const { pv, chantier, signature } = c;
  const signe = pv.statut === 'signe';
  const etat = etatReserves(pv.reserves);
  const { data: devis } = signe ? { data: [] } : await sb.from('devis').select('id, numero, version').eq('chantier_id', chantier.id).eq('statut', 'accepte');
  const lienPdf = `/chantiers/${chantier.id}/pv/${pv.id}/pdf`;

  return (
    <div className="flex flex-col gap-4">
      <EffacerBrouillon cles={[`pv:nouveau:${chantier.id}`]} />
      <div className="flex flex-col gap-1">
        <Link href={`/chantiers/${chantier.id}/pv`} className="inline-flex min-h-12 items-center underline underline-offset-4">← Réception · {chantier.nom}</Link>
        <h1 className="text-2xl font-bold">PV du {formaterDate(pv.date_reception)}</h1>
        <p className="font-semibold">{signe ? `Signé le ${formaterDateHeure(signature!.signe_le)} par ${signature!.signataire_nom}` : 'Brouillon'} · {etat.libelle}</p>
      </div>
      {sp.signe === '1' ? <Message type="succes">Procès-verbal signé.</Message> : null}
      {signe && !signature?.pdf_signe_chemin ? (
        <Message type="erreur">
          Le PDF signé n’est pas encore archivé.
          <span className="mt-2 block"><ActionConfirmee action={archiverPv} champs={{ id: pv.id }} libelle="Archiver maintenant" /></span>
        </Message>
      ) : null}

      {signe ? (
        <>
          <a href={lienPdf} target="_blank" rel="noopener" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-anthracite px-4 font-semibold text-creme">PV signé (PDF)</a>
          <Carte titre="Décision">
            <p>{texteDecision(pv.reserves)}</p>
            {pv.travaux ? <p className="mt-2 text-sm whitespace-pre-line">{pv.travaux}</p> : null}
          </Carte>
          {pv.reserves.length ? (
            <Carte titre="Réserves">
              <ol className="flex flex-col divide-y divide-trait">
                {pv.reserves.map((r, i) => (
                  <li key={i} className="flex flex-col gap-2 py-3">
                    <p className="font-semibold">{i + 1}. {r.description}</p>
                    {r.levee_le ? (
                      <p className="text-sm">✓ Levée déclarée par l’entreprise le {formaterDate(r.levee_le)}{r.levee_note ? ` : ${r.levee_note}` : ''}</p>
                    ) : <FormulaireLevee id={pv.id} rang={i} aujourdhui={aujourdHuiParis()} />}
                  </li>
                ))}
              </ol>
              {pv.delai_levee_jours ? <p className="mt-2 text-sm text-encre-douce">À lever avant le {formaterDate(dateLimiteLevee(pv.date_reception, pv.delai_levee_jours)!)} ({pv.delai_levee_jours} jours après la réception).</p> : null}
            </Carte>
          ) : null}
        </>
      ) : (
        <>
          <Carte titre="Faire signer">
            <p className="mb-3">Relisez le PV avec le client, puis présentez-le : le document est figé, le client le signe sur votre téléphone.</p>
            <ActionConfirmee action={presenterPv} champs={{ id: pv.id }} libelle="Présenter au client pour signature" />
            <a href={lienPdf} target="_blank" rel="noopener" className="mt-2 inline-flex min-h-12 items-center underline underline-offset-4">Aperçu du PDF</a>
          </Carte>
          <Carte titre="Contenu du PV">
            <FormulairePv chantierId={chantier.id} devis={(devis ?? []).map((d) => ({ id: d.id, libelle: `${d.numero}${d.version > 1 ? ` v${d.version}` : ''}` }))}
              pv={{
                id: pv.id, date_reception: pv.date_reception, travaux: pv.travaux ?? '', reserves: pv.reserves.map((r) => r.description).join('\n'),
                observations: pv.observations ?? '', delai_levee_jours: pv.delai_levee_jours === null ? '' : String(pv.delai_levee_jours), devis_id: pv.devis_id ?? '',
              }} />
          </Carte>
          <ActionConfirmee action={supprimerPv} champs={{ id: pv.id }} libelle="Supprimer ce brouillon" variante="danger" confirmation="Je supprime ce brouillon de PV" />
        </>
      )}
    </div>
  );
}
