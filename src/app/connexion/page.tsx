import type { Metadata } from 'next';
import { Marque } from '@/components/Marque';
import { FormulaireConnexion } from '@/components/auth/FormulaireConnexion';
import { Message } from '@/components/ui/Message';
import { cheminInterneSur } from '@/lib/redirection';

export const metadata: Metadata = { title: 'Connexion' };

const ERREURS: Record<string, string> = {
  lien: 'Ce lien n’est plus valable (déjà utilisé ou expiré). Demandez-en un nouveau.',
  'sans-organisation': 'Ce compte n’est rattaché à aucune entreprise. Contactez l’administrateur.',
};

export default async function PageConnexion({ searchParams }: PageProps<'/connexion'>) {
  const p = await searchParams;
  const suite = cheminInterneSur(typeof p.suite === 'string' ? p.suite : undefined);
  const erreur = typeof p.erreur === 'string' ? ERREURS[p.erreur] : undefined;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 py-10">
      <Marque grande />
      <h1 className="text-2xl font-bold">Connexion</h1>
      {erreur ? <Message type="erreur">{erreur}</Message> : null}
      <FormulaireConnexion suite={suite} />
      <p className="text-center text-sm text-encre-douce">
        <a href="/confidentialite" className="underline underline-offset-4">Confidentialité et données personnelles</a>
      </p>
    </main>
  );
}
