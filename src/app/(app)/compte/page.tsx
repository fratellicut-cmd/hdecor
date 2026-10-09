import type { Metadata } from 'next';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { Carte } from '@/components/ui/Carte';
import { BoutonDeconnexion } from '@/components/auth/BoutonDeconnexion';
import { FormulaireMotDePasse } from '@/components/auth/FormulaireMotDePasse';
import { GestionTotp } from '@/components/auth/GestionTotp';

export const metadata: Metadata = { title: 'Mon compte' };

export default async function PageCompte() {
  const session = await verifierSession();
  const supabase = await clientServeur();
  const { data } = await supabase.auth.mfa.listFactors();
  const actif = data?.totp.find((f) => f.status === 'verified') ?? null;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Mon compte</h1>
      <p className="text-encre-douce">Connecté : {session.email}</p>
      <Carte titre="Mot de passe"><FormulaireMotDePasse /></Carte>
      <Carte titre="Double authentification"><GestionTotp facteurActifId={actif?.id ?? null} /></Carte>
      <BoutonDeconnexion />
    </div>
  );
}
