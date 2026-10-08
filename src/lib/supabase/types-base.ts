
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "assurances": {
                  Row: {
                    "assureur": string,"attestation_chemin": string | null,"created_at": string,"debut": string,"fin": string | null,"id": string,"numero_contrat": string,"organisation_id": string,"type": string,"zone_couverte": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assureur": string,"attestation_chemin"?: string | null,"created_at"?: string,"debut": string,"fin"?: string | null,"id"?: string,"numero_contrat": string,"organisation_id": string,"type": string,"zone_couverte": string
                  }
                  Update: {
                    "assureur"?: string,"attestation_chemin"?: string | null,"created_at"?: string,"debut"?: string,"fin"?: string | null,"id"?: string,"numero_contrat"?: string,"organisation_id"?: string,"type"?: string,"zone_couverte"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assurances_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"attestations_tva": {
                  Row: {
                    "created_at": string,"devis_id": string,"id": string,"organisation_id": string,"pdf_chemin": string | null,"signature_id": string | null,"taux_bp": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"devis_id": string,"id"?: string,"organisation_id": string,"pdf_chemin"?: string | null,"signature_id"?: string | null,"taux_bp": number
                  }
                  Update: {
                    "created_at"?: string,"devis_id"?: string,"id"?: string,"organisation_id"?: string,"pdf_chemin"?: string | null,"signature_id"?: string | null,"taux_bp"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "attestations_tva_organisation_id_devis_id_fkey"
      columns: ["organisation_id","devis_id"]
isOneToOne: false
      referencedRelation: "devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "attestations_tva_organisation_id_devis_id_fkey"
      columns: ["organisation_id","devis_id"]
isOneToOne: false
      referencedRelation: "v_devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "attestations_tva_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attestations_tva_organisation_id_signature_id_fkey"
      columns: ["organisation_id","signature_id"]
isOneToOne: false
      referencedRelation: "signatures"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "attestations_tva_organisation_id_taux_bp_fkey"
      columns: ["organisation_id","taux_bp"]
isOneToOne: false
      referencedRelation: "taux_tva"
      referencedColumns: ["organisation_id","taux_bp"]
    }
                  ]
                },"categories_depenses": {
                  Row: {
                    "id": string,"libelle": string,"organisation_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"libelle": string,"organisation_id": string
                  }
                  Update: {
                    "id"?: string,"libelle"?: string,"organisation_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_depenses_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"chantiers": {
                  Row: {
                    "adresse_ligne1": string | null,"adresse_ligne2": string | null,"client_id": string,"code_postal": string | null,"created_at": string,"date_debut_prevue": string | null,"duree_estimee_jours": number | null,"id": string,"nom": string,"notes": string | null,"organisation_id": string,"statut": Database["public"]['Enums']["statut_chantier"],"teinte_id": string | null,"updated_at": string,"ville": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "adresse_ligne1"?: string | null,"adresse_ligne2"?: string | null,"client_id": string,"code_postal"?: string | null,"created_at"?: string,"date_debut_prevue"?: string | null,"duree_estimee_jours"?: number | null,"id"?: string,"nom": string,"notes"?: string | null,"organisation_id": string,"statut"?: Database["public"]['Enums']["statut_chantier"],"teinte_id"?: string | null,"updated_at"?: string,"ville"?: string | null
                  }
                  Update: {
                    "adresse_ligne1"?: string | null,"adresse_ligne2"?: string | null,"client_id"?: string,"code_postal"?: string | null,"created_at"?: string,"date_debut_prevue"?: string | null,"duree_estimee_jours"?: number | null,"id"?: string,"nom"?: string,"notes"?: string | null,"organisation_id"?: string,"statut"?: Database["public"]['Enums']["statut_chantier"],"teinte_id"?: string | null,"updated_at"?: string,"ville"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "chantiers_organisation_id_client_id_fkey"
      columns: ["organisation_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "chantiers_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chantiers_organisation_id_teinte_id_fkey"
      columns: ["organisation_id","teinte_id"]
isOneToOne: false
      referencedRelation: "teintes"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"checklists_fin_chantier": {
                  Row: {
                    "chantier_id": string,"items": NonNullable<Json>,"organisation_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "chantier_id": string,"items"?: NonNullable<Json>,"organisation_id": string
                  }
                  Update: {
                    "chantier_id"?: string,"items"?: NonNullable<Json>,"organisation_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checklists_fin_chantier_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: true
      referencedRelation: "chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "checklists_fin_chantier_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: true
      referencedRelation: "v_chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "checklists_fin_chantier_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "anonymise_le": string | null,"civilite": string | null,"consentement_le": string | null,"created_at": string,"email": string | null,"fact_code_postal": string | null,"fact_ligne1": string | null,"fact_ligne2": string | null,"fact_pays": string,"fact_ville": string | null,"id": string,"nom": string,"notes": string | null,"organisation_id": string,"prenom": string | null,"raison_sociale": string | null,"siret": string | null,"source": string | null,"telephone": string | null,"tva_intra": string | null,"type": Database["public"]['Enums']["type_client"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "anonymise_le"?: string | null,"civilite"?: string | null,"consentement_le"?: string | null,"created_at"?: string,"email"?: string | null,"fact_code_postal"?: string | null,"fact_ligne1"?: string | null,"fact_ligne2"?: string | null,"fact_pays"?: string,"fact_ville"?: string | null,"id"?: string,"nom": string,"notes"?: string | null,"organisation_id": string,"prenom"?: string | null,"raison_sociale"?: string | null,"siret"?: string | null,"source"?: string | null,"telephone"?: string | null,"tva_intra"?: string | null,"type"?: Database["public"]['Enums']["type_client"],"updated_at"?: string
                  }
                  Update: {
                    "anonymise_le"?: string | null,"civilite"?: string | null,"consentement_le"?: string | null,"created_at"?: string,"email"?: string | null,"fact_code_postal"?: string | null,"fact_ligne1"?: string | null,"fact_ligne2"?: string | null,"fact_pays"?: string,"fact_ville"?: string | null,"id"?: string,"nom"?: string,"notes"?: string | null,"organisation_id"?: string,"prenom"?: string | null,"raison_sociale"?: string | null,"siret"?: string | null,"source"?: string | null,"telephone"?: string | null,"tva_intra"?: string | null,"type"?: Database["public"]['Enums']["type_client"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"coefficients_support": {
                  Row: {
                    "coef_rendement_bp": number,"organisation_id": string,"statut_verification": Database["public"]['Enums']["statut_verification"],"support": string
                  }
                  ComputedFields: never
                  Insert: {
                    "coef_rendement_bp"?: number,"organisation_id": string,"statut_verification"?: Database["public"]['Enums']["statut_verification"],"support": string
                  }
                  Update: {
                    "coef_rendement_bp"?: number,"organisation_id"?: string,"statut_verification"?: Database["public"]['Enums']["statut_verification"],"support"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "coefficients_support_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"conditionnements": {
                  Row: {
                    "actif": boolean,"contenance": number,"id": string,"organisation_id": string,"prix_achat_ht_cents": number | null,"produit_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actif"?: boolean,"contenance": number,"id"?: string,"organisation_id": string,"prix_achat_ht_cents"?: number | null,"produit_id": string
                  }
                  Update: {
                    "actif"?: boolean,"contenance"?: number,"id"?: string,"organisation_id"?: string,"prix_achat_ht_cents"?: number | null,"produit_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conditionnements_organisation_id_produit_id_fkey"
      columns: ["organisation_id","produit_id"]
isOneToOne: false
      referencedRelation: "produits"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"depenses": {
                  Row: {
                    "categorie_id": string | null,"chantier_id": string | null,"created_at": string,"date_depense": string,"fournisseur": string,"id": string,"justificatif_chemin": string | null,"libelle": string | null,"mode_paiement": Database["public"]['Enums']["mode_paiement"] | null,"montant_ht_cents": number,"montant_ttc_cents": number,"organisation_id": string,"tva_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "categorie_id"?: string | null,"chantier_id"?: string | null,"created_at"?: string,"date_depense": string,"fournisseur": string,"id"?: string,"justificatif_chemin"?: string | null,"libelle"?: string | null,"mode_paiement"?: Database["public"]['Enums']["mode_paiement"] | null,"montant_ht_cents": number,"montant_ttc_cents": number,"organisation_id": string,"tva_cents"?: number
                  }
                  Update: {
                    "categorie_id"?: string | null,"chantier_id"?: string | null,"created_at"?: string,"date_depense"?: string,"fournisseur"?: string,"id"?: string,"justificatif_chemin"?: string | null,"libelle"?: string | null,"mode_paiement"?: Database["public"]['Enums']["mode_paiement"] | null,"montant_ht_cents"?: number,"montant_ttc_cents"?: number,"organisation_id"?: string,"tva_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "depenses_organisation_id_categorie_id_fkey"
      columns: ["organisation_id","categorie_id"]
isOneToOne: false
      referencedRelation: "categories_depenses"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "depenses_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "depenses_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "v_chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "depenses_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"devis": {
                  Row: {
                    "accepte_le": string | null,"acompte_pct_bp": number,"chantier_id": string | null,"client_id": string,"conditions_paiement": string | null,"consulte_le": string | null,"copie_chantier": Json | null,"copie_client": Json | null,"copie_emetteur": Json | null,"created_at": string,"date_debut_travaux": string | null,"date_emission": string | null,"delai_debut_texte": string | null,"devis_precedent_id": string | null,"duree_estimee_jours": number | null,"envoye_le": string | null,"hors_etablissement": boolean,"id": string,"motif_refus": string | null,"notes_client": string | null,"numero": string | null,"objet": string | null,"organisation_id": string,"pdf_chemin": string | null,"pdf_sha256": string | null,"refuse_le": string | null,"regime_tva": Database["public"]['Enums']["regime_tva"],"remise_globale_bp": number,"signature_id": string | null,"statut": Database["public"]['Enums']["statut_devis"],"total_accepte_ht_cents": number | null,"total_accepte_ttc_cents": number | null,"total_accepte_tva_cents": number | null,"total_ht_cents": number,"total_ttc_cents": number,"total_tva_cents": number,"updated_at": string,"validite_jours": number,"ventilation_acceptee": Json | null,"ventilation_tva": NonNullable<Json>,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "accepte_le"?: string | null,"acompte_pct_bp"?: number,"chantier_id"?: string | null,"client_id": string,"conditions_paiement"?: string | null,"consulte_le"?: string | null,"copie_chantier"?: Json | null,"copie_client"?: Json | null,"copie_emetteur"?: Json | null,"created_at"?: string,"date_debut_travaux"?: string | null,"date_emission"?: string | null,"delai_debut_texte"?: string | null,"devis_precedent_id"?: string | null,"duree_estimee_jours"?: number | null,"envoye_le"?: string | null,"hors_etablissement"?: boolean,"id"?: string,"motif_refus"?: string | null,"notes_client"?: string | null,"numero"?: string | null,"objet"?: string | null,"organisation_id": string,"pdf_chemin"?: string | null,"pdf_sha256"?: string | null,"refuse_le"?: string | null,"regime_tva": Database["public"]['Enums']["regime_tva"],"remise_globale_bp"?: number,"signature_id"?: string | null,"statut"?: Database["public"]['Enums']["statut_devis"],"total_accepte_ht_cents"?: number | null,"total_accepte_ttc_cents"?: number | null,"total_accepte_tva_cents"?: number | null,"total_ht_cents"?: number,"total_ttc_cents"?: number,"total_tva_cents"?: number,"updated_at"?: string,"validite_jours": number,"ventilation_acceptee"?: Json | null,"ventilation_tva"?: NonNullable<Json>,"version"?: number
                  }
                  Update: {
                    "accepte_le"?: string | null,"acompte_pct_bp"?: number,"chantier_id"?: string | null,"client_id"?: string,"conditions_paiement"?: string | null,"consulte_le"?: string | null,"copie_chantier"?: Json | null,"copie_client"?: Json | null,"copie_emetteur"?: Json | null,"created_at"?: string,"date_debut_travaux"?: string | null,"date_emission"?: string | null,"delai_debut_texte"?: string | null,"devis_precedent_id"?: string | null,"duree_estimee_jours"?: number | null,"envoye_le"?: string | null,"hors_etablissement"?: boolean,"id"?: string,"motif_refus"?: string | null,"notes_client"?: string | null,"numero"?: string | null,"objet"?: string | null,"organisation_id"?: string,"pdf_chemin"?: string | null,"pdf_sha256"?: string | null,"refuse_le"?: string | null,"regime_tva"?: Database["public"]['Enums']["regime_tva"],"remise_globale_bp"?: number,"signature_id"?: string | null,"statut"?: Database["public"]['Enums']["statut_devis"],"total_accepte_ht_cents"?: number | null,"total_accepte_ttc_cents"?: number | null,"total_accepte_tva_cents"?: number | null,"total_ht_cents"?: number,"total_ttc_cents"?: number,"total_tva_cents"?: number,"updated_at"?: string,"validite_jours"?: number,"ventilation_acceptee"?: Json | null,"ventilation_tva"?: NonNullable<Json>,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "devis_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "devis_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "v_chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "devis_organisation_id_client_id_fkey"
      columns: ["organisation_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "devis_organisation_id_devis_precedent_id_fkey"
      columns: ["organisation_id","devis_precedent_id"]
isOneToOne: false
      referencedRelation: "devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "devis_organisation_id_devis_precedent_id_fkey"
      columns: ["organisation_id","devis_precedent_id"]
isOneToOne: false
      referencedRelation: "v_devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "devis_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"devis_achats": {
                  Row: {
                    "conditionnement_id": string,"devis_id": string,"id": string,"nombre": number,"organisation_id": string,"prix_achat_retenu_cents": number | null,"teinte_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "conditionnement_id": string,"devis_id": string,"id"?: string,"nombre": number,"organisation_id": string,"prix_achat_retenu_cents"?: number | null,"teinte_id"?: string | null
                  }
                  Update: {
                    "conditionnement_id"?: string,"devis_id"?: string,"id"?: string,"nombre"?: number,"organisation_id"?: string,"prix_achat_retenu_cents"?: number | null,"teinte_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "devis_achats_organisation_id_conditionnement_id_fkey"
      columns: ["organisation_id","conditionnement_id"]
isOneToOne: false
      referencedRelation: "conditionnements"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "devis_achats_organisation_id_devis_id_fkey"
      columns: ["organisation_id","devis_id"]
isOneToOne: false
      referencedRelation: "devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "devis_achats_organisation_id_devis_id_fkey"
      columns: ["organisation_id","devis_id"]
isOneToOne: false
      referencedRelation: "v_devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "devis_achats_organisation_id_teinte_id_fkey"
      columns: ["organisation_id","teinte_id"]
isOneToOne: false
      referencedRelation: "teintes"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"devis_echeances": {
                  Row: {
                    "date_prevue": string | null,"declencheur": string,"devis_id": string,"id": string,"libelle": string,"ordre": number,"organisation_id": string,"pourcentage_bp": number
                  }
                  ComputedFields: never
                  Insert: {
                    "date_prevue"?: string | null,"declencheur": string,"devis_id": string,"id"?: string,"libelle": string,"ordre": number,"organisation_id": string,"pourcentage_bp": number
                  }
                  Update: {
                    "date_prevue"?: string | null,"declencheur"?: string,"devis_id"?: string,"id"?: string,"libelle"?: string,"ordre"?: number,"organisation_id"?: string,"pourcentage_bp"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "devis_echeances_organisation_id_devis_id_fkey"
      columns: ["organisation_id","devis_id"]
isOneToOne: false
      referencedRelation: "devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "devis_echeances_organisation_id_devis_id_fkey"
      columns: ["organisation_id","devis_id"]
isOneToOne: false
      referencedRelation: "v_devis"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"devis_lignes": {
                  Row: {
                    "cout_matiere_prevu_cents": number | null,"description": string | null,"designation": string,"devis_id": string,"id": string,"minutes_prevues": number | null,"optionnelle": boolean,"ordre": number,"organisation_id": string,"origine": Json | null,"prix_unitaire_ht_cents": number | null,"quantite_e4": number | null,"remise_bp": number,"taux_tva_bp": number | null,"total_ht_cents": number | null,"type": Database["public"]['Enums']["type_ligne"],"unite": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cout_matiere_prevu_cents"?: number | null,"description"?: string | null,"designation": string,"devis_id": string,"id"?: string,"minutes_prevues"?: number | null,"optionnelle"?: boolean,"ordre": number,"organisation_id": string,"origine"?: Json | null,"prix_unitaire_ht_cents"?: number | null,"quantite_e4"?: number | null,"remise_bp"?: number,"taux_tva_bp"?: number | null,"total_ht_cents"?: number | null,"type"?: Database["public"]['Enums']["type_ligne"],"unite"?: string | null
                  }
                  Update: {
                    "cout_matiere_prevu_cents"?: number | null,"description"?: string | null,"designation"?: string,"devis_id"?: string,"id"?: string,"minutes_prevues"?: number | null,"optionnelle"?: boolean,"ordre"?: number,"organisation_id"?: string,"origine"?: Json | null,"prix_unitaire_ht_cents"?: number | null,"quantite_e4"?: number | null,"remise_bp"?: number,"taux_tva_bp"?: number | null,"total_ht_cents"?: number | null,"type"?: Database["public"]['Enums']["type_ligne"],"unite"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "devis_lignes_organisation_id_devis_id_fkey"
      columns: ["organisation_id","devis_id"]
isOneToOne: false
      referencedRelation: "devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "devis_lignes_organisation_id_devis_id_fkey"
      columns: ["organisation_id","devis_id"]
isOneToOne: false
      referencedRelation: "v_devis"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"documents_chantier": {
                  Row: {
                    "chantier_id": string,"chemin": string,"created_at": string,"id": string,"nom": string,"organisation_id": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "chantier_id": string,"chemin": string,"created_at"?: string,"id"?: string,"nom": string,"organisation_id": string,"type": string
                  }
                  Update: {
                    "chantier_id"?: string,"chemin"?: string,"created_at"?: string,"id"?: string,"nom"?: string,"organisation_id"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_chantier_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "documents_chantier_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "v_chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "documents_chantier_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"elements": {
                  Row: {
                    "faces": number,"id": string,"notes": string | null,"organisation_id": string,"piece_id": string,"quantite_e4": number,"type": string,"unite": string
                  }
                  ComputedFields: never
                  Insert: {
                    "faces"?: number,"id"?: string,"notes"?: string | null,"organisation_id": string,"piece_id": string,"quantite_e4": number,"type": string,"unite": string
                  }
                  Update: {
                    "faces"?: number,"id"?: string,"notes"?: string | null,"organisation_id"?: string,"piece_id"?: string,"quantite_e4"?: number,"type"?: string,"unite"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "elements_organisation_id_piece_id_fkey"
      columns: ["organisation_id","piece_id"]
isOneToOne: false
      referencedRelation: "pieces"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"envois": {
                  Row: {
                    "canal": string,"destinataire": string | null,"document_id": string,"document_type": string,"envoye_le": string,"erreur": string | null,"fournisseur_id": string | null,"id": string,"nature": string,"organisation_id": string,"statut": string
                  }
                  ComputedFields: never
                  Insert: {
                    "canal": string,"destinataire"?: string | null,"document_id": string,"document_type": string,"envoye_le"?: string,"erreur"?: string | null,"fournisseur_id"?: string | null,"id"?: string,"nature": string,"organisation_id": string,"statut"?: string
                  }
                  Update: {
                    "canal"?: string,"destinataire"?: string | null,"document_id"?: string,"document_type"?: string,"envoye_le"?: string,"erreur"?: string | null,"fournisseur_id"?: string | null,"id"?: string,"nature"?: string,"organisation_id"?: string,"statut"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "envois_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"etapes_preparation": {
                  Row: {
                    "actif": boolean,"code": string,"consommation_par_m2": number | null,"id": string,"libelle": string,"minutes_par_m2": number,"ordre": number,"organisation_id": string,"produit_id": string | null,"statut_verification": Database["public"]['Enums']["statut_verification"]
                  }
                  ComputedFields: never
                  Insert: {
                    "actif"?: boolean,"code": string,"consommation_par_m2"?: number | null,"id"?: string,"libelle": string,"minutes_par_m2"?: number,"ordre"?: number,"organisation_id": string,"produit_id"?: string | null,"statut_verification"?: Database["public"]['Enums']["statut_verification"]
                  }
                  Update: {
                    "actif"?: boolean,"code"?: string,"consommation_par_m2"?: number | null,"id"?: string,"libelle"?: string,"minutes_par_m2"?: number,"ordre"?: number,"organisation_id"?: string,"produit_id"?: string | null,"statut_verification"?: Database["public"]['Enums']["statut_verification"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "etapes_preparation_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "etapes_preparation_organisation_id_produit_id_fkey"
      columns: ["organisation_id","produit_id"]
isOneToOne: false
      referencedRelation: "produits"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"evenements": {
                  Row: {
                    "chantier_id": string | null,"debut": string,"fin": string,"id": string,"journee_entiere": boolean,"notes": string | null,"organisation_id": string,"titre": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "chantier_id"?: string | null,"debut": string,"fin": string,"id"?: string,"journee_entiere"?: boolean,"notes"?: string | null,"organisation_id": string,"titre": string,"type": string
                  }
                  Update: {
                    "chantier_id"?: string | null,"debut"?: string,"fin"?: string,"id"?: string,"journee_entiere"?: boolean,"notes"?: string | null,"organisation_id"?: string,"titre"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "evenements_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "evenements_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "v_chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "evenements_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"facture_lignes": {
                  Row: {
                    "avancement_bp": number | null,"description": string | null,"designation": string,"devis_ligne_id": string | null,"facture_id": string,"id": string,"ordre": number,"organisation_id": string,"prix_unitaire_ht_cents": number | null,"quantite_e4": number | null,"remise_bp": number,"taux_tva_bp": number | null,"total_ht_cents": number | null,"type": Database["public"]['Enums']["type_ligne"],"unite": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "avancement_bp"?: number | null,"description"?: string | null,"designation": string,"devis_ligne_id"?: string | null,"facture_id": string,"id"?: string,"ordre": number,"organisation_id": string,"prix_unitaire_ht_cents"?: number | null,"quantite_e4"?: number | null,"remise_bp"?: number,"taux_tva_bp"?: number | null,"total_ht_cents"?: number | null,"type"?: Database["public"]['Enums']["type_ligne"],"unite"?: string | null
                  }
                  Update: {
                    "avancement_bp"?: number | null,"description"?: string | null,"designation"?: string,"devis_ligne_id"?: string | null,"facture_id"?: string,"id"?: string,"ordre"?: number,"organisation_id"?: string,"prix_unitaire_ht_cents"?: number | null,"quantite_e4"?: number | null,"remise_bp"?: number,"taux_tva_bp"?: number | null,"total_ht_cents"?: number | null,"type"?: Database["public"]['Enums']["type_ligne"],"unite"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "facture_lignes_organisation_id_devis_ligne_id_fkey"
      columns: ["organisation_id","devis_ligne_id"]
isOneToOne: false
      referencedRelation: "devis_lignes"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "facture_lignes_organisation_id_facture_id_fkey"
      columns: ["organisation_id","facture_id"]
isOneToOne: false
      referencedRelation: "factures"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "facture_lignes_organisation_id_facture_id_fkey"
      columns: ["organisation_id","facture_id"]
isOneToOne: false
      referencedRelation: "v_factures"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"factures": {
                  Row: {
                    "acompte_pct_bp": number | null,"annulee_le": string | null,"autoliquidation": boolean,"avancement_bp": number | null,"chantier_id": string | null,"client_id": string,"copie_chantier": Json | null,"copie_client": Json | null,"copie_emetteur": Json | null,"created_at": string,"date_echeance": string | null,"date_emission": string | null,"date_prestation_debut": string | null,"date_prestation_fin": string | null,"deductions": NonNullable<Json>,"delai_paiement_jours": number,"devis_id": string | null,"envoyee_le": string | null,"facture_origine_id": string | null,"facturx_chemin": string | null,"id": string,"nature_avoir": string | null,"net_a_payer_cents": number,"notes_client": string | null,"numero": string | null,"organisation_id": string,"pdf_chemin": string | null,"pdf_sha256": string | null,"regime_tva": Database["public"]['Enums']["regime_tva"],"remise_globale_bp": number,"statut": Database["public"]['Enums']["statut_facture"],"total_ht_cents": number,"total_ttc_cents": number,"total_tva_cents": number,"type": Database["public"]['Enums']["type_facture"],"updated_at": string,"ventilation_tva": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "acompte_pct_bp"?: number | null,"annulee_le"?: string | null,"autoliquidation"?: boolean,"avancement_bp"?: number | null,"chantier_id"?: string | null,"client_id": string,"copie_chantier"?: Json | null,"copie_client"?: Json | null,"copie_emetteur"?: Json | null,"created_at"?: string,"date_echeance"?: string | null,"date_emission"?: string | null,"date_prestation_debut"?: string | null,"date_prestation_fin"?: string | null,"deductions"?: NonNullable<Json>,"delai_paiement_jours": number,"devis_id"?: string | null,"envoyee_le"?: string | null,"facture_origine_id"?: string | null,"facturx_chemin"?: string | null,"id"?: string,"nature_avoir"?: string | null,"net_a_payer_cents"?: number,"notes_client"?: string | null,"numero"?: string | null,"organisation_id": string,"pdf_chemin"?: string | null,"pdf_sha256"?: string | null,"regime_tva": Database["public"]['Enums']["regime_tva"],"remise_globale_bp"?: number,"statut"?: Database["public"]['Enums']["statut_facture"],"total_ht_cents"?: number,"total_ttc_cents"?: number,"total_tva_cents"?: number,"type": Database["public"]['Enums']["type_facture"],"updated_at"?: string,"ventilation_tva"?: NonNullable<Json>
                  }
                  Update: {
                    "acompte_pct_bp"?: number | null,"annulee_le"?: string | null,"autoliquidation"?: boolean,"avancement_bp"?: number | null,"chantier_id"?: string | null,"client_id"?: string,"copie_chantier"?: Json | null,"copie_client"?: Json | null,"copie_emetteur"?: Json | null,"created_at"?: string,"date_echeance"?: string | null,"date_emission"?: string | null,"date_prestation_debut"?: string | null,"date_prestation_fin"?: string | null,"deductions"?: NonNullable<Json>,"delai_paiement_jours"?: number,"devis_id"?: string | null,"envoyee_le"?: string | null,"facture_origine_id"?: string | null,"facturx_chemin"?: string | null,"id"?: string,"nature_avoir"?: string | null,"net_a_payer_cents"?: number,"notes_client"?: string | null,"numero"?: string | null,"organisation_id"?: string,"pdf_chemin"?: string | null,"pdf_sha256"?: string | null,"regime_tva"?: Database["public"]['Enums']["regime_tva"],"remise_globale_bp"?: number,"statut"?: Database["public"]['Enums']["statut_facture"],"total_ht_cents"?: number,"total_ttc_cents"?: number,"total_tva_cents"?: number,"type"?: Database["public"]['Enums']["type_facture"],"updated_at"?: string,"ventilation_tva"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "factures_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "factures_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "v_chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "factures_organisation_id_client_id_fkey"
      columns: ["organisation_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "factures_organisation_id_devis_id_fkey"
      columns: ["organisation_id","devis_id"]
isOneToOne: false
      referencedRelation: "devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "factures_organisation_id_devis_id_fkey"
      columns: ["organisation_id","devis_id"]
isOneToOne: false
      referencedRelation: "v_devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "factures_organisation_id_facture_origine_id_fkey"
      columns: ["organisation_id","facture_origine_id"]
isOneToOne: false
      referencedRelation: "factures"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "factures_organisation_id_facture_origine_id_fkey"
      columns: ["organisation_id","facture_origine_id"]
isOneToOne: false
      referencedRelation: "v_factures"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "factures_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"historique_prix": {
                  Row: {
                    "conditionnement_id": string,"created_at": string,"date_effet": string,"id": string,"organisation_id": string,"prix_achat_ht_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "conditionnement_id": string,"created_at"?: string,"date_effet"?: string,"id"?: string,"organisation_id": string,"prix_achat_ht_cents": number
                  }
                  Update: {
                    "conditionnement_id"?: string,"created_at"?: string,"date_effet"?: string,"id"?: string,"organisation_id"?: string,"prix_achat_ht_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "historique_prix_organisation_id_conditionnement_id_fkey"
      columns: ["organisation_id","conditionnement_id"]
isOneToOne: false
      referencedRelation: "conditionnements"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"journal_audit": {
                  Row: {
                    "action": string,"apres": Json | null,"avant": Json | null,"cree_le": string,"id": number,"ligne_id": string | null,"organisation_id": string,"table_nom": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"apres"?: Json | null,"avant"?: Json | null,"cree_le"?: string,"id"?: never,"ligne_id"?: string | null,"organisation_id": string,"table_nom": string,"user_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"apres"?: Json | null,"avant"?: Json | null,"cree_le"?: string,"id"?: never,"ligne_id"?: string | null,"organisation_id"?: string,"table_nom"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "journal_audit_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"liens_publics": {
                  Row: {
                    "cree_le": string,"devis_id": string | null,"expire_le": string,"facture_id": string | null,"finalite": string,"id": string,"jeton_sha256": string,"organisation_id": string,"revoque_le": string | null,"utilise_le": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cree_le"?: string,"devis_id"?: string | null,"expire_le": string,"facture_id"?: string | null,"finalite": string,"id"?: string,"jeton_sha256": string,"organisation_id": string,"revoque_le"?: string | null,"utilise_le"?: string | null
                  }
                  Update: {
                    "cree_le"?: string,"devis_id"?: string | null,"expire_le"?: string,"facture_id"?: string | null,"finalite"?: string,"id"?: string,"jeton_sha256"?: string,"organisation_id"?: string,"revoque_le"?: string | null,"utilise_le"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "liens_publics_organisation_id_devis_id_fkey"
      columns: ["organisation_id","devis_id"]
isOneToOne: false
      referencedRelation: "devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "liens_publics_organisation_id_devis_id_fkey"
      columns: ["organisation_id","devis_id"]
isOneToOne: false
      referencedRelation: "v_devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "liens_publics_organisation_id_facture_id_fkey"
      columns: ["organisation_id","facture_id"]
isOneToOne: false
      referencedRelation: "factures"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "liens_publics_organisation_id_facture_id_fkey"
      columns: ["organisation_id","facture_id"]
isOneToOne: false
      referencedRelation: "v_factures"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "liens_publics_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"materiel": {
                  Row: {
                    "date_achat": string | null,"depense_id": string | null,"id": string,"libelle": string,"notes": string | null,"organisation_id": string,"valeur_cents": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "date_achat"?: string | null,"depense_id"?: string | null,"id"?: string,"libelle": string,"notes"?: string | null,"organisation_id": string,"valeur_cents"?: number | null
                  }
                  Update: {
                    "date_achat"?: string | null,"depense_id"?: string | null,"id"?: string,"libelle"?: string,"notes"?: string | null,"organisation_id"?: string,"valeur_cents"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "materiel_organisation_id_depense_id_fkey"
      columns: ["organisation_id","depense_id"]
isOneToOne: false
      referencedRelation: "depenses"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "materiel_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"membres": {
                  Row: {
                    "created_at": string,"organisation_id": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"organisation_id": string,"role"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"organisation_id"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "membres_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"modeles_messages": {
                  Row: {
                    "actif": boolean,"code": string,"corps": string,"delai_jours": number | null,"id": string,"organisation_id": string,"sujet": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actif"?: boolean,"code": string,"corps": string,"delai_jours"?: number | null,"id"?: string,"organisation_id": string,"sujet": string
                  }
                  Update: {
                    "actif"?: boolean,"code"?: string,"corps"?: string,"delai_jours"?: number | null,"id"?: string,"organisation_id"?: string,"sujet"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "modeles_messages_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"organisations": {
                  Row: {
                    "created_at": string,"id": string,"nom": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"nom": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"nom"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ouvertures": {
                  Row: {
                    "hauteur_mm": number | null,"id": string,"largeur_mm": number | null,"organisation_id": string,"piece_id": string,"quantite": number,"surface_directe_mm2": number | null,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "hauteur_mm"?: number | null,"id"?: string,"largeur_mm"?: number | null,"organisation_id": string,"piece_id": string,"quantite"?: number,"surface_directe_mm2"?: number | null,"type": string
                  }
                  Update: {
                    "hauteur_mm"?: number | null,"id"?: string,"largeur_mm"?: number | null,"organisation_id"?: string,"piece_id"?: string,"quantite"?: number,"surface_directe_mm2"?: number | null,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ouvertures_organisation_id_piece_id_fkey"
      columns: ["organisation_id","piece_id"]
isOneToOne: false
      referencedRelation: "pieces"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"paiements": {
                  Row: {
                    "annule_paiement_id": string | null,"created_at": string,"cree_par": string | null,"date_paiement": string,"facture_id": string,"id": string,"mode": Database["public"]['Enums']["mode_paiement"],"montant_cents": number,"notes": string | null,"organisation_id": string,"reference": string | null,"stripe_evenement_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "annule_paiement_id"?: string | null,"created_at"?: string,"cree_par"?: string | null,"date_paiement": string,"facture_id": string,"id"?: string,"mode": Database["public"]['Enums']["mode_paiement"],"montant_cents": number,"notes"?: string | null,"organisation_id": string,"reference"?: string | null,"stripe_evenement_id"?: string | null
                  }
                  Update: {
                    "annule_paiement_id"?: string | null,"created_at"?: string,"cree_par"?: string | null,"date_paiement"?: string,"facture_id"?: string,"id"?: string,"mode"?: Database["public"]['Enums']["mode_paiement"],"montant_cents"?: number,"notes"?: string | null,"organisation_id"?: string,"reference"?: string | null,"stripe_evenement_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "paiements_organisation_id_annule_paiement_id_fkey"
      columns: ["organisation_id","annule_paiement_id"]
isOneToOne: false
      referencedRelation: "paiements"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "paiements_organisation_id_facture_id_fkey"
      columns: ["organisation_id","facture_id"]
isOneToOne: false
      referencedRelation: "factures"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "paiements_organisation_id_facture_id_fkey"
      columns: ["organisation_id","facture_id"]
isOneToOne: false
      referencedRelation: "v_factures"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "paiements_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"parametres_entreprise": {
                  Row: {
                    "acompte_pct_defaut_bp": number,"adresse_ligne1": string | null,"adresse_ligne2": string | null,"avis_google_url": string | null,"bic": string | null,"code_postal": string | null,"coef_marge_bp": number,"delai_paiement_jours": number,"delai_paiement_max_jours": number,"duree_conservation_prospects_mois": number,"email": string | null,"escompte_texte": string,"forme_juridique": string,"iban": string | null,"immatriculation": string | null,"indemnite_recouvrement_cents": number,"logo_chemin": string | null,"marge_perte_bp": number,"mediateur_coordonnees": string | null,"mediateur_nom": string | null,"mediateur_site": string | null,"mention_franchise": string,"mention_franchise_a_verifier": boolean,"mentions_pied": string | null,"nom_dirigeant": string | null,"numero_tva_intra": string | null,"organisation_id": string,"raison_sociale": string | null,"regime_tva": Database["public"]['Enums']["regime_tva"],"relance_devis_active": boolean,"relance_devis_jours": number,"seuil_alerte_1_bp": number,"seuil_alerte_2_bp": number,"seuil_ca_micro_cents": number | null,"seuil_franchise_tva_cents": number | null,"seuils_confirmes_le": string | null,"siret": string | null,"taux_horaire_cents": number | null,"taux_penalites_bp": number | null,"telephone": string | null,"updated_at": string,"valeurs_a_verifier": (string)[],"validite_devis_jours": number,"ville": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "acompte_pct_defaut_bp"?: number,"adresse_ligne1"?: string | null,"adresse_ligne2"?: string | null,"avis_google_url"?: string | null,"bic"?: string | null,"code_postal"?: string | null,"coef_marge_bp"?: number,"delai_paiement_jours"?: number,"delai_paiement_max_jours"?: number,"duree_conservation_prospects_mois"?: number,"email"?: string | null,"escompte_texte"?: string,"forme_juridique"?: string,"iban"?: string | null,"immatriculation"?: string | null,"indemnite_recouvrement_cents"?: number,"logo_chemin"?: string | null,"marge_perte_bp"?: number,"mediateur_coordonnees"?: string | null,"mediateur_nom"?: string | null,"mediateur_site"?: string | null,"mention_franchise"?: string,"mention_franchise_a_verifier"?: boolean,"mentions_pied"?: string | null,"nom_dirigeant"?: string | null,"numero_tva_intra"?: string | null,"organisation_id": string,"raison_sociale"?: string | null,"regime_tva"?: Database["public"]['Enums']["regime_tva"],"relance_devis_active"?: boolean,"relance_devis_jours"?: number,"seuil_alerte_1_bp"?: number,"seuil_alerte_2_bp"?: number,"seuil_ca_micro_cents"?: number | null,"seuil_franchise_tva_cents"?: number | null,"seuils_confirmes_le"?: string | null,"siret"?: string | null,"taux_horaire_cents"?: number | null,"taux_penalites_bp"?: number | null,"telephone"?: string | null,"updated_at"?: string,"valeurs_a_verifier"?: (string)[],"validite_devis_jours"?: number,"ville"?: string | null
                  }
                  Update: {
                    "acompte_pct_defaut_bp"?: number,"adresse_ligne1"?: string | null,"adresse_ligne2"?: string | null,"avis_google_url"?: string | null,"bic"?: string | null,"code_postal"?: string | null,"coef_marge_bp"?: number,"delai_paiement_jours"?: number,"delai_paiement_max_jours"?: number,"duree_conservation_prospects_mois"?: number,"email"?: string | null,"escompte_texte"?: string,"forme_juridique"?: string,"iban"?: string | null,"immatriculation"?: string | null,"indemnite_recouvrement_cents"?: number,"logo_chemin"?: string | null,"marge_perte_bp"?: number,"mediateur_coordonnees"?: string | null,"mediateur_nom"?: string | null,"mediateur_site"?: string | null,"mention_franchise"?: string,"mention_franchise_a_verifier"?: boolean,"mentions_pied"?: string | null,"nom_dirigeant"?: string | null,"numero_tva_intra"?: string | null,"organisation_id"?: string,"raison_sociale"?: string | null,"regime_tva"?: Database["public"]['Enums']["regime_tva"],"relance_devis_active"?: boolean,"relance_devis_jours"?: number,"seuil_alerte_1_bp"?: number,"seuil_alerte_2_bp"?: number,"seuil_ca_micro_cents"?: number | null,"seuil_franchise_tva_cents"?: number | null,"seuils_confirmes_le"?: string | null,"siret"?: string | null,"taux_horaire_cents"?: number | null,"taux_penalites_bp"?: number | null,"telephone"?: string | null,"updated_at"?: string,"valeurs_a_verifier"?: (string)[],"validite_devis_jours"?: number,"ville"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "parametres_entreprise_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: true
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"photos": {
                  Row: {
                    "annotations": Json | null,"chantier_id": string,"chemin": string,"id": string,"legende": string | null,"moment": string,"organisation_id": string,"piece_id": string | null,"prise_le": string
                  }
                  ComputedFields: never
                  Insert: {
                    "annotations"?: Json | null,"chantier_id": string,"chemin": string,"id"?: string,"legende"?: string | null,"moment"?: string,"organisation_id": string,"piece_id"?: string | null,"prise_le"?: string
                  }
                  Update: {
                    "annotations"?: Json | null,"chantier_id"?: string,"chemin"?: string,"id"?: string,"legende"?: string | null,"moment"?: string,"organisation_id"?: string,"piece_id"?: string | null,"prise_le"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "photos_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "photos_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "v_chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "photos_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "photos_organisation_id_piece_id_fkey"
      columns: ["organisation_id","piece_id"]
isOneToOne: false
      referencedRelation: "pieces"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"pieces": {
                  Row: {
                    "chantier_id": string,"created_at": string,"etage": string | null,"etat_support": string | null,"hauteur_mm": number,"id": string,"largeur_mm": number | null,"longueur_mm": number | null,"mode_saisie": string,"multiplicateur": number,"murs_mm": (number)[] | null,"nom": string,"notes": string | null,"ordre": number,"organisation_id": string,"surface_sol_mm2": number | null,"teinte_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "chantier_id": string,"created_at"?: string,"etage"?: string | null,"etat_support"?: string | null,"hauteur_mm": number,"id"?: string,"largeur_mm"?: number | null,"longueur_mm"?: number | null,"mode_saisie"?: string,"multiplicateur"?: number,"murs_mm"?: (number)[] | null,"nom": string,"notes"?: string | null,"ordre"?: number,"organisation_id": string,"surface_sol_mm2"?: number | null,"teinte_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "chantier_id"?: string,"created_at"?: string,"etage"?: string | null,"etat_support"?: string | null,"hauteur_mm"?: number,"id"?: string,"largeur_mm"?: number | null,"longueur_mm"?: number | null,"mode_saisie"?: string,"multiplicateur"?: number,"murs_mm"?: (number)[] | null,"nom"?: string,"notes"?: string | null,"ordre"?: number,"organisation_id"?: string,"surface_sol_mm2"?: number | null,"teinte_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pieces_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "pieces_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "v_chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "pieces_organisation_id_teinte_id_fkey"
      columns: ["organisation_id","teinte_id"]
isOneToOne: false
      referencedRelation: "teintes"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"postes_preparations": {
                  Row: {
                    "etape_id": string,"organisation_id": string,"poste_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "etape_id": string,"organisation_id": string,"poste_id": string
                  }
                  Update: {
                    "etape_id"?: string,"organisation_id"?: string,"poste_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "postes_preparations_organisation_id_etape_id_fkey"
      columns: ["organisation_id","etape_id"]
isOneToOne: false
      referencedRelation: "etapes_preparation"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "postes_preparations_organisation_id_poste_id_fkey"
      columns: ["organisation_id","poste_id"]
isOneToOne: false
      referencedRelation: "postes_travaux"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"postes_travaux": {
                  Row: {
                    "cible": string,"couches": number,"element_id": string | null,"finition": string | null,"id": string,"marge_perte_bp": number | null,"organisation_id": string,"piece_id": string,"produit_id": string | null,"rendement_force": number | null,"support": string,"taches": boolean,"teinte_id": string | null,"zone_humide": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "cible": string,"couches"?: number,"element_id"?: string | null,"finition"?: string | null,"id"?: string,"marge_perte_bp"?: number | null,"organisation_id": string,"piece_id": string,"produit_id"?: string | null,"rendement_force"?: number | null,"support": string,"taches"?: boolean,"teinte_id"?: string | null,"zone_humide"?: boolean
                  }
                  Update: {
                    "cible"?: string,"couches"?: number,"element_id"?: string | null,"finition"?: string | null,"id"?: string,"marge_perte_bp"?: number | null,"organisation_id"?: string,"piece_id"?: string,"produit_id"?: string | null,"rendement_force"?: number | null,"support"?: string,"taches"?: boolean,"teinte_id"?: string | null,"zone_humide"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "postes_travaux_organisation_id_element_id_fkey"
      columns: ["organisation_id","element_id"]
isOneToOne: false
      referencedRelation: "elements"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "postes_travaux_organisation_id_piece_id_fkey"
      columns: ["organisation_id","piece_id"]
isOneToOne: false
      referencedRelation: "pieces"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "postes_travaux_organisation_id_produit_id_fkey"
      columns: ["organisation_id","produit_id"]
isOneToOne: false
      referencedRelation: "produits"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "postes_travaux_organisation_id_teinte_id_fkey"
      columns: ["organisation_id","teinte_id"]
isOneToOne: false
      referencedRelation: "teintes"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"prestations": {
                  Row: {
                    "actif": boolean,"created_at": string,"description": string | null,"id": string,"libelle": string,"organisation_id": string,"prix_unitaire_ht_cents": number,"taux_tva_bp": number,"unite": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actif"?: boolean,"created_at"?: string,"description"?: string | null,"id"?: string,"libelle": string,"organisation_id": string,"prix_unitaire_ht_cents": number,"taux_tva_bp": number,"unite": string,"updated_at"?: string
                  }
                  Update: {
                    "actif"?: boolean,"created_at"?: string,"description"?: string | null,"id"?: string,"libelle"?: string,"organisation_id"?: string,"prix_unitaire_ht_cents"?: number,"taux_tva_bp"?: number,"unite"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "prestations_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"produits": {
                  Row: {
                    "actif": boolean,"couches_recommandees": number | null,"created_at": string,"designation": string,"fiche_technique_url": string | null,"finition": string | null,"fournisseur": string | null,"gamme": string | null,"id": string,"marque": string,"organisation_id": string,"reference_fabricant": string | null,"rendement_m2_par_unite": number | null,"sechage_recouvrable_h": number | null,"source_verification": string | null,"statut_verification": Database["public"]['Enums']["statut_verification"],"type": string,"unite_mesure": string,"updated_at": string,"usages": (string)[],"verifie_le": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actif"?: boolean,"couches_recommandees"?: number | null,"created_at"?: string,"designation": string,"fiche_technique_url"?: string | null,"finition"?: string | null,"fournisseur"?: string | null,"gamme"?: string | null,"id"?: string,"marque": string,"organisation_id": string,"reference_fabricant"?: string | null,"rendement_m2_par_unite"?: number | null,"sechage_recouvrable_h"?: number | null,"source_verification"?: string | null,"statut_verification"?: Database["public"]['Enums']["statut_verification"],"type": string,"unite_mesure"?: string,"updated_at"?: string,"usages"?: (string)[],"verifie_le"?: string | null
                  }
                  Update: {
                    "actif"?: boolean,"couches_recommandees"?: number | null,"created_at"?: string,"designation"?: string,"fiche_technique_url"?: string | null,"finition"?: string | null,"fournisseur"?: string | null,"gamme"?: string | null,"id"?: string,"marque"?: string,"organisation_id"?: string,"reference_fabricant"?: string | null,"rendement_m2_par_unite"?: number | null,"sechage_recouvrable_h"?: number | null,"source_verification"?: string | null,"statut_verification"?: Database["public"]['Enums']["statut_verification"],"type"?: string,"unite_mesure"?: string,"updated_at"?: string,"usages"?: (string)[],"verifie_le"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "produits_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"pv_reception": {
                  Row: {
                    "avec_reserves": boolean,"chantier_id": string,"created_at": string,"date_reception": string,"id": string,"organisation_id": string,"pdf_chemin": string | null,"pdf_sha256": string | null,"reserves": NonNullable<Json>,"signature_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "avec_reserves"?: boolean,"chantier_id": string,"created_at"?: string,"date_reception": string,"id"?: string,"organisation_id": string,"pdf_chemin"?: string | null,"pdf_sha256"?: string | null,"reserves"?: NonNullable<Json>,"signature_id"?: string | null
                  }
                  Update: {
                    "avec_reserves"?: boolean,"chantier_id"?: string,"created_at"?: string,"date_reception"?: string,"id"?: string,"organisation_id"?: string,"pdf_chemin"?: string | null,"pdf_sha256"?: string | null,"reserves"?: NonNullable<Json>,"signature_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "pv_reception_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "pv_reception_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "v_chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "pv_reception_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pv_reception_organisation_id_signature_id_fkey"
      columns: ["organisation_id","signature_id"]
isOneToOne: false
      referencedRelation: "signatures"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"rappels": {
                  Row: {
                    "canal": string,"chantier_id": string | null,"document_id": string | null,"document_type": string | null,"echeance": string,"envoye_le": string | null,"evenement_id": string | null,"id": string,"lu_le": string | null,"organisation_id": string,"statut": string,"titre": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "canal"?: string,"chantier_id"?: string | null,"document_id"?: string | null,"document_type"?: string | null,"echeance": string,"envoye_le"?: string | null,"evenement_id"?: string | null,"id"?: string,"lu_le"?: string | null,"organisation_id": string,"statut"?: string,"titre": string,"type": string
                  }
                  Update: {
                    "canal"?: string,"chantier_id"?: string | null,"document_id"?: string | null,"document_type"?: string | null,"echeance"?: string,"envoye_le"?: string | null,"evenement_id"?: string | null,"id"?: string,"lu_le"?: string | null,"organisation_id"?: string,"statut"?: string,"titre"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rappels_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "rappels_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "v_chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "rappels_organisation_id_evenement_id_fkey"
      columns: ["organisation_id","evenement_id"]
isOneToOne: false
      referencedRelation: "evenements"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "rappels_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"referentiel_calcul": {
                  Row: {
                    "minutes_par_m2_couche": number | null,"organisation_id": string,"rendement_max": number,"rendement_min": number,"statut_verification": Database["public"]['Enums']["statut_verification"],"type_produit": string
                  }
                  ComputedFields: never
                  Insert: {
                    "minutes_par_m2_couche"?: number | null,"organisation_id": string,"rendement_max": number,"rendement_min": number,"statut_verification"?: Database["public"]['Enums']["statut_verification"],"type_produit": string
                  }
                  Update: {
                    "minutes_par_m2_couche"?: number | null,"organisation_id"?: string,"rendement_max"?: number,"rendement_min"?: number,"statut_verification"?: Database["public"]['Enums']["statut_verification"],"type_produit"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "referentiel_calcul_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"sequences_documents": {
                  Row: {
                    "annee": number,"dernier": number,"organisation_id": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "annee": number,"dernier": number,"organisation_id": string,"type": string
                  }
                  Update: {
                    "annee"?: number,"dernier"?: number,"organisation_id"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sequences_documents_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"signatures": {
                  Row: {
                    "document_id": string,"document_sha256": string,"document_type": string,"id": string,"image_chemin": string,"ip": unknown,"mention": string,"methode": string,"options_acceptees": (string)[],"organisation_id": string,"pdf_signe_chemin": string | null,"pdf_signe_sha256": string | null,"signataire_nom": string,"signe_le": string,"user_agent": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "document_id": string,"document_sha256": string,"document_type": string,"id"?: string,"image_chemin": string,"ip"?: unknown,"mention": string,"methode": string,"options_acceptees"?: (string)[],"organisation_id": string,"pdf_signe_chemin"?: string | null,"pdf_signe_sha256"?: string | null,"signataire_nom": string,"signe_le"?: string,"user_agent"?: string | null
                  }
                  Update: {
                    "document_id"?: string,"document_sha256"?: string,"document_type"?: string,"id"?: string,"image_chemin"?: string,"ip"?: unknown,"mention"?: string,"methode"?: string,"options_acceptees"?: (string)[],"organisation_id"?: string,"pdf_signe_chemin"?: string | null,"pdf_signe_sha256"?: string | null,"signataire_nom"?: string,"signe_le"?: string,"user_agent"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "signatures_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"taux_tva": {
                  Row: {
                    "a_verifier": boolean,"actif": boolean,"attestation_requise": boolean,"libelle": string,"organisation_id": string,"taux_bp": number
                  }
                  ComputedFields: never
                  Insert: {
                    "a_verifier"?: boolean,"actif"?: boolean,"attestation_requise"?: boolean,"libelle": string,"organisation_id": string,"taux_bp": number
                  }
                  Update: {
                    "a_verifier"?: boolean,"actif"?: boolean,"attestation_requise"?: boolean,"libelle"?: string,"organisation_id"?: string,"taux_bp"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "taux_tva_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"teintes": {
                  Row: {
                    "apercu_hex": string | null,"code_fabricant": string | null,"code_ncs": string | null,"code_ral": string | null,"created_at": string,"id": string,"marque": string | null,"nom": string,"organisation_id": string,"statut_verification": Database["public"]['Enums']["statut_verification"]
                  }
                  ComputedFields: never
                  Insert: {
                    "apercu_hex"?: string | null,"code_fabricant"?: string | null,"code_ncs"?: string | null,"code_ral"?: string | null,"created_at"?: string,"id"?: string,"marque"?: string | null,"nom": string,"organisation_id": string,"statut_verification"?: Database["public"]['Enums']["statut_verification"]
                  }
                  Update: {
                    "apercu_hex"?: string | null,"code_fabricant"?: string | null,"code_ncs"?: string | null,"code_ral"?: string | null,"created_at"?: string,"id"?: string,"marque"?: string | null,"nom"?: string,"organisation_id"?: string,"statut_verification"?: Database["public"]['Enums']["statut_verification"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "teintes_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"temps_passes": {
                  Row: {
                    "chantier_id": string,"created_at": string,"id": string,"jour": string,"minutes": number,"note": string | null,"organisation_id": string,"tache": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "chantier_id": string,"created_at"?: string,"id"?: string,"jour": string,"minutes": number,"note"?: string | null,"organisation_id": string,"tache"?: string | null
                  }
                  Update: {
                    "chantier_id"?: string,"created_at"?: string,"id"?: string,"jour"?: string,"minutes"?: number,"note"?: string | null,"organisation_id"?: string,"tache"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "temps_passes_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "temps_passes_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "v_chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "temps_passes_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "v_chantiers": {
                  Row: {
                    "accepte_ttc_cents": number | null,"adresse_ligne1": string | null,"adresse_ligne2": string | null,"client_id": string | null,"code_postal": string | null,"created_at": string | null,"date_debut_prevue": string | null,"duree_estimee_jours": number | null,"engage_cents": number | null,"id": string | null,"nom": string | null,"notes": string | null,"organisation_id": string | null,"reste_a_facturer_cents": number | null,"reste_a_payer_cents": number | null,"statut": Database["public"]['Enums']["statut_chantier"] | null,"statut_affiche": string | null,"teinte_id": string | null,"updated_at": string | null,"ville": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "chantiers_organisation_id_client_id_fkey"
      columns: ["organisation_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "chantiers_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chantiers_organisation_id_teinte_id_fkey"
      columns: ["organisation_id","teinte_id"]
isOneToOne: false
      referencedRelation: "teintes"
      referencedColumns: ["organisation_id","id"]
    }
                  ]
                },"v_devis": {
                  Row: {
                    "accepte_le": string | null,"acompte_pct_bp": number | null,"chantier_id": string | null,"client_id": string | null,"conditions_paiement": string | null,"consulte_le": string | null,"copie_chantier": Json | null,"copie_client": Json | null,"copie_emetteur": Json | null,"created_at": string | null,"date_debut_travaux": string | null,"date_emission": string | null,"delai_debut_texte": string | null,"devis_precedent_id": string | null,"duree_estimee_jours": number | null,"envoye_le": string | null,"hors_etablissement": boolean | null,"id": string | null,"motif_refus": string | null,"notes_client": string | null,"numero": string | null,"objet": string | null,"organisation_id": string | null,"pdf_chemin": string | null,"pdf_sha256": string | null,"refuse_le": string | null,"regime_tva": Database["public"]['Enums']["regime_tva"] | null,"remise_globale_bp": number | null,"signature_id": string | null,"statut": Database["public"]['Enums']["statut_devis"] | null,"statut_affiche": string | null,"total_accepte_ht_cents": number | null,"total_accepte_ttc_cents": number | null,"total_accepte_tva_cents": number | null,"total_ht_cents": number | null,"total_ttc_cents": number | null,"total_tva_cents": number | null,"updated_at": string | null,"valide_jusqu_au": string | null,"validite_jours": number | null,"ventilation_acceptee": Json | null,"ventilation_tva": Json | null,"version": number | null
                  }
                  ComputedFields: never
                  Insert: {
                           "accepte_le"?: string | null,"acompte_pct_bp"?: number | null,"chantier_id"?: string | null,"client_id"?: string | null,"conditions_paiement"?: string | null,"consulte_le"?: string | null,"copie_chantier"?: Json | null,"copie_client"?: Json | null,"copie_emetteur"?: Json | null,"created_at"?: string | null,"date_debut_travaux"?: string | null,"date_emission"?: string | null,"delai_debut_texte"?: string | null,"devis_precedent_id"?: string | null,"duree_estimee_jours"?: number | null,"envoye_le"?: string | null,"hors_etablissement"?: boolean | null,"id"?: string | null,"motif_refus"?: string | null,"notes_client"?: string | null,"numero"?: string | null,"objet"?: string | null,"organisation_id"?: string | null,"pdf_chemin"?: string | null,"pdf_sha256"?: string | null,"refuse_le"?: string | null,"regime_tva"?: Database["public"]['Enums']["regime_tva"] | null,"remise_globale_bp"?: number | null,"signature_id"?: string | null,"statut"?: Database["public"]['Enums']["statut_devis"] | null,"statut_affiche"?: never,"total_accepte_ht_cents"?: number | null,"total_accepte_ttc_cents"?: number | null,"total_accepte_tva_cents"?: number | null,"total_ht_cents"?: number | null,"total_ttc_cents"?: number | null,"total_tva_cents"?: number | null,"updated_at"?: string | null,"valide_jusqu_au"?: never,"validite_jours"?: number | null,"ventilation_acceptee"?: Json | null,"ventilation_tva"?: Json | null,"version"?: number | null
                         }
                        Update: {
                           "accepte_le"?: string | null,"acompte_pct_bp"?: number | null,"chantier_id"?: string | null,"client_id"?: string | null,"conditions_paiement"?: string | null,"consulte_le"?: string | null,"copie_chantier"?: Json | null,"copie_client"?: Json | null,"copie_emetteur"?: Json | null,"created_at"?: string | null,"date_debut_travaux"?: string | null,"date_emission"?: string | null,"delai_debut_texte"?: string | null,"devis_precedent_id"?: string | null,"duree_estimee_jours"?: number | null,"envoye_le"?: string | null,"hors_etablissement"?: boolean | null,"id"?: string | null,"motif_refus"?: string | null,"notes_client"?: string | null,"numero"?: string | null,"objet"?: string | null,"organisation_id"?: string | null,"pdf_chemin"?: string | null,"pdf_sha256"?: string | null,"refuse_le"?: string | null,"regime_tva"?: Database["public"]['Enums']["regime_tva"] | null,"remise_globale_bp"?: number | null,"signature_id"?: string | null,"statut"?: Database["public"]['Enums']["statut_devis"] | null,"statut_affiche"?: never,"total_accepte_ht_cents"?: number | null,"total_accepte_ttc_cents"?: number | null,"total_accepte_tva_cents"?: number | null,"total_ht_cents"?: number | null,"total_ttc_cents"?: number | null,"total_tva_cents"?: number | null,"updated_at"?: string | null,"valide_jusqu_au"?: never,"validite_jours"?: number | null,"ventilation_acceptee"?: Json | null,"ventilation_tva"?: Json | null,"version"?: number | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "devis_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "devis_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "v_chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "devis_organisation_id_client_id_fkey"
      columns: ["organisation_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "devis_organisation_id_devis_precedent_id_fkey"
      columns: ["organisation_id","devis_precedent_id"]
isOneToOne: false
      referencedRelation: "devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "devis_organisation_id_devis_precedent_id_fkey"
      columns: ["organisation_id","devis_precedent_id"]
isOneToOne: false
      referencedRelation: "v_devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "devis_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"v_factures": {
                  Row: {
                    "acompte_pct_bp": number | null,"annulee_le": string | null,"autoliquidation": boolean | null,"avancement_bp": number | null,"avoirs_cents": number | null,"chantier_id": string | null,"client_id": string | null,"copie_chantier": Json | null,"copie_client": Json | null,"copie_emetteur": Json | null,"created_at": string | null,"date_echeance": string | null,"date_emission": string | null,"date_prestation_debut": string | null,"date_prestation_fin": string | null,"deductions": Json | null,"delai_paiement_jours": number | null,"devis_id": string | null,"envoyee_le": string | null,"facture_origine_id": string | null,"facturx_chemin": string | null,"id": string | null,"nature_avoir": string | null,"net_a_payer_cents": number | null,"notes_client": string | null,"numero": string | null,"organisation_id": string | null,"paye_cents": number | null,"pdf_chemin": string | null,"pdf_sha256": string | null,"regime_tva": Database["public"]['Enums']["regime_tva"] | null,"remise_globale_bp": number | null,"reste_a_payer_cents": number | null,"reste_a_rembourser_cents": number | null,"statut": Database["public"]['Enums']["statut_facture"] | null,"statut_affiche": string | null,"total_ht_cents": number | null,"total_ttc_cents": number | null,"total_tva_cents": number | null,"type": Database["public"]['Enums']["type_facture"] | null,"updated_at": string | null,"ventilation_tva": Json | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "factures_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "factures_organisation_id_chantier_id_fkey"
      columns: ["organisation_id","chantier_id"]
isOneToOne: false
      referencedRelation: "v_chantiers"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "factures_organisation_id_client_id_fkey"
      columns: ["organisation_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "factures_organisation_id_devis_id_fkey"
      columns: ["organisation_id","devis_id"]
isOneToOne: false
      referencedRelation: "devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "factures_organisation_id_devis_id_fkey"
      columns: ["organisation_id","devis_id"]
isOneToOne: false
      referencedRelation: "v_devis"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "factures_organisation_id_facture_origine_id_fkey"
      columns: ["organisation_id","facture_origine_id"]
isOneToOne: false
      referencedRelation: "factures"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "factures_organisation_id_facture_origine_id_fkey"
      columns: ["organisation_id","facture_origine_id"]
isOneToOne: false
      referencedRelation: "v_factures"
      referencedColumns: ["organisation_id","id"]
    },{
      foreignKeyName: "factures_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                },"v_livre_recettes": {
                  Row: {
                    "client": string | null,"date_paiement": string | null,"facture_id": string | null,"facture_numero": string | null,"mode": Database["public"]['Enums']["mode_paiement"] | null,"montant_cents": number | null,"nature": string | null,"organisation_id": string | null,"reference": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "paiements_organisation_id_fkey"
      columns: ["organisation_id"]
isOneToOne: false
      referencedRelation: "organisations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "anonymiser_client":
{ Args: { "p_client_id": string }; Returns: string[]
                           },
"appliquer_rls_standard":
{ Args: { "p_table": unknown }; Returns: undefined
                           },
"audit_sans_donnees_perso":
{ Args: { "p": Json }; Returns: Json
                           },
"aujourd_hui_paris":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"chemin_de_l_organisation":
{ Args: { "p_chemin": string,"p_organisation_id": string }; Returns: boolean
                           },
"controler_totaux_lignes":
{ Args: { "p_lignes_par_taux": Json,"p_regime": Database["public"]['Enums']["regime_tva"],"p_remise_bp": number,"p_total_ht": number,"p_total_tva": number,"p_ventilation": Json }; Returns: undefined
                           },
"controler_ventilation":
{ Args: { "p_regime": Database["public"]['Enums']["regime_tva"],"p_total_ht": number,"p_total_tva": number,"p_ventilation": Json }; Returns: undefined
                           },
"deductions_bien_formees":
{ Args: { "p": Json }; Returns: boolean
                           },
"devis_par_jeton":
{ Args: { "p_jeton": string }; Returns: Json
                           },
"emettre_devis":
{ Args: { "p_copie_chantier": Json,"p_copie_client": Json,"p_copie_emetteur": Json,"p_devis_id": string,"p_pdf_chemin": string,"p_pdf_sha256": string }; Returns: string
                           },
"emettre_facture":
{ Args: { "p_copie_chantier": Json,"p_copie_client": Json,"p_copie_emetteur": Json,"p_facture_id": string,"p_pdf_chemin": string,"p_pdf_sha256": string }; Returns: string
                           },
"est_membre":
{ Args: { "p_organisation_id": string }; Returns: boolean
                           },
"facture_par_jeton":
{ Args: { "p_jeton": string }; Returns: Json
                           },
"initialiser_organisation":
{ Args: { "p_email": string,"p_nom_dirigeant": string,"p_raison_sociale": string,"p_user_id": string }; Returns: string
                           },
"lien_valide":
{ Args: { "p_finalite": string,"p_jeton": string }; Returns: {
              "cree_le": string,
"devis_id": string | null,
"expire_le": string,
"facture_id": string | null,
"finalite": string,
"id": string,
"jeton_sha256": string,
"organisation_id": string,
"revoque_le": string | null,
"utilise_le": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "liens_publics"
        isOneToOne: true
        isSetofReturn: false
      } },
"lignes_devis_par_taux":
{ Args: { "p_devis_id": string,"p_options": (string)[] }; Returns: Json
                           },
"marquer_facture_envoyee":
{ Args: { "p_facture_id": string }; Returns: undefined
                           },
"niveau_auth_suffisant":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"nouvelle_version_devis":
{ Args: { "p_devis_id": string }; Returns: string
                           },
"organisation_du_chemin":
{ Args: { "p_nom": string }; Returns: string
                           },
"prochain_numero":
{ Args: { "p_annee": number,"p_organisation_id": string,"p_type": string }; Returns: string
                           },
"purger_journal_audit":
{ Args: { "p_avant": string }; Returns: number
                           },
"purger_prospects_inactifs":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"rechercher_clients":
{ Args: { "p_decalage"?: number,"p_inclure_anonymises"?: boolean,"p_limite"?: number,"p_texte"?: string,"p_type"?: Database["public"]['Enums']["type_client"] }; Returns: {
              "anonymise_le": string | null,
"civilite": string | null,
"consentement_le": string | null,
"created_at": string,
"email": string | null,
"fact_code_postal": string | null,
"fact_ligne1": string | null,
"fact_ligne2": string | null,
"fact_pays": string,
"fact_ville": string | null,
"id": string,
"nom": string,
"notes": string | null,
"organisation_id": string,
"prenom": string | null,
"raison_sociale": string | null,
"siret": string | null,
"source": string | null,
"telephone": string | null,
"tva_intra": string | null,
"type": Database["public"]['Enums']["type_client"],
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "clients"
        isOneToOne: false
        isSetofReturn: true
      } },
"refuser_devis":
{ Args: { "p_devis_id": string,"p_motif": string }; Returns: undefined
                           },
"signer_devis_interne":
{ Args: { "p_devis_id": string,"p_document_sha256": string,"p_image_chemin": string,"p_ip": unknown,"p_mention": string,"p_methode": string,"p_nom": string,"p_options": (string)[],"p_user_agent": string }; Returns: string
                           },
"signer_devis_par_jeton":
{ Args: { "p_document_sha256": string,"p_image_chemin": string,"p_ip": unknown,"p_jeton": string,"p_mention": string,"p_nom": string,"p_options": (string)[],"p_user_agent": string }; Returns: string
                           },
"signer_devis_sur_place":
{ Args: { "p_devis_id": string,"p_document_sha256": string,"p_image_chemin": string,"p_ip": unknown,"p_mention": string,"p_nom": string,"p_options": (string)[],"p_user_agent": string }; Returns: string
                           },
"solde_avoir":
{ Args: { "p_avoir_id": string }; Returns: {
              "rembourse_cents": number,"reste_a_rembourser_cents": number
            }[]
                           },
"solde_devis":
{ Args: { "p_devis_id": string }; Returns: {
              "accepte_ttc_cents": number,"engage_cents": number,"reste_a_facturer_cents": number
            }[]
                           },
"solde_facture":
{ Args: { "p_facture_id": string }; Returns: {
              "avoirs_cents": number,"du_cents": number,"paye_cents": number,"rembourse_cents": number,"reste_a_payer_cents": number,"reste_a_rembourser_cents": number,"trop_percu_cents": number
            }[]
                           },
"texte_recherche":
{ Args: { "p": string }; Returns: string
                           },
"ventilation_attendue":
{ Args: { "p_lignes_par_taux": Json,"p_regime": Database["public"]['Enums']["regime_tva"],"p_remise_bp": number }; Returns: Json
                           },
"ventilation_bien_formee":
{ Args: { "p": Json }; Returns: boolean
                           }
          }
          Enums: {
            "mode_paiement": "virement"|"cheque"|"especes"|"carte"|"stripe","regime_tva": "franchise"|"assujetti","statut_chantier": "a_planifier"|"en_cours"|"termine","statut_devis": "brouillon"|"envoye"|"accepte"|"refuse"|"remplace","statut_facture": "brouillon"|"emise"|"annulee","statut_verification": "verifie"|"a_verifier"|"fictif","type_client": "particulier"|"professionnel","type_facture": "acompte"|"situation"|"finale"|"libre"|"avoir","type_ligne": "section"|"ligne"|"sous_total"|"texte"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "mode_paiement": ["virement", "cheque", "especes", "carte", "stripe"],"regime_tva": ["franchise", "assujetti"],"statut_chantier": ["a_planifier", "en_cours", "termine"],"statut_devis": ["brouillon", "envoye", "accepte", "refuse", "remplace"],"statut_facture": ["brouillon", "emise", "annulee"],"statut_verification": ["verifie", "a_verifier", "fictif"],"type_client": ["particulier", "professionnel"],"type_facture": ["acompte", "situation", "finale", "libre", "avoir"],"type_ligne": ["section", "ligne", "sous_total", "texte"]
          }
        }
} as const
