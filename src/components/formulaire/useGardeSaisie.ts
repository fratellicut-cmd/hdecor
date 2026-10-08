'use client';

import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';

const PREFIXE = 'hdecor:saisie:';
/** Un brouillon plus vieux que cette durée est ignoré puis effacé. */
const DUREE_MS = 7 * 24 * 3600 * 1000;

type Brouillon = { enregistre_le: number; valeurs: Record<string, string> };

function lire(cle: string): Brouillon | null {
  try {
    const brut = window.localStorage.getItem(PREFIXE + cle);
    if (!brut) return null;
    const b = JSON.parse(brut) as Brouillon;
    if (typeof b?.enregistre_le !== 'number' || Date.now() - b.enregistre_le > DUREE_MS) {
      window.localStorage.removeItem(PREFIXE + cle);
      return null;
    }
    return b;
  } catch {
    return null;
  }
}

/** Efface un brouillon (après un enregistrement réussi). */
export function effacerBrouillon(cle: string) {
  try { window.localStorage.removeItem(PREFIXE + cle); } catch { /* stockage indisponible : rien à effacer */ }
}

/** Efface tous les brouillons de cet appareil (déconnexion). */
export function effacerTousLesBrouillons() {
  try {
    for (const k of Object.keys(window.localStorage)) if (k.startsWith(PREFIXE)) window.localStorage.removeItem(k);
  } catch { /* stockage indisponible */ }
}

function champsTexte(form: HTMLFormElement) {
  return Array.from(form.elements).filter(
    (e): e is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
      (e instanceof HTMLInputElement && !['hidden', 'submit', 'button', 'password', 'checkbox', 'radio', 'file'].includes(e.type))
      || e instanceof HTMLTextAreaElement || e instanceof HTMLSelectElement,
  ).filter((e) => e.name && !e.name.startsWith('$'));
}

function boutonsRadio(form: HTMLFormElement) {
  return Array.from(form.elements).filter(
    (e): e is HTMLInputElement => e instanceof HTMLInputElement && e.type === 'radio' && e.name !== '',
  );
}

/**
 * Garde de saisie (pas de mode hors-ligne, décision du directeur) :
 *  - chaque frappe est copiée sur le téléphone : une coupure réseau, un
 *    rechargement ou un onglet fermé par le système ne fait rien perdre ;
 *  - à l'ouverture du formulaire, un brouillon existant est remis en place ;
 *  - l'envoi est bloqué tant que le téléphone est hors connexion, avec un
 *    message clair (rien n'est perdu).
 * Le brouillon est effacé après un enregistrement réussi et à la déconnexion.
 */
export function useGardeSaisie(cle: string, formRef: RefObject<HTMLFormElement | null>) {
  const [recupere, setRecupere] = useState(false);
  const [horsLigne, setHorsLigne] = useState(false);
  const restaure = useRef(false);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    if (!restaure.current) {
      restaure.current = true;
      const b = lire(cle);
      if (b) {
        let change = false;
        // Boutons radio d'abord, par un vrai clic : l'état React qui en dépend
        // (champs affichés ou masqués) suit.
        for (const radio of boutonsRadio(form)) {
          if (b.valeurs[radio.name] === radio.value && !radio.checked) { radio.click(); change = true; }
        }
        for (const champ of champsTexte(form)) {
          const v = b.valeurs[champ.name];
          if (v !== undefined && v !== champ.value) { champ.value = v; change = true; }
        }
        // Le formulaire est affiché par le serveur : la restauration ne peut se
        // faire qu'après son montage (lecture du stockage du téléphone).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (change) setRecupere(true);
      }
    }
    const sauver = () => {
      const valeurs: Record<string, string> = {};
      for (const champ of champsTexte(form)) valeurs[champ.name] = champ.value;
      for (const radio of boutonsRadio(form)) if (radio.checked) valeurs[radio.name] = radio.value;
      try {
        window.localStorage.setItem(PREFIXE + cle, JSON.stringify({ enregistre_le: Date.now(), valeurs } satisfies Brouillon));
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
  }, [cle, formRef]);

  /** À brancher sur onSubmit : bloque l'envoi hors connexion. */
  const surEnvoi = (e: FormEvent<HTMLFormElement>) => {
    if (!navigator.onLine) {
      e.preventDefault();
      setHorsLigne(true);
    }
  };

  return { recupere, horsLigne, surEnvoi };
}
