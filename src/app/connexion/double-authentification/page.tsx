import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { clientServeur } from '@/lib/supabase/serveur';
import { cheminInterneSur } from '@/lib/redirection';
import { Marque } from '@/components/Marque';
import { FormulaireCodeTotp } from '@/components/auth/FormulaireCodeTotp';

export const metadata: Metadata = { title: 'Double authentification' };

export default async function PageDoubleAuthentification({ searchParams }: PageProps<'/connexion/double-authentification'>) {
  const p = await searchParams;
  const suite = cheminInterneSur(typeof p.suite === 'string' ? p.suite : undefined);
  const supabase = await clientServeur();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect('/connexion');
  const { data } = await supabase.auth.mfa.listFactors();
  const facteur = data?.totp.find((f) => f.status === 'verified');
  if (!facteur) redirect(suite);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Marque grande />
      <h1 className="text-2xl font-bold">Code de vérification</h1>
      <p>Ouvrez votre application d’authentification et saisissez le code à 6 chiffres.</p>
      <FormulaireCodeTotp facteurId={facteur.id} suite={suite} />
    </main>
  );
}
