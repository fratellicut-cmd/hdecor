import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Paiement', robots: { index: false, follow: false } };

/**
 * Retour de la page de paiement Stripe. Sans jeton dans l'adresse : l'adresse
 * de retour est stockée chez Stripe, le lien de la facture n'y figure pas.
 */
export default async function PageRetourPaiement({ searchParams }: PageProps<'/f/retour'>) {
  const { paiement } = await searchParams;
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      {paiement === 'en_cours' ? (
        <>
          <h1 className="text-2xl font-bold">Paiement transmis</h1>
          <p>Merci : votre paiement par carte a été transmis. Il apparaîtra sur votre facture dès sa confirmation (quelques instants). Vous pouvez fermer cette page.</p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">Paiement annulé</h1>
          <p>Aucun paiement n’a été fait. Pour payer, rouvrez le lien de la facture reçu de l’entreprise.</p>
        </>
      )}
    </main>
  );
}
