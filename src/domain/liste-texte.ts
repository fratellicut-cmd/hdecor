import type { ListeAchat } from './calculateur';
import { formaterEuros } from './formats';
import { formaterContenance, formaterQuantiteCourte } from './peinture';

/** Texte de la liste d'achat pour un message (fournisseur, collègue) : sans donnée client. */
export function texteListeAchat(titre: string, liste: ListeAchat): string {
  const lignes = [`Liste d’achat : ${titre}`, ''];
  for (const l of liste.lignes) {
    const pots = l.pots?.retenue.pots.map((p) => `${p.nombre} × ${formaterContenance(p.contenanceMl, l.unite)}`).join(' + ');
    lignes.push(`• ${l.libelle}${l.reference ? ` (réf. ${l.reference})` : ''}${l.finition ? `, finition ${l.finition}` : ''}${l.teinte ? `, teinte ${l.teinte}` : ''}`);
    lignes.push(`  ${formaterQuantiteCourte(l.quantite)} ${l.unite} -> ${pots ?? l.probleme ?? 'pots à déterminer'}`);
  }
  if (liste.nonChiffres.length) {
    lignes.push('', `ATTENTION, liste incomplète : ${liste.nonChiffres.length} poste(s) non chiffré(s) :`);
    for (const n of liste.nonChiffres) lignes.push(`• ${n.libelle} : ${n.raison}`);
  }
  if (liste.doublons.length) {
    lignes.push('', 'ATTENTION, comptés plusieurs fois :');
    for (const d of liste.doublons) lignes.push(`• ${d}`);
  }
  if (liste.consommables.length) {
    lignes.push('', 'Consommables :');
    for (const k of liste.consommables) lignes.push(`• ${k.libelle}`);
  }
  lignes.push('', 'Rendements indicatifs : se référer à la fiche technique du fabricant et au support réel.');
  return lignes.join('\n');
}

/**
 * Total affichable (matière) : « 84,79 € », « 84,79 € (partiel) », ou
 * « prix à renseigner » quand aucun prix n'est connu (jamais un faux 0,00 €).
 */
export function totalMatiere(liste: ListeAchat): string {
  if (liste.coutComplet) return formaterEuros(liste.coutMatiereCents);
  if (liste.coutMatiereCents === 0n) return 'prix à renseigner';
  return `${formaterEuros(liste.coutMatiereCents)} (partiel : prix ou postes manquants)`;
}
