import 'server-only';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import type { Ligne } from '@/lib/supabase/types';
import { centiemes } from '@/domain/chiffrage';
import { lireDecimal } from '@/domain/saisie';
import {
  calculerPoste, listeAchat, type Consommable, type EtapeCalc, type ParametresCalcul, type PosteCalc, type ProduitCalc,
  type ResultatPoste, type ListeAchat, type Finition, cleTeinte,
} from '@/domain/calculateur';
import { calculerSurfacesPiece, ErreurMetre, surfaceElementMm2, type SurfacesPiece } from '@/domain/metre';
import type { Support, TypeProduit } from '@/domain/systemes';

/** Erreur de lecture : la page affiche son écran d'erreur (« Réessayer »). */
function verifier<T>(r: { data: T | null; error: unknown }, quoi: string): T {
  if (r.error || r.data === null) throw new Error(`Lecture impossible : ${quoi}.`);
  return r.data;
}

export type PieceComplete = Ligne<'pieces'> & {
  ouvertures: Ligne<'ouvertures'>[];
  elements: Ligne<'elements'>[];
  surfaces: SurfacesPiece | null;
  erreur: string | null;
};

export function surfacesDe(piece: Ligne<'pieces'>, ouvertures: Ligne<'ouvertures'>[]): { surfaces: SurfacesPiece | null; erreur: string | null } {
  try {
    return {
      surfaces: calculerSurfacesPiece({
        modeSaisie: piece.mode_saisie as 'rectangle' | 'murs', longueurMm: piece.longueur_mm, largeurMm: piece.largeur_mm,
        mursMm: piece.murs_mm, surfaceSolMm2: piece.surface_sol_mm2, hauteurMm: piece.hauteur_mm, multiplicateur: piece.multiplicateur,
      }, ouvertures.map((o) => ({
        type: o.type as 'porte', largeurMm: o.largeur_mm, hauteurMm: o.hauteur_mm, surfaceDirecteMm2: o.surface_directe_mm2, quantite: o.quantite,
      }))),
      erreur: null,
    };
  } catch (e) {
    if (e instanceof ErreurMetre) return { surfaces: null, erreur: e.message };
    throw e;
  }
}

/** Chantier, client et pièces (avec surfaces) : la RLS limite à l'organisation. */
export async function chargerChantier(id: string) {
  await verifierSession();
  const supabase = await clientServeur();
  const { data: chantier, error } = await supabase.from('v_chantiers').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('Lecture impossible : chantier.');
  if (!chantier) return null;
  const [client, pieces, ouvertures, elements] = await Promise.all([
    supabase.from('clients').select('id, type, civilite, nom, prenom, raison_sociale, anonymise_le, telephone').eq('id', chantier.client_id!).maybeSingle(),
    supabase.from('pieces').select('*').eq('chantier_id', id).order('ordre').order('created_at'),
    supabase.from('ouvertures').select('*, pieces!inner(chantier_id)').eq('pieces.chantier_id', id),
    supabase.from('elements').select('*, pieces!inner(chantier_id)').eq('pieces.chantier_id', id),
  ]);
  const lesOuvertures = verifier(ouvertures, 'ouvertures');
  const lesElements = verifier(elements, 'éléments');
  const piecesCompletes: PieceComplete[] = verifier(pieces, 'pièces').map((p) => {
    const o = lesOuvertures.filter((x) => x.piece_id === p.id);
    return { ...p, ouvertures: o, elements: lesElements.filter((x) => x.piece_id === p.id), ...surfacesDe(p, o) };
  });
  return { chantier, client: client.data, pieces: piecesCompletes };
}

export type ChantierCalcule = NonNullable<Awaited<ReturnType<typeof calculerChantier>>>;

/** Chantier complet + calcul de chaque poste + liste d'achat. */
export async function calculerChantier(id: string) {
  const session = await verifierSession();
  const base = await chargerChantier(id);
  if (!base) return null;
  const supabase = await clientServeur();
  const idsPieces = base.pieces.map((p) => p.id);
  const lesPostes = verifier(await supabase.from('postes_travaux').select('*').in('piece_id', idsPieces)
    .order('ordre').order('created_at'), 'postes');
  const [prepas, produits, conditionnements, teintes, referentiel, coefficients, etapes, consommables, parametres] = await Promise.all([
    supabase.from('postes_preparations').select('*').in('poste_id', lesPostes.map((x) => x.id)),
    // Produits actifs, et produits archivés encore utilisés par un poste (signalés).
    supabase.from('produits').select('*').order('marque').order('designation'),
    supabase.from('conditionnements').select('*').eq('actif', true),
    supabase.from('teintes').select('id, nom, marque, code_ral, code_ncs, code_fabricant, statut_verification, actif').order('nom'),
    supabase.from('referentiel_calcul').select('*'),
    supabase.from('coefficients_support').select('*'),
    supabase.from('etapes_preparation').select('*').eq('actif', true).order('ordre'),
    supabase.from('consommables').select('*').eq('actif', true).order('libelle'),
    supabase.from('parametres_entreprise').select('marge_perte_bp, coef_marge_bp, taux_horaire_cents, formats_pots_ml, formats_sacs_g, hauteur_alerte_mm, minutes_par_jour, tolerance_reste_bp, porte_largeur_mm, porte_hauteur_mm')
      .eq('organisation_id', session.organisationId).single(),
  ]);
  const p = verifier(parametres, 'paramètres');
  const tousProduits = verifier(produits, 'produits');
  const utilises = new Set([...lesPostes.map((x) => x.produit_id), ...verifier(etapes, 'étapes de préparation').map((e) => e.produit_id)]);
  const lesProduits = tousProduits.filter((pr) => pr.actif || utilises.has(pr.id));
  const lesConditionnements = verifier(conditionnements, 'conditionnements');
  const lesTeintes = verifier(teintes, 'teintes');
  const lesEtapes = verifier(etapes, 'étapes de préparation');

  const produitCalc = (pr: Ligne<'produits'>): ProduitCalc => ({
    id: pr.id,
    libelle: [pr.marque, pr.gamme, pr.designation].filter(Boolean).join(' '),
    reference: pr.reference_fabricant,
    type: pr.type as TypeProduit,
    unite: pr.unite_mesure as 'L' | 'kg',
    rendementCentiemes: centiemes(pr.rendement_m2_par_unite),
    couchesRecommandees: pr.couches_recommandees,
    sechageDixiemesH: dixiemes(pr.sechage_recouvrable_h),
    usages: pr.usages,
    finition: pr.finition as Finition | null,
    aVerifier: pr.statut_verification !== 'verifie',
    archive: !pr.actif,
    // Formats archivés exclus : on ne propose pas d'acheter un pot qui n'existe plus.
    formats: lesConditionnements.filter((c) => c.produit_id === pr.id && c.actif)
      .map((c) => ({ contenanceMl: c.contenance, prixCents: c.prix_achat_ht_cents === null ? null : BigInt(c.prix_achat_ht_cents), id: c.id })),
  });
  const produitsCalc = new Map(lesProduits.map((pr) => [pr.id, produitCalc(pr)]));

  const etapesCalc: EtapeCalc[] = lesEtapes.map((e) => ({
    id: e.id, code: e.code, libelle: e.libelle,
    minutesParM2Centiemes: centiemes(e.minutes_par_m2) ?? 0,
    produit: e.produit_id ? produitsCalc.get(e.produit_id) ?? null : null,
    consommationE4: e.consommation_par_m2 === null ? null : Number(lireDecimal(String(e.consommation_par_m2), 4) ?? 0n),
    typeProduit: e.type_produit as TypeProduit | null,
    couches: e.couches,
    avecMatiere: e.avec_matiere,
    aVerifier: e.statut_verification !== 'verifie',
  }));

  const parametresCalc: ParametresCalcul = {
    margePerteBp: p.marge_perte_bp,
    coefMargeBp: p.coef_marge_bp,
    tauxHoraireCents: p.taux_horaire_cents === null ? null : BigInt(p.taux_horaire_cents),
    formatsDefautMl: p.formats_pots_ml,
    formatsDefautG: p.formats_sacs_g,
    hauteurAlerteMm: p.hauteur_alerte_mm,
    toleranceResteBp: p.tolerance_reste_bp,
    formatsParType: Object.fromEntries(verifier(referentiel, 'référentiel').filter((r) => r.formats_ml?.length).map((r) => [r.type_produit, r.formats_ml!])),
    coefSupport: Object.fromEntries(verifier(coefficients, 'coefficients').map((c) => [c.support, { bp: c.coef_rendement_bp, aVerifier: c.statut_verification !== 'verifie' }])),
    referentiel: Object.fromEntries(verifier(referentiel, 'référentiel').map((r) => [r.type_produit, {
      rendementMinCentiemes: centiemes(r.rendement_min),
      minutesParM2CoucheCentiemes: centiemes(r.minutes_par_m2_couche),
      sechageDixiemesH: dixiemes(r.sechage_recouvrable_h),
      aVerifier: r.statut_verification !== 'verifie',
    }])),
  };

  const lesPrepas = verifier(prepas, 'préparations');
  const calcules = lesPostes.map((poste) => {
    const piece = base.pieces.find((x) => x.id === poste.piece_id)!;
    const mult = BigInt(piece.multiplicateur);
    let surface: PosteCalc['surface'];
    let cibleLibelle: string;
    let typeElement: string | null = null;
    if (!piece.surfaces) { surface = { manque: piece.erreur ?? 'Pièce incomplète.' }; cibleLibelle = poste.cible; }
    else if (poste.cible === 'murs') { surface = { mm2: piece.surfaces.totalMursMm2 }; cibleLibelle = 'murs'; }
    else if (poste.cible === 'plafond') {
      surface = piece.surfaces.totalPlafondMm2 === null ? { manque: 'Plafond non calculable : saisissez la surface au sol.' } : { mm2: piece.surfaces.totalPlafondMm2 };
      cibleLibelle = 'plafond';
    } else {
      const el = piece.elements.find((e) => e.id === poste.element_id);
      const s = el ? surfaceElementMm2({
        type: el.type, unite: el.unite as 'ml', quantiteE4: el.quantite_e4, faces: el.faces,
        developpeMm: el.developpe_mm, surfaceUnitaireMm2: el.surface_unitaire_mm2,
      }) : { manque: 'Élément introuvable.' };
      surface = 'mm2' in s ? { mm2: s.mm2 * mult } : s;
      cibleLibelle = el ? libelleElement(el.type) : 'élément';
      typeElement = el?.type ?? null;
    }
    const posteCalc: PosteCalc = {
      id: poste.id,
      libelle: `${piece.nom}${piece.multiplicateur > 1 ? ` (× ${piece.multiplicateur})` : ''} : ${cibleLibelle}`,
      surface, cible: poste.cible as PosteCalc['cible'], typeElement, support: poste.support as Support,
      cleSurface: `${poste.piece_id}|${poste.cible}|${poste.element_id ?? ''}`, hauteurMm: piece.hauteur_mm,
      zoneHumide: poste.zone_humide, taches: poste.taches, exterieur: poste.exterieur,
      etapes: etapesCalc.filter((e) => lesPrepas.some((x) => x.poste_id === poste.id && x.etape_id === e.id)),
      produit: poste.produit_id ? produitsCalc.get(poste.produit_id) ?? null : null,
      typeProduit: poste.type_produit as TypeProduit | null,
      teinte: poste.teinte_id ? { id: poste.teinte_id, nom: lesTeintes.find((t) => t.id === poste.teinte_id)?.nom ?? 'Teinte' }
        // Saisie libre : « Blanc », « blanc », « RAL 9010 » et « RAL9010 » désignent la même teinte.
        : poste.teinte_libre ? { id: `libre:${cleTeinte(poste.teinte_libre)}`, nom: poste.teinte_libre.trim().replace(/\s+/g, ' ') } : null,
      finition: poste.finition as Finition | null,
      couches: poste.couches,
      rendementForceCentiemes: centiemes(poste.rendement_force),
      margePerteBp: poste.marge_perte_bp,
      majorationTempsBp: poste.majoration_temps_bp,
    };
    return { poste: posteCalc, ligne: poste, resultat: calculerPoste(posteCalc, parametresCalc) };
  });

  const consommablesCalc: Consommable[] = verifier(consommables, 'consommables').map((k) => ({
    id: k.id, libelle: k.libelle, mode: k.mode as Consommable['mode'], prixCents: BigInt(k.prix_ht_cents), aVerifier: k.statut_verification !== 'verifie',
  }));
  const liste: ListeAchat = listeAchat(calcules, consommablesCalc, parametresCalc);

  return {
    ...base, postes: calcules, liste, parametres: p, produits: lesProduits, teintes: lesTeintes, etapes: lesEtapes,
  } satisfies Record<string, unknown> & { postes: { poste: PosteCalc; resultat: ResultatPoste }[] };
}

/** numeric(5,1) en heures -> dixièmes d'heure entiers (6,5 h -> 65), lu sans calcul flottant. */
function dixiemes(v: number | null): number | null {
  if (v === null) return null;
  const d = lireDecimal(String(v), 1);
  if (d === null) throw new Error(`Durée invalide : ${v}`);
  return Number(d);
}

const LIBELLES_ELEMENT: Record<string, string> = {
  plinthe: 'plinthes', corniche: 'corniches', porte: 'portes', fenetre: 'fenêtres', radiateur: 'radiateurs',
  volet: 'volets', escalier: 'escalier', rambarde: 'rambarde', facade: 'façade', autre: 'autre élément',
};
export const libelleElement = (t: string) => LIBELLES_ELEMENT[t] ?? t;
