import type { Metadata } from 'next';
import { devisParJeton } from '@/lib/devis-public';
import { jetonBienForme } from '@/lib/liens';
import { formaterDate, formaterEuros } from '@/domain/formats';
import { signerEnLigne } from './actions';
import { FormulaireSignature, NoticeSignature } from '@/components/devis/Signature';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Votre devis', robots: { index: false, follow: false } };

const bouton = 'inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-anthracite bg-white px-4 font-semibold';

export default async function PageDevisPublic({ params, searchParams }: PageProps<'/d/[jeton]'>) {
  const { jeton } = await params;
  const sp = await searchParams;
  const d = jetonBienForme(jeton) ? await devisParJeton(jeton) : null;
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      {!d ? (
        <>
          <h1 className="text-2xl font-bold">Lien invalide ou expiré</h1>
          <p>Ce lien n’est plus valable (déjà utilisé, expiré ou désactivé). Demandez un nouveau lien à l’entreprise.</p>
        </>
      ) : (
        <>
          <p className="font-semibold text-encre-douce">{d.entreprise}</p>
          <h1 className="text-2xl font-bold">{d.titre}</h1>
          {d.statut === 'accepte' ? <Message type="succes">{sp.signe === '1' ? 'Devis signé. Merci ! ' : 'Devis signé. '}Vous pouvez télécharger votre exemplaire.</Message> : null}
          {d.statut === 'refuse' ? <Message type="info">Ce devis a été marqué refusé.</Message> : null}
          {d.statut === 'remplace' ? <Message type="info">Ce devis a été remplacé par une nouvelle version : demandez le nouveau lien.</Message> : null}
          <p>
            Montant : <strong>{formaterEuros(d.totalTtcCents)}{d.regime === 'franchise' ? '' : ' TTC'}</strong>
            {d.options.length ? ' (hors options)' : ''}
            {d.statut === 'envoye' ? <> · valable jusqu’au {formaterDate(d.valideJusquAu)}</> : null}
          </p>
          <a href={`/d/${jeton}/pdf`} target="_blank" rel="noopener noreferrer" className={bouton}>Télécharger le devis (PDF)</a>
          {d.pdfSigneChemin ? <a href={`/d/${jeton}/pdf?signe=1`} target="_blank" rel="noopener noreferrer" className={bouton}>Télécharger le devis signé</a> : null}
          {d.peutSigner ? (
            <section className="flex flex-col gap-3 rounded-2xl border border-trait bg-white p-4">
              <h2 className="text-lg font-bold">Signer le devis</h2>
              {d.retractation ? <p className="text-sm">Le devis indique vos droits de rétractation et contient le formulaire à utiliser.</p> : null}
              <FormulaireSignature action={signerEnLigne} champs={{ jeton }} documentSha256={d.pdfSha256} nomParDefaut=""
                options={d.options.map((o) => ({ id: o.id, designation: o.designation, montant: `${formaterEuros(o.totalHtCents)} HT` }))} />
              <NoticeSignature entreprise={d.entreprise} />
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
