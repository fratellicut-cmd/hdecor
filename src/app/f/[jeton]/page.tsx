import type { Metadata } from 'next';
import { factureParJeton } from '@/lib/facture-publique';
import { jetonBienForme } from '@/lib/liens';
import { formaterIban } from '@/domain/factures';
import { payloadVirementSepa } from '@/domain/virement';
import { formaterDate, formaterEuros } from '@/domain/formats';
import { QrVirement } from '@/components/factures/QrVirement';
import { Message } from '@/components/ui/Message';
import { stripeConfigure } from '@/lib/stripe';
import { payerEnLigne } from './actions';

export const metadata: Metadata = { title: 'Votre facture', robots: { index: false, follow: false } };

const bouton = 'inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-anthracite bg-white px-4 font-semibold';

export default async function PageFacturePublique({ params, searchParams }: PageProps<'/f/[jeton]'>) {
  const { jeton } = await params;
  const sp = await searchParams;
  const f = jetonBienForme(jeton) ? await factureParJeton(jeton) : null;
  if (!f) {
    return (
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <h1 className="text-2xl font-bold">Lien invalide ou expiré</h1>
        <p>Ce lien n’est plus valable (expiré ou désactivé). Demandez un nouveau lien à l’entreprise.</p>
      </main>
    );
  }
  const reference = `Facture ${f.numero}`;
  let qr: string | null = null;
  if (f.iban && f.resteAPayerCents > 0n) {
    try { qr = payloadVirementSepa({ beneficiaire: f.entreprise, iban: f.iban, bic: f.bic, montantCents: f.resteAPayerCents, reference }); } catch { qr = null; }
  }
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <p className="font-semibold text-encre-douce">{f.entreprise}</p>
      <h1 className="text-2xl font-bold">{f.titre}</h1>
      {f.type === 'avoir' ? (
        <p>Montant de l’avoir : <strong>{formaterEuros(f.netAPayerCents)}</strong></p>
      ) : f.statut === 'annulee' ? (
        <Message type="info">Cette facture a été annulée par un avoir.</Message>
      ) : f.resteAPayerCents === 0n ? (
        <Message type="succes">Cette facture est réglée. Merci !</Message>
      ) : (
        <p>
          Reste à payer : <strong>{formaterEuros(f.resteAPayerCents)}</strong>
          {f.dateEcheance ? <> · au plus tard le <strong>{formaterDate(f.dateEcheance)}</strong></> : null}
        </p>
      )}
      {sp.paiement === 'en_cours' && f.resteAPayerCents > 0n ? <Message type="info">Paiement par carte reçu par Stripe : il apparaîtra ici dès sa confirmation (quelques instants).</Message> : null}
      {sp.paiement === 'indisponible' ? <Message type="erreur">Le paiement par carte est indisponible pour l’instant : réessayez plus tard ou payez par virement.</Message> : null}
      <a href={`/f/${jeton}/pdf`} target="_blank" rel="noopener noreferrer" className={bouton}>Télécharger {f.type === 'avoir' ? 'l’avoir' : 'la facture'} (PDF)</a>
      {stripeConfigure() && f.type !== 'avoir' && f.statut === 'emise' && f.resteAPayerCents > 0n ? (
        <form action={payerEnLigne.bind(null, jeton)}>
          <button type="submit" className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-anthracite px-4 font-semibold text-creme">
            Payer {formaterEuros(f.resteAPayerCents)} par carte
          </button>
        </form>
      ) : null}
      {qr && f.iban ? (
        <section className="flex flex-col items-center gap-3 rounded-2xl border border-trait bg-white p-4">
          <h2 className="self-start text-lg font-bold">Payer par virement</h2>
          <QrVirement contenu={qr} />
          <p className="text-sm">Scannez ce QR code avec l’application de votre banque : le montant et la référence sont préremplis.</p>
          <dl className="w-full text-sm">
            <div><dt className="inline font-semibold">IBAN : </dt><dd className="inline break-all">{formaterIban(f.iban)}</dd></div>
            {f.bic ? <div><dt className="inline font-semibold">BIC : </dt><dd className="inline">{f.bic}</dd></div> : null}
            <div><dt className="inline font-semibold">Bénéficiaire : </dt><dd className="inline">{f.entreprise}</dd></div>
            <div><dt className="inline font-semibold">Référence : </dt><dd className="inline">{reference}</dd></div>
          </dl>
        </section>
      ) : null}
    </main>
  );
}
