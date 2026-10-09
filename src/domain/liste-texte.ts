import type { ListeAchat } from './calculateur';
import { formaterEuros } from './formats';
import { formaterContenance, formaterQuantite } from './peinture';

/** Texte de la liste d'achat pour un message (fournisseur, collègue) : sans donnée client. */
export function texteListeAchat(titre: string, liste: ListeAchat): string {
  const lignes = [`Liste d’achat : ${titre}`, ''];
  for (const l of liste.lignes) {
    const pots = l.pots?.retenue.pots.map((p) => `${p.nombre} × ${formaterContenance(p.contenanceMl, l.unite)}`).join(' + ');
    lignes.push(`• ${l.libelle}${l.reference ? ` (réf. ${l.reference})` : ''}${l.teinte ? `, teinte ${l.teinte}` : ''}`);
    lignes.push(`  ${formaterQuantite(l.quantite.dixMilliemes)} ${l.unite} -> ${pots ?? l.probleme ?? 'pots à déterminer'}`);
  }
  if (liste.consommables.length) {
    lignes.push('', 'Consommables :');
    for (const k of liste.consommables) lignes.push(`• ${k.libelle}`);
  }
  lignes.push('', 'Rendements indicatifs : se référer à la fiche technique du fabricant et au support réel.');
  return lignes.join('\n');
}

/** Total affichable (matière) : « 84,79 € » ou « 84,79 € (partiel : prix manquants) ». */
export function totalMatiere(liste: ListeAchat): string {
  return `${formaterEuros(liste.coutMatiereCents)}${liste.coutComplet ? '' : ' (partiel : prix manquants)'}`;
}
