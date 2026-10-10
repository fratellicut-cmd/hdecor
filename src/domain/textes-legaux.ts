/**
 * Textes légaux imprimés sur les documents, modifiables dans les Paramètres.
 * Les textes par défaut sont ceux de l'application, À VÉRIFIER par le
 * comptable : ils ne sont pas présentés comme exacts. Un texte personnalisé
 * remplace le texte par défaut ; les repères entre accolades sont remplacés à
 * l'impression et doivent rester présents.
 */

export const CODES_TEXTES = ['retractation', 'execution_anticipee', 'devis_recu', 'mediateur', 'rappel_reception', 'autoliquidation'] as const;
export type CodeTexte = (typeof CODES_TEXTES)[number];
export type TextesLegaux = Partial<Record<CodeTexte, string>>;

export const LONGUEUR_TEXTE_MAX = 3000;
/** Textes courts : ils tiennent dans un cadre (« Bon pour accord ») ou sous les totaux. */
const LONGUEUR_COURTE: Partial<Record<CodeTexte, number>> = { devis_recu: 300, autoliquidation: 300 };

type Definition = { libelle: string; ou: string; defaut: string; reperes: readonly string[] };

export const TEXTES: Record<CodeTexte, Definition> = {
  retractation: {
    libelle: 'Droit de rétractation',
    ou: 'Devis signé hors établissement par un particulier',
    defaut: 'Contrat conclu hors établissement : vous disposez d’un délai de quatorze (14) jours à compter de la signature du présent devis '
      + 'pour exercer votre droit de rétractation, sans avoir à justifier de motif ni à payer de pénalité. '
      + 'Pour l’exercer, adressez avant l’expiration de ce délai le formulaire ci-joint, ou toute autre déclaration dénuée d’ambiguïté, à : {contact}.',
    reperes: ['{contact}'],
  },
  execution_anticipee: {
    libelle: 'Début des travaux pendant le délai de rétractation',
    ou: 'Devis signé hors établissement par un particulier',
    defaut: 'Si vous souhaitez que les travaux commencent avant la fin du délai de rétractation, vous devez en faire la demande expresse '
      + 'par écrit. Si vous vous rétractez ensuite, vous devrez payer la part des travaux réalisée jusqu’à la communication de votre décision.',
    reperes: [],
  },
  devis_recu: {
    libelle: 'Mention « devis reçu »',
    ou: 'Cadre « Bon pour accord » du devis',
    defaut: 'Devis reçu avant l’exécution des travaux.',
    reperes: [],
  },
  mediateur: {
    libelle: 'Médiateur de la consommation',
    ou: 'Devis (si un médiateur est renseigné)',
    defaut: 'Médiateur de la consommation : {mediateur}. En cas de litige, le client consommateur peut le saisir gratuitement '
      + 'après une réclamation écrite restée sans réponse satisfaisante.',
    reperes: ['{mediateur}'],
  },
  rappel_reception: {
    libelle: 'Rappel sur la réception des travaux',
    ou: 'Procès-verbal de réception',
    defaut: 'La réception est l’acte par lequel le maître de l’ouvrage déclare accepter l’ouvrage avec ou sans réserves '
      + '(article 1792-6 du Code civil). Elle marque le point de départ des garanties légales dues par l’entreprise, '
      + 'le cas échéant selon la nature des travaux (notamment la garantie de parfait achèvement). [Références À VÉRIFIER]',
    reperes: [],
  },
  autoliquidation: {
    libelle: 'Mention d’autoliquidation',
    ou: 'Facture de sous-traitance (régime assujetti)',
    defaut: 'Autoliquidation : TVA due par le preneur (sous-traitance dans le secteur du bâtiment).',
    reperes: [],
  },
};

/**
 * Textes en vigueur (personnalisés, sinon par défaut), repères non remplacés :
 * copiés tels quels dans le document émis, ils ne dépendent plus des textes par
 * défaut d'une version future de l'application.
 */
export function textesEffectifs(personnalises: TextesLegaux | null | undefined): Record<CodeTexte, string> {
  return Object.fromEntries(CODES_TEXTES.map((c) => [c, personnalises?.[c]?.trim() || TEXTES[c].defaut])) as Record<CodeTexte, string>;
}

/** Texte à imprimer : personnalisé s'il existe, sinon par défaut ; repères remplacés. */
export function texteLegal(code: CodeTexte, textes: TextesLegaux | null | undefined, valeurs: Record<string, string> = {}): string {
  const brut = textes?.[code]?.trim() || TEXTES[code].defaut;
  return brut.replace(/\{(contact|mediateur)\}/g, (m, cle: string) => valeurs[cle] ?? m);
}

/**
 * Lecture d'une saisie (Paramètres). Texte vide ou identique au texte par
 * défaut : non enregistré (le texte par défaut s'applique et suivra ses
 * corrections). Repères obligatoires conservés.
 */
export function lireTexte(code: CodeTexte, saisie: string): { texte: string | null } | { erreur: string } {
  const t = saisie.replace(/\r\n?/g, '\n').trim();
  if (!t || t === TEXTES[code].defaut) return { texte: null };
  const max = LONGUEUR_COURTE[code] ?? LONGUEUR_TEXTE_MAX;
  if (t.length > max) return { erreur: `${max} caractères au maximum.` };
  if (/[\u0001-\u0009\u000b-\u001f\u007f]/.test(t)) return { erreur: 'Caractère non autorisé.' };
  const manquants = TEXTES[code].reperes.filter((r) => !t.includes(r));
  if (manquants.length) return { erreur: `Gardez ${manquants.join(' et ')} : remplacé à l’impression.` };
  return { texte: t };
}

/** Textes encore à faire valider : tous, tant que le comptable ne les a pas validés. */
export const textesAValider = (validesLe: string | null) => (validesLe ? [] : CODES_TEXTES.map((c) => TEXTES[c].libelle));
