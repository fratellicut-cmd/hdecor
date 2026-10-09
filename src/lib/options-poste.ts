import 'server-only';
import { libelleElement, type ChantierCalcule } from '@/lib/chantiers';
import { quantiteVersSaisie } from '@/domain/saisie';

const UNITES: Record<string, string> = { ml: 'm', m2: 'm²', u: 'u' };

/** Listes de choix du formulaire de poste, tirées du chantier calculé. */
export function optionsPoste(c: ChantierCalcule) {
  return {
    pieces: c.pieces.map((p) => ({
      id: p.id, nom: p.nom,
      elements: p.elements.map((el) => ({ id: el.id, libelle: `${libelleElement(el.type)} (${quantiteVersSaisie(el.quantite_e4)} ${UNITES[el.unite]})` })),
    })),
    produits: c.produits.map((p) => ({ id: p.id, libelle: [p.marque, p.gamme, p.designation].filter(Boolean).join(' '), aVerifier: p.statut_verification !== 'verifie' })),
    teintes: c.teintes.map((t) => ({ id: t.id, nom: t.nom })),
    etapes: c.etapes.map((e) => ({ id: e.id, libelle: e.libelle, aVerifier: e.statut_verification !== 'verifie' })),
    margeParDefautBp: c.parametres.marge_perte_bp,
  };
}
