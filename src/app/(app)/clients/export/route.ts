import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { fichierCsv } from '@/domain/clients';
import { aujourdHuiParis } from '@/domain/dates';
import { formaterDate } from '@/domain/formats';

const ENTETES = ['Type', 'Civilité', 'Nom', 'Prénom', 'Raison sociale', 'SIRET', 'TVA intracommunautaire', 'Email', 'Téléphone',
  'Adresse', 'Complément', 'Code postal', 'Ville', 'Pays', 'Connu par', 'Notes', 'Créé le'];
const PAQUET = 1000;

/** Export tableur (Excel en français) de tous les clients non anonymisés. */
export async function GET() {
  await verifierSession();
  const supabase = await clientServeur();
  const lignes: (string | null)[][] = [];
  for (let debut = 0; ; debut += PAQUET) {
    const { data, error } = await supabase.from('clients').select('*').is('anonymise_le', null)
      .order('nom').order('id').range(debut, debut + PAQUET - 1);
    if (error) return new Response('L’export a échoué. Réessayez.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    for (const c of data) {
      lignes.push([c.type === 'professionnel' ? 'Professionnel' : 'Particulier', c.civilite, c.nom, c.prenom, c.raison_sociale, c.siret,
        c.tva_intra, c.email, c.telephone, c.fact_ligne1, c.fact_ligne2, c.fact_code_postal, c.fact_ville, c.fact_pays, c.source,
        c.notes, formaterDate(c.created_at)]);
    }
    if (data.length < PAQUET) break;
  }
  return new Response(fichierCsv(ENTETES, lignes), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="clients-${aujourdHuiParis()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
