import { describe, expect, it } from 'vitest';
import { adresseListe, motifContient, nombreAffiche, texteCherche } from '../listes';

describe('recherche dans les listes', () => {
  it('texte nettoyé : aucun caractère de syntaxe du filtre ne passe', () => {
    expect(texteCherche('  Durand  ')).toBe('Durand');
    expect(texteCherche('DEV-2026-0012')).toBe('DEV-2026-0012');
    expect(texteCherche('a),numero.eq.(x*%"')).toBe('a numero eq x');
    expect(texteCherche('Élodie Brûlé')).toBe('Élodie Brûlé');
    expect(texteCherche('x')).toBeNull();
    expect(texteCherche(undefined)).toBeNull();
    expect(texteCherche(['a', 'b'])).toBeNull();
    expect(texteCherche('a'.repeat(100))!.length).toBe(60);
  });
  it('motif « contient » : espaces remplacés par le joker', () => expect(motifContient('rue des lilas')).toBe('*rue*des*lilas*'));
  it('nombre affiché : multiple de 100, entre 100 et 1000', () => {
    expect(nombreAffiche(undefined)).toBe(100);
    expect(nombreAffiche('200')).toBe(200);
    expect(nombreAffiche('150')).toBe(200);
    expect(nombreAffiche('99999')).toBe(100);
    expect(nombreAffiche('5000')).toBe(1000);
    expect(nombreAffiche('-1')).toBe(100);
  });
  it('adresse de liste : paramètres vides omis', () => {
    expect(adresseListe('/devis', { filtre: 'tous', q: 'Durand', nombre: 200 })).toBe('/devis?filtre=tous&q=Durand&nombre=200');
    expect(adresseListe('/devis', { filtre: null, q: '' })).toBe('/devis');
  });
});
