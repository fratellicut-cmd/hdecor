import type { Metadata } from 'next';
import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { lireParametres } from '@/lib/parametres';
import { clientServeur } from '@/lib/supabase/serveur';
import { aujourdHuiParis } from '@/domain/dates';
import { assuranceEnCours } from '@/domain/devis-document';
import { pointsAvantFacture } from '@/domain/premiere-facture';
import { EnTeteSection } from '@/components/parametres/EnTeteSection';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Avant la première facture' };

export default async function PagePremiereFacture() {
  const session = await verifierSession();
  const p = await lireParametres();
  const sb = await clientServeur();
  const [assurances, taux, exemples, aVerifier, calcul] = await Promise.all([
    sb.from('assurances').select('type, assureur, numero_contrat, debut, fin, zone_couverte'),
    sb.from('taux_tva').select('taux_bp', { count: 'exact', head: true }).eq('a_verifier', true).eq('actif', true),
    sb.from('produits').select('id', { count: 'exact', head: true }).eq('statut_verification', 'fictif').eq('actif', true),
    sb.from('produits').select('id', { count: 'exact', head: true }).eq('statut_verification', 'a_verifier').eq('actif', true),
    sb.from('referentiel_calcul').select('type_produit', { count: 'exact', head: true }).neq('statut_verification', 'verifie'),
  ]);
  const erreur = [assurances, taux, exemples, aVerifier, calcul].some((r) => r.error);
  const jour = aujourdHuiParis();
  const enCours = (type: string) => (assurances.data ?? []).some((a) => a.type === type && assuranceEnCours({ ...a, type: a.type as 'decennale' | 'rc_pro' }, jour));
  const points = pointsAvantFacture({
    regime: p.regime_tva, siret: !!p.siret, adresse: !!p.adresse_ligne1 && !!p.code_postal && !!p.ville, iban: !!p.iban,
    immatriculation: !!p.immatriculation, numeroTvaIntra: !!p.numero_tva_intra, tauxPenalites: p.taux_penalites_bp !== null,
    valeursAVerifier: p.valeurs_a_verifier.length, mentionFranchiseAVerifier: p.regime_tva === 'franchise' && p.mention_franchise_a_verifier,
    seuilsConfirmes: !!p.seuils_confirmes_le, decennale: enCours('decennale'), rcPro: enCours('rc_pro'), mediateur: !!p.mediateur_nom,
    textesValides: !!p.textes_legaux_valides_le, tauxTvaAVerifier: taux.count ?? 0, produitsExempleActifs: exemples.count ?? 0,
    produitsAVerifierActifs: aVerifier.count ?? 0, reglagesCalculAVerifier: calcul.count ?? 0, logo: !!p.logo_chemin,
    doubleAuthentification: session.niveauAuth === 'aal2',
  });
  const restants = points.filter((x) => !x.fait).length;
  return (
    <>
      <EnTeteSection titre="Avant la première vraie facture" />
      <div className="flex flex-col gap-4">
        <p className="text-encre-douce">
          À passer en revue avec votre comptable avant de facturer un vrai client. Les autres questions (mentions, TVA, rétractation, conservation)
          figurent dans la check-list remise avec l’application.
        </p>
        {erreur ? <Message type="erreur">Certains points n’ont pas pu être lus : rechargez la page.</Message> : null}
        <p className={`text-lg font-bold ${restants ? 'text-alerte' : ''}`}>{restants ? `${restants} point${restants > 1 ? 's' : ''} à régler sur ${points.length}` : `Les ${points.length} points sont réglés.`}</p>
        <ul className="flex flex-col gap-2">
          {points.map((x) => (
            <li key={x.code}>
              <Link href={x.lien} className={`flex min-h-16 flex-col justify-center rounded-xl border-2 bg-white px-4 py-2 ${x.fait ? 'border-trait' : 'border-alerte'}`}>
                <span className="font-semibold">{x.fait ? '✓' : '○'} {x.titre}</span>
                {x.fait ? null : <span className="text-sm text-encre-douce">{x.aide}</span>}
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-sm text-encre-douce">
          Restent à faire ensemble, hors application : relire ligne par ligne un devis et une facture de test, tester la restauration d’une
          sauvegarde, signer un devis et un PV sur votre propre téléphone.
        </p>
      </div>
    </>
  );
}
