import type { EtatFormulaire } from '@/lib/etat-formulaire';
import { Message } from '@/components/ui/Message';

export function RetourFormulaire({ etat }: { etat: EtatFormulaire }) {
  if (etat.message) return <Message type="erreur">{etat.message}</Message>;
  if (etat.erreurs && Object.keys(etat.erreurs).length) return <Message type="erreur">Corrigez les champs signalés.</Message>;
  if (etat.succes) return <Message type="succes">{etat.succes}</Message>;
  return null;
}
