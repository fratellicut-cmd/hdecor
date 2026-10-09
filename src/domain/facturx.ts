/**
 * Données de facturation électronique (Factur-X / ZUGFeRD, syntaxe CII,
 * norme EN 16931) : XML produit à l'émission et téléchargeable.
 *
 * PRÉPARÉ, À VÉRIFIER : profil retenu, codes d'exonération (franchise en base,
 * autoliquidation), plateforme agréée et calendrier sont à confirmer avec le
 * comptable (cadrage, point 8). Le XML n'est PAS encore intégré au PDF
 * (PDF/A-3) et n'a pas été validé par un outil officiel.
 */

import type { Ventilation, Regime } from './devis';
import { nomAvecForme, type CopieClient, type CopieEmetteur } from './devis-document';
import { totalLigneFacture, type Deduction, type LigneFacture, type TypeFacture } from './factures';

export type DonneesFacturX = {
  numero: string;
  type: TypeFacture;
  dateEmission: string;
  dateEcheance: string;
  datePrestation: string | null;
  emetteur: CopieEmetteur & { paiement: { iban: string | null; bic: string | null } };
  client: CopieClient;
  lignes: LigneFacture[];
  ventilation: Ventilation;
  regime: Regime;
  autoliquidation: boolean;
  remiseGlobaleCents: bigint;
  totalHtCents: bigint;
  totalTvaCents: bigint;
  totalTtcCents: bigint;
  deductions: Deduction[];
  netAPayerCents: bigint;
  /** Avoir : numéro de la facture corrigée. */
  factureOrigine: string | null;
};

export const PROFIL_FACTURX = 'urn:cen.eu:en16931:2017';

/** Codes UN/ECE des unités (recommandation 20). */
const UNITES: Record<string, string> = { m2: 'MTK', ml: 'MTR', u: 'C62', h: 'HUR', forfait: 'C62', L: 'LTR', kg: 'KGM' };

const echapper = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const montant = (c: bigint) => `${c < 0n ? '-' : ''}${(c < 0n ? -c : c) / 100n}.${((c < 0n ? -c : c) % 100n).toString().padStart(2, '0')}`;
const quantite = (q: bigint) => `${q / 10_000n}.${(q % 10_000n).toString().padStart(4, '0')}`;
const date102 = (iso: string) => `<udt:DateTimeString format="102">${iso.replace(/-/g, '')}</udt:DateTimeString>`;
const taux = (bp: number) => `${Math.trunc(bp / 100)}.${String(bp % 100).padStart(2, '0')}`;

/** Catégorie de TVA EN 16931 : S (taux normal ou réduit), E (exonération : franchise), AE (autoliquidation). */
function categorie(regime: Regime, autoliquidation: boolean, tauxBp: number): string {
  if (autoliquidation) return 'AE';
  if (regime === 'franchise' || tauxBp === 0) return 'E';
  return 'S';
}

/** 380 facture, 381 avoir, 386 facture d'acompte. */
const typeDocument = (t: TypeFacture) => (t === 'avoir' ? '381' : t === 'acompte' ? '386' : '380');

function adresse(a: { ligne1: string | null; ligne2: string | null; code_postal: string | null; ville: string | null }) {
  return `<ram:PostalTradeAddress>${a.code_postal ? `<ram:PostcodeCode>${echapper(a.code_postal)}</ram:PostcodeCode>` : ''}`
    + `${a.ligne1 ? `<ram:LineOne>${echapper(a.ligne1)}</ram:LineOne>` : ''}${a.ligne2 ? `<ram:LineTwo>${echapper(a.ligne2)}</ram:LineTwo>` : ''}`
    + `${a.ville ? `<ram:CityName>${echapper(a.ville)}</ram:CityName>` : ''}<ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>`;
}

export function xmlFacturX(d: DonneesFacturX): string {
  const cat = (t: number) => categorie(d.regime, d.autoliquidation, t);
  // Ordre du schéma CII : ExemptionReason avant BasisAmount, ExemptionReasonCode après CategoryCode.
  const motifExoneration = (t: number) => {
    if (d.autoliquidation) return '<ram:ExemptionReason>Autoliquidation</ram:ExemptionReason>';
    if (cat(t) === 'E' && d.emetteur.mention_franchise) return `<ram:ExemptionReason>${echapper(d.emetteur.mention_franchise)}</ram:ExemptionReason>`;
    return '';
  };
  const codeExoneration = () => (d.autoliquidation ? '<ram:ExemptionReasonCode>VATEX-EU-AE</ram:ExemptionReasonCode>' : '');
  const lignes = d.lignes.filter((l) => l.type === 'ligne').map((l, i) => {
    const total = totalLigneFacture(l.quantiteE4!, l.prixUnitaireCents!, l.remiseBp, l.avancementBp);
    return `<ram:IncludedSupplyChainTradeLineItem>`
      + `<ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>`
      + `<ram:SpecifiedTradeProduct><ram:Name>${echapper(l.designation)}</ram:Name>${l.description ? `<ram:Description>${echapper(l.description)}</ram:Description>` : ''}</ram:SpecifiedTradeProduct>`
      + `<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${montant(l.prixUnitaireCents!)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>`
      + `<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${UNITES[l.unite ?? 'u'] ?? 'C62'}">${quantite(l.quantiteE4!)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>`
      + `<ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${cat(l.tauxTvaBp ?? 0)}</ram:CategoryCode>`
      + `<ram:RateApplicablePercent>${taux(d.autoliquidation || d.regime === 'franchise' ? 0 : l.tauxTvaBp ?? 0)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`
      + `<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${montant(total)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>`
      + `</ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>`;
  }).join('');
  const sommeLignes = d.lignes.filter((l) => l.type === 'ligne')
    .reduce((a, l) => a + totalLigneFacture(l.quantiteE4!, l.prixUnitaireCents!, l.remiseBp, l.avancementBp), 0n);
  const taxes = d.ventilation.map((v) => `<ram:ApplicableTradeTax><ram:CalculatedAmount>${montant(v.tva_cents)}</ram:CalculatedAmount>`
    + `<ram:TypeCode>VAT</ram:TypeCode>${motifExoneration(v.taux_bp)}<ram:BasisAmount>${montant(v.base_ht_cents)}</ram:BasisAmount>`
    + `<ram:CategoryCode>${cat(v.taux_bp)}</ram:CategoryCode>${codeExoneration()}<ram:RateApplicablePercent>${taux(d.autoliquidation || d.regime === 'franchise' ? 0 : v.taux_bp)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`).join('');
  const prepaye = d.deductions.reduce((a, x) => a + x.ttc, 0n);
  const e = d.emetteur;
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">`
    + `<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${PROFIL_FACTURX}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>`
    + `<rsm:ExchangedDocument><ram:ID>${echapper(d.numero)}</ram:ID><ram:TypeCode>${typeDocument(d.type)}</ram:TypeCode><ram:IssueDateTime>${date102(d.dateEmission)}</ram:IssueDateTime></rsm:ExchangedDocument>`
    + `<rsm:SupplyChainTradeTransaction>${lignes}`
    + `<ram:ApplicableHeaderTradeAgreement>`
    + `<ram:SellerTradeParty><ram:Name>${echapper(nomAvecForme(e))}</ram:Name>`
    + `${e.siret ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${echapper(e.siret.slice(0, 9))}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}`
    + adresse(e.adresse)
    + `${e.numero_tva_intra ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${echapper(e.numero_tva_intra)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}`
    + `</ram:SellerTradeParty>`
    + `<ram:BuyerTradeParty><ram:Name>${echapper(d.client.nom_affiche)}</ram:Name>`
    + `${d.client.siret ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${echapper(d.client.siret.slice(0, 9))}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}`
    + adresse(d.client.adresse)
    + `${d.client.tva_intra ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${echapper(d.client.tva_intra)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}`
    + `</ram:BuyerTradeParty></ram:ApplicableHeaderTradeAgreement>`
    + `<ram:ApplicableHeaderTradeDelivery>${d.datePrestation ? `<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime>${date102(d.datePrestation)}</ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>` : ''}</ram:ApplicableHeaderTradeDelivery>`
    + `<ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>`
    + `${e.paiement.iban && d.type !== 'avoir' ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${echapper(e.paiement.iban.replace(/\s+/g, ''))}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>` : ''}`
    + taxes
    + `${d.remiseGlobaleCents > 0n ? d.ventilation.map((v) => `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator><ram:ActualAmount>${montant(remiseDuTaux(d, v.taux_bp))}</ram:ActualAmount><ram:Reason>Remise</ram:Reason><ram:CategoryTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${cat(v.taux_bp)}</ram:CategoryCode><ram:RateApplicablePercent>${taux(d.autoliquidation || d.regime === 'franchise' ? 0 : v.taux_bp)}</ram:RateApplicablePercent></ram:CategoryTradeTax></ram:SpecifiedTradeAllowanceCharge>`).join('') : ''}`
    + `<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime>${date102(d.dateEcheance)}</ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>`
    + `<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>${montant(sommeLignes)}</ram:LineTotalAmount>`
    + `${d.remiseGlobaleCents > 0n ? `<ram:AllowanceTotalAmount>${montant(d.remiseGlobaleCents)}</ram:AllowanceTotalAmount>` : ''}`
    + `<ram:TaxBasisTotalAmount>${montant(d.totalHtCents)}</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">${montant(d.totalTvaCents)}</ram:TaxTotalAmount>`
    + `<ram:GrandTotalAmount>${montant(d.totalTtcCents)}</ram:GrandTotalAmount>${prepaye > 0n ? `<ram:TotalPrepaidAmount>${montant(prepaye)}</ram:TotalPrepaidAmount>` : ''}`
    + `<ram:DuePayableAmount>${montant(d.netAPayerCents)}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>`
    + `${d.factureOrigine ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${echapper(d.factureOrigine)}</ram:IssuerAssignedID></ram:InvoiceReferencedDocument>` : ''}`
    + `</ram:ApplicableHeaderTradeSettlement></rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>`;
}

/** Remise globale du taux = somme des lignes du taux − base HT du taux (répartition R5). */
function remiseDuTaux(d: DonneesFacturX, tauxBp: number): bigint {
  const somme = d.lignes.filter((l) => l.type === 'ligne' && l.tauxTvaBp === tauxBp)
    .reduce((a, l) => a + totalLigneFacture(l.quantiteE4!, l.prixUnitaireCents!, l.remiseBp, l.avancementBp), 0n);
  return somme - d.ventilation.find((v) => v.taux_bp === tauxBp)!.base_ht_cents;
}
