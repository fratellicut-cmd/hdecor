'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { viderFileSuppression } from '@/lib/stockage-admin';
import { erreursParChamp, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import { schemaClient } from '@/lib/validation/clients';

const ECHEC = 'L’enregistrement a échoué. Vérifiez la connexion et réessayez.';
const identifiant = z.uuid();

function lireChamps(formData: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) if (!k.startsWith('$')) o[k] = v;
  return o;
}

/** Création (sans « id ») ou modification (avec « id ») d'une fiche client. */
export async function enregistrerClient(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaClient.safeParse(lireChamps(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };

  const supabase = await clientServeur();
  const idSaisi = formData.get('id');
  let id: string;
  if (idSaisi) {
    const idLu = identifiant.safeParse(idSaisi);
    if (!idLu.success) return { message: 'Fiche introuvable.' };
    // La RLS limite la mise à jour à l'organisation ; une fiche anonymisée
    // n'est plus modifiable.
    const { data, error } = await supabase.from('clients').update(lu.data)
      .eq('id', idLu.data).is('anonymise_le', null).select('id').maybeSingle();
    if (error) return { message: ECHEC, valeurs: valeursTexte(formData) };
    if (!data) return { message: 'Fiche introuvable ou anonymisée : modification impossible.' };
    id = data.id;
  } else {
    const { data, error } = await supabase.from('clients')
      .insert({ ...lu.data, organisation_id: session.organisationId }).select('id').single();
    if (error) return { message: ECHEC, valeurs: valeursTexte(formData) };
    id = data.id;
  }
  revalidatePath('/clients');
  redirect(`/clients/${id}?enregistre=1`);
}

/** Interblocage : PostgreSQL annule l'une des transactions, on la rejoue. */
const INTERBLOCAGE = '40P01';
const ESSAIS = 3;

/**
 * Effacement RGPD (anonymisation) d'un client. Les fichiers nominatifs sont
 * mis en file dans la même transaction, puis supprimés du stockage ; ce qui
 * échoue est repris par la tâche planifiée.
 */
export async function effacerClient(formData: FormData) {
  const session = await verifierSession();
  const id = identifiant.safeParse(formData.get('id'));
  if (!id.success) redirect('/clients');
  if (formData.get('confirmation') !== 'on') redirect(`/clients/${id.data}?effacement=non-confirme`);

  const supabase = await clientServeur();
  let erreur: { code?: string } | null = null;
  for (let essai = 1; essai <= ESSAIS; essai += 1) {
    ({ error: erreur } = await supabase.rpc('effacer_client', { p_client_id: id.data }));
    if (erreur?.code !== INTERBLOCAGE) break;
    await new Promise((r) => setTimeout(r, 100 * essai));
  }
  if (erreur) redirect(`/clients/${id.data}?effacement=echec`);

  let fichiersEnAttente = false;
  try {
    const bilan = await viderFileSuppression({ organisationId: session.organisationId });
    fichiersEnAttente = bilan.enEchec > 0;
  } catch {
    fichiersEnAttente = true;
  }
  revalidatePath('/clients');
  redirect(`/clients/${id.data}?effacement=${fichiersEnAttente ? 'fichiers-en-attente' : 'ok'}`);
}
