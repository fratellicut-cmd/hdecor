import { describe, expect, it } from 'vitest';
import { celluleCsv, contactProfessionnel, fichierCsv, formaterTelephone, lienTelephone, nomAffiche } from '../clients';
import { texteRecherche } from '../recherche';
import { libelleStatut, libelleTypeFacture } from '../statuts';

const base = { civilite: null, prenom: null, raison_sociale: null, anonymise_le: null };

describe('nomAffiche', () => {
  it('particulier : prénom puis nom', () => {
    expect(nomAffiche({ ...base, type: 'particulier', nom: 'Müller', prenom: 'Hélène' })).toBe('Hélène Müller');
  });
  it('particulier sans prénom', () => {
    expect(nomAffiche({ ...base, type: 'particulier', nom: 'Müller' })).toBe('Müller');
  });
  it('professionnel : raison sociale', () => {
    expect(nomAffiche({ ...base, type: 'professionnel', nom: 'Petit', raison_sociale: 'SCI Les Lilas' })).toBe('SCI Les Lilas');
  });
  it('fiche anonymisée : jamais d’ancien nom', () => {
    expect(nomAffiche({ ...base, type: 'particulier', nom: 'X', anonymise_le: '2026-10-08T10:00:00Z' })).toBe('Client anonymisé');
  });
});

describe('contactProfessionnel', () => {
  it('donne la personne à joindre d’un professionnel', () => {
    expect(contactProfessionnel({ ...base, type: 'professionnel', civilite: 'M.', prenom: 'Jean', nom: 'Petit', raison_sociale: 'SCI' })).toBe('M. Jean Petit');
  });
  it('null pour un particulier', () => {
    expect(contactProfessionnel({ ...base, type: 'particulier', nom: 'Petit' })).toBeNull();
  });
});

describe('lienTelephone', () => {
  it.each([
    ['06 12 34 56 78', 'tel:0612345678'],
    ['+33 6 12.34.56.78', 'tel:+33612345678'],
  ])('%s -> %s', (t, l) => expect(lienTelephone(t)).toBe(l));
});

describe('export CSV', () => {
  it('cellule simple inchangée, vide pour null', () => {
    expect(celluleCsv('Thionville')).toBe('Thionville');
    expect(celluleCsv(null)).toBe('');
  });
  it('point-virgule, guillemets et retours à la ligne protégés', () => {
    expect(celluleCsv('a;b')).toBe('"a;b"');
    expect(celluleCsv('dit "bonjour"')).toBe('"dit ""bonjour"""');
    expect(celluleCsv('ligne 1\nligne 2')).toBe('"ligne 1\nligne 2"');
  });
  it.each(['=1+1', '+SOMME(A1)', '-2+3', '@commande', '\tx'])('injection de formule neutralisée : %s', (v) => {
    expect(celluleCsv(v).replace(/^"/, '')).toMatch(/^'/);
  });
  it('un téléphone international reste lisible', () => {
    expect(celluleCsv('+33 6 12 34 56 78')).toBe('+33 6 12 34 56 78');
  });
  it('fichier : BOM UTF-8, séparateur « ; », fins de ligne CRLF', () => {
    const f = fichierCsv(['Nom', 'Ville'], [['Hélène', 'Metz'], ['A;B', null]]);
    expect(f).toBe('\uFEFFNom;Ville\r\nHélène;Metz\r\n"A;B";\r\n');
  });
});

describe('libellés de statut', () => {
  it('traduit les statuts connus', () => {
    expect(libelleStatut('partiellement_payee')).toBe('Partiellement payée');
    expect(libelleStatut('a_planifier')).toBe('À planifier');
  });
  it('affiche tel quel un statut inconnu (pas de libellé inventé)', () => {
    expect(libelleStatut('nouveau_statut')).toBe('nouveau_statut');
    expect(libelleStatut(null)).toBe('—');
  });
  it('type de facture', () => {
    expect(libelleTypeFacture('avoir')).toBe('Avoir');
    expect(libelleTypeFacture('acompte')).toBe('Acompte');
  });
});

describe('formaterTelephone', () => {
  it.each([
    ['0612345678', '06 12 34 56 78'],
    ['06.12.34.56.78', '06 12 34 56 78'],
    ['+33612345678', '+33 6 12 34 56 78'],
    ['+33 6 12 34 56 78', '+33 6 12 34 56 78'],
    ['+352 621 123 456', '+352 621 123 456'],
    ['12', '12'],
  ])('%s -> %s', (t, attendu) => expect(formaterTelephone(t)).toBe(attendu));
});

describe('texteRecherche (comparaison des doublons)', () => {
  it('ignore casse, accents et ligatures', () => {
    expect(texteRecherche(' Lætitia ')).toBe('laetitia');
    expect(texteRecherche('HÉLÈNE')).toBe(texteRecherche('helene'));
    expect(texteRecherche('Œuvray')).toBe('oeuvray');
  });
});
