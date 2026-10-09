import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { chargerAchats, chargerRecettes } from '@/lib/comptabilite';
import { classeurXlsx, date, montant, texte, type Cellule } from '@/lib/xlsx';
import { pdfComptabilite } from '@/lib/pdf/comptabilite';
import { fichierCsv } from '@/domain/csv';
import { libelleMois, lignesCsv, tableauAchats, tableauRecettes, type Tableau, type Valeur } from '@/domain/comptabilite';

const PERIODE = z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/);
const FORMAT = z.enum(['recettes.csv', 'achats.csv', 'xlsx', 'pdf']);

const cellule = (v: Valeur): Cellule => (v.t === 'texte' ? texte(v.v) : v.t === 'montant' ? montant(v.cents) : date(v.iso));
const feuille = (nom: string, t: Tableau) => ({
  nom, entetes: t.entetes, lignes: [...t.lignes, ...(t.total ? [t.total] : [])].map((l) => l.map(cellule)),
  largeurs: t.entetes.map((e) => Math.max(12, Math.min(40, e.length + 4))),
});

const NOTE_HT = 'Part HT des encaissements : au prorata HT / TTC de chaque facture (À VÉRIFIER avec le comptable).';

/**
 * Exports comptables d'un mois (AAAA-MM) ou d'une année (AAAA) : livre des
 * recettes et registre des achats en CSV (Excel en français), classeur Excel
 * (deux feuilles) ou récapitulatif PDF. Session obligatoire ; lecture sous RLS.
 */
export async function GET(req: NextRequest) {
  const session = await verifierSession();
  const periode = PERIODE.safeParse(req.nextUrl.searchParams.get('periode'));
  const format = FORMAT.safeParse(req.nextUrl.searchParams.get('format'));
  if (!periode.success || !format.success) return new Response('Export introuvable.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const sb = await clientServeur();
  const { data: p, error } = await sb.from('parametres_entreprise').select('raison_sociale, regime_tva').eq('organisation_id', session.organisationId).single();
  if (error || !p) return new Response('Paramètres illisibles : réessayez.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const libelle = periode.data.length === 4 ? `année ${periode.data}` : libelleMois(periode.data);
  const [recettes, achats] = await Promise.all([
    format.data === 'achats.csv' ? [] : chargerRecettes(periode.data),
    format.data === 'recettes.csv' ? [] : chargerAchats(periode.data),
  ]);
  const tRecettes = tableauRecettes(recettes, p.regime_tva, libelle);
  const tAchats = tableauAchats(achats, libelle);
  const nom = `hdecor-${periode.data}`;
  const reponse = (corps: BodyInit, type: string, fichier: string) => new Response(corps, {
    headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${fichier}"`, 'Cache-Control': 'private, no-store' },
  });

  switch (format.data) {
    case 'recettes.csv':
      return reponse(fichierCsv(tRecettes.entetes, lignesCsv(tRecettes)), 'text/csv; charset=utf-8', `${nom}-livre-des-recettes.csv`);
    case 'achats.csv':
      return reponse(fichierCsv(tAchats.entetes, lignesCsv(tAchats)), 'text/csv; charset=utf-8', `${nom}-registre-des-achats.csv`);
    case 'xlsx':
      return reponse(Buffer.from(classeurXlsx([feuille('Livre des recettes', tRecettes), feuille('Registre des achats', tAchats)])),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${nom}-comptabilite.xlsx`);
    case 'pdf': {
      const notes = [
        'Livre des recettes : encaissements de la période (date du paiement), remboursements en négatif.',
        ...(p.regime_tva === 'franchise' ? ['TVA non applicable (franchise en base) : les achats sont comptés TTC.'] : [NOTE_HT]),
      ];
      const pdf = await pdfComptabilite({ entreprise: p.raison_sociale ?? '', periode: libelle, edition: new Date(), notes }, [tRecettes, tAchats]);
      return reponse(Buffer.from(pdf), 'application/pdf', `${nom}-comptabilite.pdf`);
    }
  }
}
