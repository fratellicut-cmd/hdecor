'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';

const PREFIXE = 'hdecor:saisie:';
/**
 * Durée de vie d'un brouillon sur le téléphone (données de clients) : 24 h.
 * Au-delà il est effacé, à l'ouverture de n'importe quelle page de
 * l'application (voir NettoyageBrouillons). Documenté dans le registre RGPD.
 */
export const DUREE_BROUILLON_MS = 24 * 3600 * 1000;

type Brouillon = { enregistre_le: number; version?: string | null; valeurs: Record<string, string> };

function lire(cle: string): Brouillon | null {
  try {
    const brut = window.localStorage.getItem(PREFIXE + cle);
    if (!brut) return null;
    const b = JSON.parse(brut) as Brouillon;
    if (typeof b?.enregistre_le !== 'number' || Date.now() - b.enregistre_le > DUREE_BROUILLON_MS) {
      window.localStorage.removeItem(PREFIXE + cle);
      return null;
    }
    return b;
  } catch {
    return null;
  }
}

/** Efface un brouillon (après un enregistrement réussi ou un effacement de client). */
export function effacerBrouillon(cle: string) {
  try { window.localStorage.removeItem(PREFIXE + cle); } catch { /* stockage indisponible : rien à effacer */ }
}

/** Efface tous les brouillons de cet appareil (déconnexion volontaire). */
export function effacerTousLesBrouillons() {
  try {
    for (const k of Object.keys(window.localStorage)) if (k.startsWith(PREFIXE)) window.localStorage.removeItem(k);
  } catch { /* stockage indisponible */ }
}

/** Efface les brouillons expirés, quel que soit le formulaire qui les a créés. */
export function nettoyerBrouillonsExpires() {
  try {
    for (const k of Object.keys(window.localStorage)) if (k.startsWith(PREFIXE)) lire(k.slice(PREFIXE.length));
  } catch { /* stockage indisponible */ }
}

type Champ = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const NON_GARDES = ['hidden', 'submit', 'button', 'password', 'file', 'reset', 'image'];

function champsGardes(form: HTMLFormElement): Champ[] {
  return Array.from(form.elements).filter(
    (e): e is Champ => (e instanceof HTMLInputElement && !NON_GARDES.includes(e.type))
      || e instanceof HTMLTextAreaElement || e instanceof HTMLSelectElement,
  ).filter((e) => e.name !== '' && !e.name.startsWith('$'));
}

const estCoche = (e: Champ): e is HTMLInputElement => e instanceof HTMLInputElement && (e.type === 'checkbox' || e.type === 'radio');
// Clé d'une case : son nom ET sa valeur (plusieurs cases « confirmes »).
const cleCase = (e: HTMLInputElement) => `☐${e.name}=${e.value}`;

function lireFormulaire(form: HTMLFormElement): Record<string, string> {
  const valeurs: Record<string, string> = {};
  for (const champ of champsGardes(form)) {
    if (estCoche(champ)) {
      if (champ.type === 'checkbox') valeurs[cleCase(champ)] = champ.checked ? '1' : '0';
      else if (champ.checked) valeurs[champ.name] = champ.value;
    } else valeurs[champ.name] = champ.value;
  }
  return valeurs;
}

/** Remet un brouillon dans le formulaire. Renvoie vrai si quelque chose a changé. */
function restaurer(form: HTMLFormElement, valeurs: Record<string, string>): boolean {
  let change = false;
  // Boutons radio d'abord, par un vrai clic : l'état React qui en dépend
  // (champs affichés ou masqués) suit.
  for (const champ of champsGardes(form)) {
    if (champ instanceof HTMLInputElement && champ.type === 'radio' && valeurs[champ.name] === champ.value && !champ.checked) {
      champ.click();
      change = true;
    }
  }
  for (const champ of champsGardes(form)) {
    if (champ instanceof HTMLInputElement && champ.type === 'radio') continue;
    if (champ instanceof HTMLInputElement && champ.type === 'checkbox') {
      const v = valeurs[cleCase(champ)];
      if (v !== undefined && (v === '1') !== champ.checked) { champ.checked = v === '1'; change = true; }
      continue;
    }
    const v = valeurs[champ.name];
    if (v !== undefined && v !== champ.value) { champ.value = v; change = true; }
  }
  return change;
}

export type Garde = {
  /** Un brouillon a été remis dans le formulaire. */
  recupere: boolean;
  /** Un brouillon existe mais la fiche a été modifiée depuis : rien n'est remis d'office. */
  conflit: { enregistre_le: number } | null;
  /** Envoi bloqué : téléphone hors connexion. */
  horsLigne: boolean;
  surEnvoi: (e: FormEvent<HTMLFormElement>) => void;
  /** Reprendre le brouillon malgré le conflit. */
  reprendre: () => void;
  /** Abandonner le brouillon et revenir aux valeurs enregistrées. */
  annuler: () => void;
};

/**
 * Garde de saisie (pas de mode hors-ligne, décision du directeur) :
 *  - chaque frappe est copiée sur le téléphone : coupure, rechargement ou
 *    onglet fermé par le système ne font rien perdre ;
 *  - à l'ouverture, un brouillon est remis en place, sauf si la fiche a changé
 *    depuis (« version ») : le conflit est alors signalé et l'utilisateur choisit ;
 *  - l'envoi est bloqué tant que le téléphone se sait hors connexion.
 * Le brouillon est effacé après enregistrement, à la déconnexion et après 24 h.
 */
export function useGardeSaisie(cle: string, formRef: RefObject<HTMLFormElement | null>, version?: string | null): Garde {
  const [recupere, setRecupere] = useState(false);
  const [conflit, setConflit] = useState<Brouillon | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const restaure = useRef(false);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    if (!restaure.current) {
      restaure.current = true;
      const b = lire(cle);
      if (b) {
        // Le formulaire est rendu par le serveur : la restauration (lecture du
        // stockage du téléphone) ne peut se faire qu'après son montage.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (version !== undefined && (b.version ?? null) !== (version ?? null)) setConflit(b);
        else if (restaurer(form, b.valeurs)) setRecupere(true);
      }
    }
    const sauver = () => {
      try {
        window.localStorage.setItem(PREFIXE + cle, JSON.stringify({
          enregistre_le: Date.now(), version: version ?? null, valeurs: lireFormulaire(form),
        } satisfies Brouillon));
      } catch { /* stockage plein ou interdit : la saisie reste dans la page */ }
    };
    const reseau = () => { if (navigator.onLine) setHorsLigne(false); };
    form.addEventListener('input', sauver);
    form.addEventListener('change', sauver);
    window.addEventListener('online', reseau);
    return () => {
      form.removeEventListener('input', sauver);
      form.removeEventListener('change', sauver);
      window.removeEventListener('online', reseau);
    };
  }, [cle, formRef, version]);

  const surEnvoi = useCallback((e: FormEvent<HTMLFormElement>) => {
    if (!navigator.onLine) {
      e.preventDefault();
      setHorsLigne(true);
    } else setHorsLigne(false);
  }, []);

  const reprendre = useCallback(() => {
    if (conflit && formRef.current) restaurer(formRef.current, conflit.valeurs);
    setConflit(null);
    setRecupere(true);
  }, [conflit, formRef]);

  const annuler = useCallback(() => {
    effacerBrouillon(cle);
    window.location.reload();
  }, [cle]);

  return { recupere, conflit: conflit ? { enregistre_le: conflit.enregistre_le } : null, horsLigne, surEnvoi, reprendre, annuler };
}
