import type { Metadata } from 'next';
import Link from 'next/link';
import { lireParametres } from '@/lib/parametres';
import { emailConfigure } from '@/lib/email';
import { choisirNotificationsEmail } from '../../notifications/actions';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { Carte } from '@/components/ui/Carte';

export const metadata: Metadata = { title: 'Notifications' };

export default async function PageReglageNotifications() {
  const p = await lireParametres();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/parametres" className="inline-flex min-h-12 items-center underline underline-offset-4">← Paramètres</Link>
      <h1 className="text-2xl font-bold">Notifications</h1>
      <Carte titre="Par email">
        <p>{p.notifier_par_email ? `Activées : un récapitulatif est envoyé à ${p.email ?? '(adresse de l’entreprise à renseigner)'}.` : 'Désactivées : les notifications restent dans l’application (cloche en haut de l’écran).'}</p>
        <p className="mt-2 text-sm text-encre-douce">
          Contenu : devis ouverts ou signés à distance, paiements en ligne, rappels arrivés à échéance. Envoi par la tâche planifiée
          (une fois par jour sur l’hébergement de base) : ce n’est pas une alerte immédiate.
        </p>
        {!emailConfigure() ? <p className="mt-2 text-sm font-semibold">L’envoi d’emails n’est pas configuré sur ce serveur.</p> : null}
        <div className="mt-3">
          <ActionConfirmee action={choisirNotificationsEmail} champs={{ actif: p.notifier_par_email ? 'non' : 'oui' }}
            libelle={p.notifier_par_email ? 'Désactiver les emails' : 'Activer les emails'} variante="secondaire" />
        </div>
      </Carte>
    </div>
  );
}
