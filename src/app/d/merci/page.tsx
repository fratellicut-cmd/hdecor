import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Devis signé', robots: { index: false, follow: false } };

/** Signature enregistrée mais lien de consultation non créé : l'entreprise envoie l'exemplaire signé. */
export default function PageMerci() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-bold">Devis signé. Merci !</h1>
      <p>Votre signature est enregistrée. L’entreprise vous transmettra votre exemplaire signé.</p>
    </main>
  );
}
