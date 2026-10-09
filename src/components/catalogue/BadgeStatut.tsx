import { BadgeAVerifier } from '@/components/ui/Champ';

/** Statut de vérification d'une donnée du catalogue : jamais présentée comme sûre sans source. */
export function BadgeStatut({ statut }: { statut: string }) {
  if (statut === 'verifie') {
    return <span className="rounded-md border border-succes bg-succes-fond px-2 py-0.5 text-sm font-bold text-succes">Vérifié</span>;
  }
  if (statut === 'fictif') {
    return <span className="rounded-md border border-danger bg-danger-fond px-2 py-0.5 text-sm font-bold text-danger">EXEMPLE FICTIF</span>;
  }
  return <BadgeAVerifier />;
}
