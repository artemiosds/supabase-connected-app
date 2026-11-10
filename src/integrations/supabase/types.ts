export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          details: Json;
          entity: string;
          entity_id: string | null;
          id: string;
          tenant_id: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          details?: Json;
          entity: string;
          entity_id?: string | null;
          id?: string;
          tenant_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          details?: Json;
          entity?: string;
          entity_id?: string | null;
          id?: string;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_events_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      contract_amendments: {
        Row: {
          contract_id: string;
          created_at: string;
          created_by: string;
          id: string;
          kind: string;
          new_end_date: string | null;
          notes: string | null;
          number: string;
          signed_at: string;
          tenant_id: string;
          updated_at: string;
          updated_by: string;
          value_change: number;
        };
        Insert: {
          contract_id: string;
          created_at?: string;
          created_by: string;
          id?: string;
          kind: string;
          new_end_date?: string | null;
          notes?: string | null;
          number: string;
          signed_at?: string;
          tenant_id: string;
          updated_at?: string;
          updated_by: string;
          value_change?: number;
        };
        Update: {
          contract_id?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          kind?: string;
          new_end_date?: string | null;
          notes?: string | null;
          number?: string;
          signed_at?: string;
          tenant_id?: string;
          updated_at?: string;
          updated_by?: string;
          value_change?: number;
        };
        Relationships: [
          {
            foreignKeyName: "fk_amendment_contract";
            columns: ["tenant_id", "contract_id"];
            isOneToOne: false;
            referencedRelation: "contracts";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      contracts: {
        Row: {
          created_at: string;
          created_by: string;
          end_date: string;
          id: string;
          inspector_name: string | null;
          manager_name: string | null;
          modality: string;
          notes: string | null;
          number: string;
          object: string;
          ordinance: string | null;
          process_id: string | null;
          start_date: string;
          status: string;
          supplier_id: string | null;
          tenant_id: string;
          total_value: number;
          updated_at: string;
          updated_by: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          end_date: string;
          id?: string;
          inspector_name?: string | null;
          manager_name?: string | null;
          modality?: string;
          notes?: string | null;
          number: string;
          object: string;
          ordinance?: string | null;
          process_id?: string | null;
          start_date: string;
          status?: string;
          supplier_id?: string | null;
          tenant_id: string;
          total_value?: number;
          updated_at?: string;
          updated_by: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          end_date?: string;
          id?: string;
          inspector_name?: string | null;
          manager_name?: string | null;
          modality?: string;
          notes?: string | null;
          number?: string;
          object?: string;
          ordinance?: string | null;
          process_id?: string | null;
          start_date?: string;
          status?: string;
          supplier_id?: string | null;
          tenant_id?: string;
          total_value?: number;
          updated_at?: string;
          updated_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contracts_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_contract_process";
            columns: ["tenant_id", "process_id"];
            isOneToOne: false;
            referencedRelation: "procurement_processes";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "fk_contract_supplier";
            columns: ["tenant_id", "supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      document_template_catalog: {
        Row: {
          content: string;
          created_at: string;
          description: string | null;
          id: string;
          is_active: boolean;
          legal_basis: string;
          source_reference: string;
          template_code: string;
          template_type: string;
          title: string;
          updated_at: string;
          variables_schema: Json;
          version: number;
        };
        Insert: {
          content: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          legal_basis: string;
          source_reference: string;
          template_code: string;
          template_type: string;
          title: string;
          updated_at?: string;
          variables_schema?: Json;
          version?: number;
        };
        Update: {
          content?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          legal_basis?: string;
          source_reference?: string;
          template_code?: string;
          template_type?: string;
          title?: string;
          updated_at?: string;
          variables_schema?: Json;
          version?: number;
        };
        Relationships: [];
      };
      document_template_versions: {
        Row: {
          change_summary: string | null;
          content: string;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          legal_basis: string | null;
          source_reference: string | null;
          template_code: string | null;
          template_id: string;
          template_type: string;
          tenant_id: string;
          title: string;
          variables_schema: Json;
          version: number;
        };
        Insert: {
          change_summary?: string | null;
          content: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          legal_basis?: string | null;
          source_reference?: string | null;
          template_code?: string | null;
          template_id: string;
          template_type: string;
          tenant_id: string;
          title: string;
          variables_schema?: Json;
          version: number;
        };
        Update: {
          change_summary?: string | null;
          content?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          legal_basis?: string | null;
          source_reference?: string | null;
          template_code?: string | null;
          template_id?: string;
          template_type?: string;
          tenant_id?: string;
          title?: string;
          variables_schema?: Json;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "document_template_versions_template_id_tenant_id_fkey";
            columns: ["template_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "document_templates";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "document_template_versions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      document_templates: {
        Row: {
          catalog_template_id: string | null;
          change_summary: string | null;
          content: string;
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          is_active: boolean;
          is_base_template: boolean;
          legal_basis: string | null;
          source_reference: string | null;
          template_code: string | null;
          template_type: string;
          tenant_id: string;
          title: string;
          updated_at: string;
          updated_by: string;
          variables_schema: Json;
          version: number;
        };
        Insert: {
          catalog_template_id?: string | null;
          change_summary?: string | null;
          content: string;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          is_base_template?: boolean;
          legal_basis?: string | null;
          source_reference?: string | null;
          template_code?: string | null;
          template_type?: string;
          tenant_id: string;
          title: string;
          updated_at?: string;
          updated_by?: string;
          variables_schema?: Json;
          version?: number;
        };
        Update: {
          catalog_template_id?: string | null;
          change_summary?: string | null;
          content?: string;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          is_base_template?: boolean;
          legal_basis?: string | null;
          source_reference?: string | null;
          template_code?: string | null;
          template_type?: string;
          tenant_id?: string;
          title?: string;
          updated_at?: string;
          updated_by?: string;
          variables_schema?: Json;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "document_templates_catalog_template_id_fkey";
            columns: ["catalog_template_id"];
            isOneToOne: false;
            referencedRelation: "document_template_catalog";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_templates_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      generated_documents: {
        Row: {
          content_snapshot: string;
          created_at: string;
          created_by: string;
          document_type: string;
          id: string;
          process_id: string | null;
          process_snapshot: Json;
          signature_statement: string | null;
          signed_at: string | null;
          signed_by: string | null;
          signed_email: string | null;
          signed_name: string | null;
          status: string;
          supplier_id: string | null;
          template_id: string | null;
          template_version: number | null;
          tenant_id: string;
          title: string;
          updated_at: string;
          updated_by: string;
          variables_snapshot: Json;
        };
        Insert: {
          content_snapshot: string;
          created_at?: string;
          created_by?: string;
          document_type?: string;
          id?: string;
          process_id?: string | null;
          process_snapshot?: Json;
          signature_statement?: string | null;
          signed_at?: string | null;
          signed_by?: string | null;
          signed_email?: string | null;
          signed_name?: string | null;
          status?: string;
          supplier_id?: string | null;
          template_id?: string | null;
          template_version?: number | null;
          tenant_id: string;
          title: string;
          updated_at?: string;
          updated_by?: string;
          variables_snapshot?: Json;
        };
        Update: {
          content_snapshot?: string;
          created_at?: string;
          created_by?: string;
          document_type?: string;
          id?: string;
          process_id?: string | null;
          process_snapshot?: Json;
          signature_statement?: string | null;
          signed_at?: string | null;
          signed_by?: string | null;
          signed_email?: string | null;
          signed_name?: string | null;
          status?: string;
          supplier_id?: string | null;
          template_id?: string | null;
          template_version?: number | null;
          tenant_id?: string;
          title?: string;
          updated_at?: string;
          updated_by?: string;
          variables_snapshot?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "generated_documents_process_tenant_fk";
            columns: ["process_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "procurement_processes";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "generated_documents_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generated_documents_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "document_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generated_documents_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      membership_roles: {
        Row: {
          created_at: string;
          membership_id: string;
          role_id: string;
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          membership_id: string;
          role_id: string;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          membership_id?: string;
          role_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fk_membership_roles_membership_tenant";
            columns: ["membership_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenant_memberships";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "fk_membership_roles_role_tenant";
            columns: ["role_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenant_roles";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "membership_roles_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      permissions: {
        Row: {
          code: string;
          created_at: string;
          description: string;
          id: string;
          module: string;
          name: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          description: string;
          id?: string;
          module: string;
          name: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string;
          id?: string;
          module?: string;
          name?: string;
        };
        Relationships: [];
      };
      platform_admins: {
        Row: {
          granted_at: string;
          granted_by: string | null;
          is_active: boolean;
          user_id: string;
        };
        Insert: {
          granted_at?: string;
          granted_by?: string | null;
          is_active?: boolean;
          user_id: string;
        };
        Update: {
          granted_at?: string;
          granted_by?: string | null;
          is_active?: boolean;
          user_id?: string;
        };
        Relationships: [];
      };
      platform_payment_integrations: {
        Row: {
          account_email: string | null;
          account_name: string;
          account_reference: string | null;
          client_id: string | null;
          created_at: string;
          created_by: string | null;
          environment: string;
          id: number;
          payments_enabled: boolean;
          provider: string;
          provider_other_name: string | null;
          public_key: string | null;
          status: string;
          updated_at: string;
          updated_by: string | null;
          vault_secret_id: string | null;
        };
        Insert: {
          account_email?: string | null;
          account_name: string;
          account_reference?: string | null;
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          environment: string;
          id?: number;
          payments_enabled?: boolean;
          provider: string;
          provider_other_name?: string | null;
          public_key?: string | null;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          vault_secret_id?: string | null;
        };
        Update: {
          account_email?: string | null;
          account_name?: string;
          account_reference?: string | null;
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          environment?: string;
          id?: number;
          payments_enabled?: boolean;
          provider?: string;
          provider_other_name?: string | null;
          public_key?: string | null;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          vault_secret_id?: string | null;
        };
        Relationships: [];
      };
      process_items: {
        Row: {
          created_at: string;
          created_by: string;
          document_url: string | null;
          id: string;
          is_done: boolean;
          process_id: string;
          sort_order: number;
          stage: string;
          tenant_id: string;
          title: string;
          updated_at: string;
          updated_by: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          document_url?: string | null;
          id?: string;
          is_done?: boolean;
          process_id: string;
          sort_order?: number;
          stage: string;
          tenant_id: string;
          title: string;
          updated_at?: string;
          updated_by: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          document_url?: string | null;
          id?: string;
          is_done?: boolean;
          process_id?: string;
          sort_order?: number;
          stage?: string;
          tenant_id?: string;
          title?: string;
          updated_at?: string;
          updated_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fk_item_process";
            columns: ["tenant_id", "process_id"];
            isOneToOne: false;
            referencedRelation: "procurement_processes";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      procurement_budget_allocations: {
        Row: {
          allocated_amount: number;
          budget_action: string | null;
          budget_unit: string;
          created_at: string;
          created_by: string;
          expense_nature: string | null;
          fiscal_year: number;
          functional_program: string | null;
          funding_source: string | null;
          id: string;
          is_active: boolean;
          notes: string | null;
          process_id: string;
          tenant_id: string;
          updated_at: string;
          updated_by: string;
        };
        Insert: {
          allocated_amount: number;
          budget_action?: string | null;
          budget_unit: string;
          created_at?: string;
          created_by: string;
          expense_nature?: string | null;
          fiscal_year: number;
          functional_program?: string | null;
          funding_source?: string | null;
          id?: string;
          is_active?: boolean;
          notes?: string | null;
          process_id: string;
          tenant_id: string;
          updated_at?: string;
          updated_by: string;
        };
        Update: {
          allocated_amount?: number;
          budget_action?: string | null;
          budget_unit?: string;
          created_at?: string;
          created_by?: string;
          expense_nature?: string | null;
          fiscal_year?: number;
          functional_program?: string | null;
          funding_source?: string | null;
          id?: string;
          is_active?: boolean;
          notes?: string | null;
          process_id?: string;
          tenant_id?: string;
          updated_at?: string;
          updated_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "procurement_budget_allocations_process_tenant_fk";
            columns: ["tenant_id", "process_id"];
            isOneToOne: false;
            referencedRelation: "procurement_processes";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      procurement_items: {
        Row: {
          created_at: string;
          created_by: string;
          delivery_location: string | null;
          description: string;
          estimated_total: number | null;
          estimated_unit_price: number | null;
          id: string;
          is_active: boolean;
          line_number: number;
          process_id: string;
          quantity: number;
          technical_specification: string | null;
          tenant_id: string;
          unit: string;
          updated_at: string;
          updated_by: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          delivery_location?: string | null;
          description: string;
          estimated_total?: number | null;
          estimated_unit_price?: number | null;
          id?: string;
          is_active?: boolean;
          line_number: number;
          process_id: string;
          quantity: number;
          technical_specification?: string | null;
          tenant_id: string;
          unit: string;
          updated_at?: string;
          updated_by: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          delivery_location?: string | null;
          description?: string;
          estimated_total?: number | null;
          estimated_unit_price?: number | null;
          id?: string;
          is_active?: boolean;
          line_number?: number;
          process_id?: string;
          quantity?: number;
          technical_specification?: string | null;
          tenant_id?: string;
          unit?: string;
          updated_at?: string;
          updated_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "procurement_items_process_tenant_fk";
            columns: ["tenant_id", "process_id"];
            isOneToOne: false;
            referencedRelation: "procurement_processes";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      procurement_price_quotes: {
        Row: {
          created_at: string;
          created_by: string;
          delivery_cost: number;
          id: string;
          is_active: boolean;
          notes: string | null;
          procurement_item_id: string;
          quantity: number;
          quoted_at: string;
          reference_url: string | null;
          selected_for_estimate: boolean;
          source_name: string;
          supplier_id: string | null;
          tenant_id: string;
          total_price: number | null;
          unit_price: number;
          updated_at: string;
          updated_by: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          delivery_cost?: number;
          id?: string;
          is_active?: boolean;
          notes?: string | null;
          procurement_item_id: string;
          quantity: number;
          quoted_at?: string;
          reference_url?: string | null;
          selected_for_estimate?: boolean;
          source_name: string;
          supplier_id?: string | null;
          tenant_id: string;
          total_price?: number | null;
          unit_price: number;
          updated_at?: string;
          updated_by: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          delivery_cost?: number;
          id?: string;
          is_active?: boolean;
          notes?: string | null;
          procurement_item_id?: string;
          quantity?: number;
          quoted_at?: string;
          reference_url?: string | null;
          selected_for_estimate?: boolean;
          source_name?: string;
          supplier_id?: string | null;
          tenant_id?: string;
          total_price?: number | null;
          unit_price?: number;
          updated_at?: string;
          updated_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "procurement_price_quotes_item_tenant_fk";
            columns: ["tenant_id", "procurement_item_id"];
            isOneToOne: false;
            referencedRelation: "procurement_items";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "procurement_price_quotes_supplier_tenant_fk";
            columns: ["tenant_id", "supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      procurement_processes: {
        Row: {
          created_at: string;
          created_by: string;
          description: string | null;
          due_date: string | null;
          estimated_value: number | null;
          id: string;
          modality: string;
          number: string;
          priority: string;
          requesting_unit: string | null;
          responsible_name: string | null;
          stage: string;
          status: string;
          tenant_id: string;
          title: string;
          updated_at: string;
          updated_by: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          description?: string | null;
          due_date?: string | null;
          estimated_value?: number | null;
          id?: string;
          modality?: string;
          number: string;
          priority?: string;
          requesting_unit?: string | null;
          responsible_name?: string | null;
          stage?: string;
          status?: string;
          tenant_id: string;
          title: string;
          updated_at?: string;
          updated_by: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          description?: string | null;
          due_date?: string | null;
          estimated_value?: number | null;
          id?: string;
          modality?: string;
          number?: string;
          priority?: string;
          requesting_unit?: string | null;
          responsible_name?: string | null;
          stage?: string;
          status?: string;
          tenant_id?: string;
          title?: string;
          updated_at?: string;
          updated_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "procurement_processes_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          full_name: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          full_name: string;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          full_name?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      supplier_documents: {
        Row: {
          created_at: string;
          created_by: string;
          document_type: string;
          drive_file_id: string | null;
          expires_at: string | null;
          external_url: string | null;
          file_name: string | null;
          file_size: number | null;
          id: string;
          issue_date: string | null;
          mime_type: string | null;
          notes: string | null;
          status: string;
          storage_path: string | null;
          storage_provider: string;
          supplier_id: string;
          tenant_id: string;
          title: string;
          updated_at: string;
          updated_by: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          document_type?: string;
          drive_file_id?: string | null;
          expires_at?: string | null;
          external_url?: string | null;
          file_name?: string | null;
          file_size?: number | null;
          id?: string;
          issue_date?: string | null;
          mime_type?: string | null;
          notes?: string | null;
          status?: string;
          storage_path?: string | null;
          storage_provider?: string;
          supplier_id: string;
          tenant_id: string;
          title: string;
          updated_at?: string;
          updated_by?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          document_type?: string;
          drive_file_id?: string | null;
          expires_at?: string | null;
          external_url?: string | null;
          file_name?: string | null;
          file_size?: number | null;
          id?: string;
          issue_date?: string | null;
          mime_type?: string | null;
          notes?: string | null;
          status?: string;
          storage_path?: string | null;
          storage_provider?: string;
          supplier_id?: string;
          tenant_id?: string;
          title?: string;
          updated_at?: string;
          updated_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "supplier_documents_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_documents_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      suppliers: {
        Row: {
          category: string;
          city: string | null;
          cnpj: string;
          complement: string | null;
          contact_email: string | null;
          contact_name: string | null;
          contact_phone: string | null;
          created_at: string;
          created_by: string;
          id: string;
          legal_name: string;
          neighborhood: string | null;
          notes: string | null;
          postal_code: string | null;
          state: string | null;
          status: string;
          street: string | null;
          street_number: string | null;
          tenant_id: string;
          trade_name: string | null;
          updated_at: string;
          updated_by: string;
          website: string | null;
        };
        Insert: {
          category?: string;
          city?: string | null;
          cnpj: string;
          complement?: string | null;
          contact_email?: string | null;
          contact_name?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          created_by?: string;
          id?: string;
          legal_name: string;
          neighborhood?: string | null;
          notes?: string | null;
          postal_code?: string | null;
          state?: string | null;
          status?: string;
          street?: string | null;
          street_number?: string | null;
          tenant_id: string;
          trade_name?: string | null;
          updated_at?: string;
          updated_by?: string;
          website?: string | null;
        };
        Update: {
          category?: string;
          city?: string | null;
          cnpj?: string;
          complement?: string | null;
          contact_email?: string | null;
          contact_name?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          created_by?: string;
          id?: string;
          legal_name?: string;
          neighborhood?: string | null;
          notes?: string | null;
          postal_code?: string | null;
          state?: string | null;
          status?: string;
          street?: string | null;
          street_number?: string | null;
          tenant_id?: string;
          trade_name?: string | null;
          updated_at?: string;
          updated_by?: string;
          website?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "suppliers_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_invitations: {
        Row: {
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          invited_by: string;
          invited_email: string;
          invited_user_id: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          role_id: string;
          status: string;
          tenant_id: string;
        };
        Insert: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          invited_by: string;
          invited_email: string;
          invited_user_id?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          role_id: string;
          status?: string;
          tenant_id: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string;
          invited_email?: string;
          invited_user_id?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          role_id?: string;
          status?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_invitations_role_tenant_fk";
            columns: ["role_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenant_roles";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "tenant_invitations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_memberships: {
        Row: {
          created_at: string;
          id: string;
          status: Database["public"]["Enums"]["membership_status"];
          tenant_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          status?: Database["public"]["Enums"]["membership_status"];
          tenant_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          status?: Database["public"]["Enums"]["membership_status"];
          tenant_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenant_memberships_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_role_permissions: {
        Row: {
          created_at: string;
          permission_id: string;
          role_id: string;
        };
        Insert: {
          created_at?: string;
          permission_id: string;
          role_id: string;
        };
        Update: {
          created_at?: string;
          permission_id?: string;
          role_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_role_permissions_permission_id_fkey";
            columns: ["permission_id"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenant_role_permissions_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "tenant_roles";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_roles: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          is_system: boolean;
          name: string;
          slug: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_system?: boolean;
          name: string;
          slug: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_system?: boolean;
          name?: string;
          slug?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_roles_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenants: {
        Row: {
          billing_contact: string | null;
          billing_day: number;
          billing_email: string | null;
          cnpj: string | null;
          commercial_notes: string | null;
          commercial_status: string;
          contact_email: string | null;
          contact_phone: string | null;
          created_at: string;
          created_by: string;
          enabled_modules: Json;
          ibge_code: string | null;
          id: string;
          manager_name: string | null;
          max_users: number;
          monthly_fee: number;
          municipality: string | null;
          name: string;
          plan_tier: string;
          slug: string;
          state: string | null;
          status: Database["public"]["Enums"]["tenant_status"];
          street: string | null;
          trade_name: string | null;
          trial_ends_at: string | null;
          trial_starts_at: string | null;
          updated_at: string;
        };
        Insert: {
          billing_contact?: string | null;
          billing_day?: number;
          billing_email?: string | null;
          cnpj?: string | null;
          commercial_notes?: string | null;
          commercial_status?: string;
          contact_email?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          created_by: string;
          enabled_modules?: Json;
          ibge_code?: string | null;
          id?: string;
          manager_name?: string | null;
          max_users?: number;
          monthly_fee?: number;
          municipality?: string | null;
          name: string;
          plan_tier?: string;
          slug: string;
          state?: string | null;
          status?: Database["public"]["Enums"]["tenant_status"];
          street?: string | null;
          trade_name?: string | null;
          trial_ends_at?: string | null;
          trial_starts_at?: string | null;
          updated_at?: string;
        };
        Update: {
          billing_contact?: string | null;
          billing_day?: number;
          billing_email?: string | null;
          cnpj?: string | null;
          commercial_notes?: string | null;
          commercial_status?: string;
          contact_email?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          created_by?: string;
          enabled_modules?: Json;
          ibge_code?: string | null;
          id?: string;
          manager_name?: string | null;
          max_users?: number;
          monthly_fee?: number;
          municipality?: string | null;
          name?: string;
          plan_tier?: string;
          slug?: string;
          state?: string | null;
          status?: Database["public"]["Enums"]["tenant_status"];
          street?: string | null;
          trade_name?: string | null;
          trial_ends_at?: string | null;
          trial_starts_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      activate_my_platform_staff: { Args: never; Returns: boolean };
      can_manage_platform_staff: { Args: never; Returns: boolean };
      can_invite_platform_staff: { Args: { p_email: string }; Returns: boolean };
      can_manage_platform_support_team: { Args: never; Returns: boolean };
      get_my_platform_staff_access: {
        Args: never;
        Returns: {
          is_staff: boolean;
          staff_status: string | null;
          display_name: string | null;
          role_names: string[];
          permission_codes: string[];
        }[];
      };
      get_platform_staff_metrics: { Args: never; Returns: Json };
      list_platform_staff: {
        Args: never;
        Returns: {
          user_id: string;
          email: string;
          display_name: string;
          status: string;
          created_at: string;
          activated_at: string | null;
          role_ids: string[];
          role_names: string[];
        }[];
      };
      list_platform_staff_audit_events: {
        Args: { p_limit?: number };
        Returns: {
          id: string;
          action: string;
          entity: string;
          entity_id: string | null;
          created_at: string;
          actor_email: string | null;
          tenant_name: string | null;
        }[];
      };
      list_platform_staff_roles: {
        Args: never;
        Returns: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          is_system: boolean;
          is_active: boolean;
          permission_codes: string[];
          staff_count: number;
        }[];
      };
      list_platform_staff_tenants: {
        Args: never;
        Returns: {
          id: string;
          name: string;
          slug: string;
          status: string;
          commercial_status: string;
          plan_tier: string;
          monthly_fee: number | null;
          municipality: string | null;
          state: string | null;
          created_at: string;
        }[];
      };
      register_platform_staff: {
        Args: { p_user_id: string; p_email: string; p_display_name: string; p_role_ids: string[] };
        Returns: undefined;
      };
      save_platform_staff_role: {
        Args: {
          p_role_id: string | null;
          p_slug: string;
          p_name: string;
          p_description: string;
          p_permission_codes: string[];
        };
        Returns: string;
      };
      set_platform_staff_roles: {
        Args: { p_user_id: string; p_role_ids: string[] };
        Returns: undefined;
      };
      set_platform_staff_status: {
        Args: { p_user_id: string; p_status: string };
        Returns: undefined;
      };
      revoke_platform_staff_invitation: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      revoke_platform_support_invitation: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      accept_my_tenant_invitations: { Args: never; Returns: number };
      add_tenant_member: {
        Args: { p_role_id: string; p_tenant_id: string; p_user_id: string };
        Returns: string;
      };
      create_procurement_process_with_checklist: {
        Args: {
          p_description?: string;
          p_due_date?: string;
          p_estimated_value?: number;
          p_modality?: string;
          p_number: string;
          p_priority?: string;
          p_requesting_unit?: string;
          p_responsible_name?: string;
          p_tenant_id: string;
          p_title: string;
        };
        Returns: string;
      };
      create_tenant_invitation: {
        Args: { p_email: string; p_role_id: string; p_tenant_id: string };
        Returns: string;
      };
      create_tenant_with_admin: {
        Args: { p_admin_user_id: string; p_name: string; p_slug: string };
        Returns: Json;
      };
      create_tenant_with_admin_commercial: {
        Args: {
          p_admin_user_id: string;
          p_details: Json;
          p_name: string;
          p_slug: string;
        };
        Returns: Json;
      };
      find_tenant_user_by_email: {
        Args: { p_email: string; p_tenant_id: string };
        Returns: {
          full_name: string;
          user_id: string;
        }[];
      };
      generate_document_from_process: {
        Args: {
          p_overrides?: Json;
          p_process_id: string;
          p_template_id: string;
        };
        Returns: string;
      };
      get_document_capabilities: {
        Args: { p_tenant_id: string };
        Returns: {
          can_create: boolean;
          can_manage_templates: boolean;
          can_sign: boolean;
          can_update: boolean;
          can_view: boolean;
        }[];
      };
      get_platform_master_metrics: { Args: never; Returns: Json };
      get_supplier_capabilities: {
        Args: { p_tenant_id: string };
        Returns: {
          can_create: boolean;
          can_deactivate: boolean;
          can_update: boolean;
          can_view: boolean;
        }[];
      };
      get_tenant_settings_capabilities: {
        Args: { p_tenant_id: string };
        Returns: {
          can_edit: boolean;
          can_view: boolean;
        }[];
      };
      get_tenant_user_capabilities: {
        Args: { p_tenant_id: string };
        Returns: {
          can_assign_role: boolean;
          can_create: boolean;
          can_edit: boolean;
          can_suspend: boolean;
          can_view: boolean;
        }[];
      };
      install_document_template: {
        Args: { p_catalog_template_id: string; p_tenant_id: string };
        Returns: string;
      };
      is_valid_cnpj: { Args: { p_cnpj: string }; Returns: boolean };
      list_tenant_admin_candidates: {
        Args: never;
        Returns: {
          email: string;
          full_name: string;
          user_id: string;
        }[];
      };
      log_platform_admin_access_attempt: {
        Args: { p_route: string };
        Returns: undefined;
      };
      normalize_cnpj: { Args: { p_cnpj: string }; Returns: string };
      platform_billing_disconnect: {
        Args: { p_actor_id: string };
        Returns: Json;
      };
      platform_billing_save_credentials: {
        Args: {
          p_account_email: string;
          p_account_name: string;
          p_account_reference: string;
          p_actor_id: string;
          p_client_id: string;
          p_environment: string;
          p_provider: string;
          p_provider_other_name: string;
          p_public_key: string;
          p_secret_bundle: Json;
        };
        Returns: Json;
      };
      revoke_tenant_invitation: {
        Args: { p_invitation_id: string };
        Returns: undefined;
      };
      select_procurement_price_quote: {
        Args: { p_item_id: string; p_quote_id: string; p_tenant_id: string };
        Returns: undefined;
      };
      set_tenant_invitation_auth_user: {
        Args: { p_invitation_id: string; p_invited_user_id: string };
        Returns: undefined;
      };
      set_tenant_member_role: {
        Args: { p_membership_id: string; p_role_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      membership_status: "active" | "inactive" | "suspended" | "invited";
      tenant_status: "active" | "suspended" | "closed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      membership_status: ["active", "inactive", "suspended", "invited"],
      tenant_status: ["active", "suspended", "closed"],
    },
  },
} as const;
