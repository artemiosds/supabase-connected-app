export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          entity: string
          entity_id: string | null
          id: string
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity: string
          entity_id?: string | null
          id?: string
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity?: string
          entity_id?: string | null
          id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_amendments: {
        Row: {
          contract_id: string
          created_at: string
          created_by: string
          id: string
          kind: string
          new_end_date: string | null
          notes: string | null
          number: string
          signed_at: string
          tenant_id: string
          updated_at: string
          updated_by: string
          value_change: number
        }
        Insert: {
          contract_id: string
          created_at?: string
          created_by: string
          id?: string
          kind: string
          new_end_date?: string | null
          notes?: string | null
          number: string
          signed_at?: string
          tenant_id: string
          updated_at?: string
          updated_by: string
          value_change?: number
        }
        Update: {
          contract_id?: string
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          new_end_date?: string | null
          notes?: string | null
          number?: string
          signed_at?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string
          value_change?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_amendment_contract"
            columns: ["tenant_id", "contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      contracts: {
        Row: {
          created_at: string
          created_by: string
          end_date: string
          id: string
          inspector_name: string | null
          manager_name: string | null
          modality: string
          notes: string | null
          number: string
          object: string
          ordinance: string | null
          process_id: string | null
          start_date: string
          status: string
          supplier_id: string | null
          tenant_id: string
          total_value: number
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by: string
          end_date: string
          id?: string
          inspector_name?: string | null
          manager_name?: string | null
          modality?: string
          notes?: string | null
          number: string
          object: string
          ordinance?: string | null
          process_id?: string | null
          start_date: string
          status?: string
          supplier_id?: string | null
          tenant_id: string
          total_value?: number
          updated_at?: string
          updated_by: string
        }
        Update: {
          created_at?: string
          created_by?: string
          end_date?: string
          id?: string
          inspector_name?: string | null
          manager_name?: string | null
          modality?: string
          notes?: string | null
          number?: string
          object?: string
          ordinance?: string | null
          process_id?: string | null
          start_date?: string
          status?: string
          supplier_id?: string | null
          tenant_id?: string
          total_value?: number
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_contract_process"
            columns: ["tenant_id", "process_id"]
            isOneToOne: false
            referencedRelation: "procurement_processes"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "fk_contract_supplier"
            columns: ["tenant_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      document_template_catalog: {
        Row: {
          content: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          legal_basis: string
          source_reference: string
          template_code: string
          template_type: string
          title: string
          updated_at: string
          variables_schema: Json
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          legal_basis: string
          source_reference: string
          template_code: string
          template_type: string
          title: string
          updated_at?: string
          variables_schema?: Json
          version?: number
        }
        Update: {
          content?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          legal_basis?: string
          source_reference?: string
          template_code?: string
          template_type?: string
          title?: string
          updated_at?: string
          variables_schema?: Json
          version?: number
        }
        Relationships: []
      }
      document_template_versions: {
        Row: {
          change_summary: string | null
          content: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          legal_basis: string | null
          source_reference: string | null
          template_code: string | null
          template_id: string
          template_type: string
          tenant_id: string
          title: string
          variables_schema: Json
          version: number
        }
        Insert: {
          change_summary?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          legal_basis?: string | null
          source_reference?: string | null
          template_code?: string | null
          template_id: string
          template_type: string
          tenant_id: string
          title: string
          variables_schema?: Json
          version: number
        }
        Update: {
          change_summary?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          legal_basis?: string | null
          source_reference?: string | null
          template_code?: string | null
          template_id?: string
          template_type?: string
          tenant_id?: string
          title?: string
          variables_schema?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_template_versions_template_id_tenant_id_fkey"
            columns: ["template_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "document_template_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_templates: {
        Row: {
          catalog_template_id: string | null
          change_summary: string | null
          content: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_active: boolean
          is_base_template: boolean
          legal_basis: string | null
          source_reference: string | null
          template_code: string | null
          template_type: string
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string
          variables_schema: Json
          version: number
        }
        Insert: {
          catalog_template_id?: string | null
          change_summary?: string | null
          content: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_base_template?: boolean
          legal_basis?: string | null
          source_reference?: string | null
          template_code?: string | null
          template_type?: string
          tenant_id: string
          title: string
          updated_at?: string
          updated_by?: string
          variables_schema?: Json
          version?: number
        }
        Update: {
          catalog_template_id?: string | null
          change_summary?: string | null
          content?: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_base_template?: boolean
          legal_basis?: string | null
          source_reference?: string | null
          template_code?: string | null
          template_type?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string
          variables_schema?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_templates_catalog_template_id_fkey"
            columns: ["catalog_template_id"]
            isOneToOne: false
            referencedRelation: "document_template_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expiry_notification_deliveries: {
        Row: {
          alert_level: string
          attempts: number
          created_at: string
          due_on: string
          entity_id: string
          entity_type: string
          id: string
          last_error_code: string | null
          locked_at: string | null
          provider_message_id: string | null
          recipient_user_id: string
          sent_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          alert_level: string
          attempts?: number
          created_at?: string
          due_on: string
          entity_id: string
          entity_type: string
          id?: string
          last_error_code?: string | null
          locked_at?: string | null
          provider_message_id?: string | null
          recipient_user_id: string
          sent_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          alert_level?: string
          attempts?: number
          created_at?: string
          due_on?: string
          entity_id?: string
          entity_type?: string
          id?: string
          last_error_code?: string | null
          locked_at?: string | null
          provider_message_id?: string | null
          recipient_user_id?: string
          sent_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expiry_notification_deliveries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_documents: {
        Row: {
          content_snapshot: string
          created_at: string
          created_by: string
          document_type: string
          id: string
          process_id: string | null
          process_snapshot: Json
          signature_statement: string | null
          signed_at: string | null
          signed_by: string | null
          signed_email: string | null
          signed_name: string | null
          status: string
          supplier_id: string | null
          template_id: string | null
          template_version: number | null
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string
          variables_snapshot: Json
        }
        Insert: {
          content_snapshot: string
          created_at?: string
          created_by?: string
          document_type?: string
          id?: string
          process_id?: string | null
          process_snapshot?: Json
          signature_statement?: string | null
          signed_at?: string | null
          signed_by?: string | null
          signed_email?: string | null
          signed_name?: string | null
          status?: string
          supplier_id?: string | null
          template_id?: string | null
          template_version?: number | null
          tenant_id: string
          title: string
          updated_at?: string
          updated_by?: string
          variables_snapshot?: Json
        }
        Update: {
          content_snapshot?: string
          created_at?: string
          created_by?: string
          document_type?: string
          id?: string
          process_id?: string | null
          process_snapshot?: Json
          signature_statement?: string | null
          signed_at?: string | null
          signed_by?: string | null
          signed_email?: string | null
          signed_name?: string | null
          status?: string
          supplier_id?: string | null
          template_id?: string | null
          template_version?: number | null
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string
          variables_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_process_tenant_fk"
            columns: ["process_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "procurement_processes"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "generated_documents_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_roles: {
        Row: {
          created_at: string
          membership_id: string
          role_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          membership_id: string
          role_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          membership_id?: string
          role_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_membership_roles_membership_tenant"
            columns: ["membership_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_memberships"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "fk_membership_roles_role_tenant"
            columns: ["role_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_roles"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "membership_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          code: string
          created_at: string
          description: string
          id: string
          module: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          description: string
          id?: string
          module: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          id?: string
          module?: string
          name?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          granted_at: string
          granted_by: string | null
          is_active: boolean
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          is_active?: boolean
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          is_active?: boolean
          user_id?: string
        }
        Relationships: []
      }
      platform_payment_integrations: {
        Row: {
          account_email: string | null
          account_name: string
          account_reference: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          environment: string
          id: number
          payments_enabled: boolean
          provider: string
          provider_other_name: string | null
          public_key: string | null
          status: string
          updated_at: string
          updated_by: string | null
          vault_secret_id: string | null
        }
        Insert: {
          account_email?: string | null
          account_name: string
          account_reference?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          environment: string
          id?: number
          payments_enabled?: boolean
          provider: string
          provider_other_name?: string | null
          public_key?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          vault_secret_id?: string | null
        }
        Update: {
          account_email?: string | null
          account_name?: string
          account_reference?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          environment?: string
          id?: number
          payments_enabled?: boolean
          provider?: string
          provider_other_name?: string | null
          public_key?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          vault_secret_id?: string | null
        }
        Relationships: []
      }
      platform_staff: {
        Row: {
          activated_at: string | null
          created_at: string
          display_name: string
          email: string
          invited_by: string
          status: string
          suspended_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          display_name: string
          email: string
          invited_by: string
          status?: string
          suspended_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          display_name?: string
          email?: string
          invited_by?: string
          status?: string
          suspended_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_staff_permissions: {
        Row: {
          category: string
          code: string
          created_at: string
          description: string
          name: string
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          description: string
          name: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          description?: string
          name?: string
        }
        Relationships: []
      }
      platform_staff_role_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          role_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          role_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_staff_role_assignments_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "platform_staff_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_staff_role_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "platform_staff"
            referencedColumns: ["user_id"]
          },
        ]
      }
      platform_staff_role_permissions: {
        Row: {
          created_at: string
          permission_code: string
          role_id: string
        }
        Insert: {
          created_at?: string
          permission_code: string
          role_id: string
        }
        Update: {
          created_at?: string
          permission_code?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_staff_role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "platform_staff_permissions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "platform_staff_role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "platform_staff_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_staff_roles: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_support_agents: {
        Row: {
          created_at: string
          created_by: string
          display_name: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          display_name: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          display_name?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_support_assignments: {
        Row: {
          agent_user_id: string
          can_create_suppliers: boolean
          can_update_suppliers: boolean
          can_view_suppliers: boolean
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          agent_user_id: string
          can_create_suppliers?: boolean
          can_update_suppliers?: boolean
          can_view_suppliers?: boolean
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          agent_user_id?: string
          can_create_suppliers?: boolean
          can_update_suppliers?: boolean
          can_view_suppliers?: boolean
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_support_assignments_agent_user_id_fkey"
            columns: ["agent_user_id"]
            isOneToOne: false
            referencedRelation: "platform_support_agents"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "platform_support_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_support_sessions: {
        Row: {
          actor_id: string
          allowed_actions: string[]
          ended_at: string | null
          ended_by: string | null
          expires_at: string
          id: string
          reason: string
          started_at: string
          tenant_id: string
        }
        Insert: {
          actor_id: string
          allowed_actions?: string[]
          ended_at?: string | null
          ended_by?: string | null
          expires_at?: string
          id?: string
          reason: string
          started_at?: string
          tenant_id: string
        }
        Update: {
          actor_id?: string
          allowed_actions?: string[]
          ended_at?: string | null
          ended_by?: string | null
          expires_at?: string
          id?: string
          reason?: string
          started_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_support_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      process_items: {
        Row: {
          created_at: string
          created_by: string
          document_url: string | null
          id: string
          is_done: boolean
          process_id: string
          sort_order: number
          stage: string
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by: string
          document_url?: string | null
          id?: string
          is_done?: boolean
          process_id: string
          sort_order?: number
          stage: string
          tenant_id: string
          title: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          created_at?: string
          created_by?: string
          document_url?: string | null
          id?: string
          is_done?: boolean
          process_id?: string
          sort_order?: number
          stage?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_item_process"
            columns: ["tenant_id", "process_id"]
            isOneToOne: false
            referencedRelation: "procurement_processes"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      procurement_budget_allocations: {
        Row: {
          allocated_amount: number
          budget_action: string | null
          budget_unit: string
          created_at: string
          created_by: string
          expense_nature: string | null
          fiscal_year: number
          functional_program: string | null
          funding_source: string | null
          id: string
          is_active: boolean
          notes: string | null
          process_id: string
          tenant_id: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          allocated_amount: number
          budget_action?: string | null
          budget_unit: string
          created_at?: string
          created_by: string
          expense_nature?: string | null
          fiscal_year: number
          functional_program?: string | null
          funding_source?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          process_id: string
          tenant_id: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          allocated_amount?: number
          budget_action?: string | null
          budget_unit?: string
          created_at?: string
          created_by?: string
          expense_nature?: string | null
          fiscal_year?: number
          functional_program?: string | null
          funding_source?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          process_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_budget_allocations_process_tenant_fk"
            columns: ["tenant_id", "process_id"]
            isOneToOne: false
            referencedRelation: "procurement_processes"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      procurement_items: {
        Row: {
          created_at: string
          created_by: string
          delivery_location: string | null
          description: string
          estimated_total: number | null
          estimated_unit_price: number | null
          id: string
          is_active: boolean
          line_number: number
          process_id: string
          quantity: number
          technical_specification: string | null
          tenant_id: string
          unit: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by: string
          delivery_location?: string | null
          description: string
          estimated_total?: number | null
          estimated_unit_price?: number | null
          id?: string
          is_active?: boolean
          line_number: number
          process_id: string
          quantity: number
          technical_specification?: string | null
          tenant_id: string
          unit: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          created_at?: string
          created_by?: string
          delivery_location?: string | null
          description?: string
          estimated_total?: number | null
          estimated_unit_price?: number | null
          id?: string
          is_active?: boolean
          line_number?: number
          process_id?: string
          quantity?: number
          technical_specification?: string | null
          tenant_id?: string
          unit?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_items_process_tenant_fk"
            columns: ["tenant_id", "process_id"]
            isOneToOne: false
            referencedRelation: "procurement_processes"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      procurement_price_quotes: {
        Row: {
          created_at: string
          created_by: string
          contract_id: string | null
          delivery_cost: number
          id: string
          is_active: boolean
          notes: string | null
          procurement_item_id: string
          quantity: number
          quoted_at: string
          reference_url: string | null
          selected_for_estimate: boolean
          source_name: string
          supplier_id: string | null
          tenant_id: string
          total_price: number | null
          unit_price: number
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by: string
          contract_id?: string | null
          delivery_cost?: number
          id?: string
          is_active?: boolean
          notes?: string | null
          procurement_item_id: string
          quantity: number
          quoted_at?: string
          reference_url?: string | null
          selected_for_estimate?: boolean
          source_name: string
          supplier_id?: string | null
          tenant_id: string
          total_price?: number | null
          unit_price: number
          updated_at?: string
          updated_by: string
        }
        Update: {
          created_at?: string
          created_by?: string
          contract_id?: string | null
          delivery_cost?: number
          id?: string
          is_active?: boolean
          notes?: string | null
          procurement_item_id?: string
          quantity?: number
          quoted_at?: string
          reference_url?: string | null
          selected_for_estimate?: boolean
          source_name?: string
          supplier_id?: string | null
          tenant_id?: string
          total_price?: number | null
          unit_price?: number
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_price_quotes_item_tenant_fk"
            columns: ["tenant_id", "procurement_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_items"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "procurement_price_quotes_supplier_tenant_fk"
            columns: ["tenant_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      procurement_processes: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          estimated_value: number | null
          id: string
          modality: string
          number: string
          priority: string
          requesting_unit: string | null
          responsible_name: string | null
          stage: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          estimated_value?: number | null
          id?: string
          modality?: string
          number: string
          priority?: string
          requesting_unit?: string | null
          responsible_name?: string | null
          stage?: string
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          estimated_value?: number | null
          id?: string
          modality?: string
          number?: string
          priority?: string
          requesting_unit?: string | null
          responsible_name?: string | null
          stage?: string
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_processes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      supplier_documents: {
        Row: {
          created_at: string
          created_by: string
          document_type: string
          drive_file_id: string | null
          expires_at: string | null
          external_url: string | null
          file_name: string | null
          file_size: number | null
          id: string
          issue_date: string | null
          mime_type: string | null
          notes: string | null
          status: string
          storage_path: string | null
          storage_provider: string
          supplier_id: string
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          document_type?: string
          drive_file_id?: string | null
          expires_at?: string | null
          external_url?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          issue_date?: string | null
          mime_type?: string | null
          notes?: string | null
          status?: string
          storage_path?: string | null
          storage_provider?: string
          supplier_id: string
          tenant_id: string
          title: string
          updated_at?: string
          updated_by?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          document_type?: string
          drive_file_id?: string | null
          expires_at?: string | null
          external_url?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          issue_date?: string | null
          mime_type?: string | null
          notes?: string | null
          status?: string
          storage_path?: string | null
          storage_provider?: string
          supplier_id?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_documents_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          category: string
          city: string | null
          cnpj: string
          complement: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string
          id: string
          legal_name: string
          neighborhood: string | null
          notes: string | null
          postal_code: string | null
          state: string | null
          status: string
          street: string | null
          street_number: string | null
          tenant_id: string
          trade_name: string | null
          updated_at: string
          updated_by: string
          website: string | null
        }
        Insert: {
          category?: string
          city?: string | null
          cnpj: string
          complement?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string
          id?: string
          legal_name: string
          neighborhood?: string | null
          notes?: string | null
          postal_code?: string | null
          state?: string | null
          status?: string
          street?: string | null
          street_number?: string | null
          tenant_id: string
          trade_name?: string | null
          updated_at?: string
          updated_by?: string
          website?: string | null
        }
        Update: {
          category?: string
          city?: string | null
          cnpj?: string
          complement?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string
          id?: string
          legal_name?: string
          neighborhood?: string | null
          notes?: string | null
          postal_code?: string | null
          state?: string | null
          status?: string
          street?: string | null
          street_number?: string | null
          tenant_id?: string
          trade_name?: string | null
          updated_at?: string
          updated_by?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          expires_at: string
          id: string
          invited_by: string
          invited_email: string
          invited_user_id: string | null
          revoked_at: string | null
          revoked_by: string | null
          role_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invited_by: string
          invited_email: string
          invited_user_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          role_id: string
          status?: string
          tenant_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invited_by?: string
          invited_email?: string
          invited_user_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          role_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_invitations_role_tenant_fk"
            columns: ["role_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_roles"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "tenant_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          created_at: string
          id: string
          status: Database["public"]["Enums"]["membership_status"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["membership_status"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["membership_status"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_role_permissions: {
        Row: {
          created_at: string
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "tenant_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          name: string
          slug: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          slug: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          slug?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          billing_contact: string | null
          billing_day: number
          billing_email: string | null
          cnpj: string | null
          commercial_notes: string | null
          commercial_status: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          created_by: string
          enabled_modules: Json
          ibge_code: string | null
          id: string
          manager_name: string | null
          max_users: number
          monthly_fee: number
          municipality: string | null
          name: string
          plan_tier: string
          slug: string
          state: string | null
          status: Database["public"]["Enums"]["tenant_status"]
          street: string | null
          trade_name: string | null
          trial_ends_at: string | null
          trial_starts_at: string | null
          updated_at: string
        }
        Insert: {
          billing_contact?: string | null
          billing_day?: number
          billing_email?: string | null
          cnpj?: string | null
          commercial_notes?: string | null
          commercial_status?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by: string
          enabled_modules?: Json
          ibge_code?: string | null
          id?: string
          manager_name?: string | null
          max_users?: number
          monthly_fee?: number
          municipality?: string | null
          name: string
          plan_tier?: string
          slug: string
          state?: string | null
          status?: Database["public"]["Enums"]["tenant_status"]
          street?: string | null
          trade_name?: string | null
          trial_ends_at?: string | null
          trial_starts_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_contact?: string | null
          billing_day?: number
          billing_email?: string | null
          cnpj?: string | null
          commercial_notes?: string | null
          commercial_status?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string
          enabled_modules?: Json
          ibge_code?: string | null
          id?: string
          manager_name?: string | null
          max_users?: number
          monthly_fee?: number
          municipality?: string | null
          name?: string
          plan_tier?: string
          slug?: string
          state?: string | null
          status?: Database["public"]["Enums"]["tenant_status"]
          street?: string | null
          trade_name?: string | null
          trial_ends_at?: string | null
          trial_starts_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_my_tenant_invitations: { Args: never; Returns: number }
      activate_my_platform_staff: { Args: never; Returns: boolean }
      activate_my_platform_support_agent: { Args: never; Returns: boolean }
      add_platform_support_agent: {
        Args: { p_display_name: string; p_user_id: string }
        Returns: undefined
      }
      add_tenant_member: {
        Args: { p_role_id: string; p_tenant_id: string; p_user_id: string }
        Returns: string
      }
      can_invite_platform_staff: { Args: { p_email: string }; Returns: boolean }
      can_manage_platform_staff: { Args: never; Returns: boolean }
      can_manage_platform_support_team: { Args: never; Returns: boolean }
      claim_expiry_notification_delivery: {
        Args: { p_delivery_id: string }
        Returns: {
          alert_level: string
          attempts: number
          due_on: string
          entity_id: string
          entity_type: string
          id: string
          recipient_user_id: string
          tenant_id: string
        }[]
      }
      create_procurement_process_with_checklist: {
        Args: {
          p_description?: string
          p_due_date?: string
          p_estimated_value?: number
          p_modality?: string
          p_number: string
          p_priority?: string
          p_requesting_unit?: string
          p_responsible_name?: string
          p_tenant_id: string
          p_title: string
        }
        Returns: string
      }
      create_tenant_invitation: {
        Args: { p_email: string; p_role_id: string; p_tenant_id: string }
        Returns: string
      }
      create_tenant_with_admin: {
        Args: { p_admin_user_id: string; p_name: string; p_slug: string }
        Returns: Json
      }
      create_tenant_with_admin_commercial: {
        Args: {
          p_admin_user_id: string
          p_details: Json
          p_name: string
          p_slug: string
        }
        Returns: Json
      }
      end_platform_support_session: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      find_tenant_user_by_email: {
        Args: { p_email: string; p_tenant_id: string }
        Returns: {
          full_name: string
          user_id: string
        }[]
      }
      finish_expiry_notification_delivery: {
        Args: {
          p_delivery_id: string
          p_error_code?: string
          p_provider_message_id?: string
          p_status: string
        }
        Returns: boolean
      }
      generate_document_from_process: {
        Args: {
          p_overrides?: Json
          p_process_id: string
          p_template_id: string
        }
        Returns: string
      }
      get_document_workflow_capabilities: { Args: { p_tenant_id: string }; Returns: { can_approve: boolean; can_submit: boolean }[] }
      get_tenant_role_management_capability: { Args: { p_tenant_id: string }; Returns: boolean }
      list_generated_document_workflows: { Args: { p_tenant_id: string }; Returns: { decided_at: string | null; decided_by: string | null; decision_comment: string | null; document_id: string; events: Json; status: string; submitted_at: string | null; submitted_by: string | null }[] }
      transition_generated_document_workflow: { Args: { p_action: string; p_comment?: string | null; p_document_id: string; p_tenant_id: string }; Returns: string }
      save_tenant_role_with_permissions: { Args: { p_description: string | null; p_name: string; p_permission_ids: string[]; p_role_id: string | null; p_slug: string; p_tenant_id: string }; Returns: string }
      get_document_capabilities: {
        Args: { p_tenant_id: string }
        Returns: {
          can_create: boolean
          can_manage_templates: boolean
          can_sign: boolean
          can_update: boolean
          can_view: boolean
        }[]
      }
      get_my_platform_staff_access: {
        Args: never
        Returns: {
          display_name: string
          is_staff: boolean
          permission_codes: string[]
          role_names: string[]
          staff_status: string
        }[]
      }
      get_my_platform_support_status: {
        Args: never
        Returns: {
          agent_status: string
          allowed_actions: string[]
          expires_at: string
          is_agent: boolean
          is_platform_admin: boolean
          reason: string
          session_id: string
          tenant_id: string
          tenant_name: string
        }[]
      }
      get_platform_master_metrics: { Args: never; Returns: Json }
      get_platform_staff_metrics: { Args: never; Returns: Json }
      get_supplier_capabilities: {
        Args: { p_tenant_id: string }
        Returns: {
          can_create: boolean
          can_deactivate: boolean
          can_update: boolean
          can_view: boolean
        }[]
      }
      get_tenant_settings_capabilities: {
        Args: { p_tenant_id: string }
        Returns: {
          can_edit: boolean
          can_view: boolean
        }[]
      }
      get_tenant_user_capabilities: {
        Args: { p_tenant_id: string }
        Returns: {
          can_assign_role: boolean
          can_create: boolean
          can_edit: boolean
          can_suspend: boolean
          can_view: boolean
        }[]
      }
      install_document_template: {
        Args: { p_catalog_template_id: string; p_tenant_id: string }
        Returns: string
      }
      is_valid_cnpj: { Args: { p_cnpj: string }; Returns: boolean }
      list_my_platform_support_tenants: {
        Args: never
        Returns: {
          commercial_status: string
          enabled_modules: Json
          id: string
          monthly_fee: number
          name: string
          plan_tier: string
          slug: string
          status: string
          trial_ends_at: string
          trial_starts_at: string
        }[]
      }
      list_my_platform_support_tenants_safe: {
        Args: never
        Returns: {
          id: string
          name: string
          slug: string
          status: string
        }[]
      }
      list_platform_staff: {
        Args: never
        Returns: {
          activated_at: string
          created_at: string
          display_name: string
          email: string
          role_ids: string[]
          role_names: string[]
          status: string
          user_id: string
        }[]
      }
      list_platform_staff_audit_events: {
        Args: { p_limit?: number }
        Returns: {
          action: string
          actor_email: string
          created_at: string
          entity: string
          entity_id: string
          id: string
          tenant_name: string
        }[]
      }
      list_platform_staff_roles: {
        Args: never
        Returns: {
          description: string
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          permission_codes: string[]
          slug: string
          staff_count: number
        }[]
      }
      list_platform_staff_tenants: {
        Args: never
        Returns: {
          commercial_status: string
          created_at: string
          id: string
          monthly_fee: number
          municipality: string
          name: string
          plan_tier: string
          slug: string
          state: string
          status: string
        }[]
      }
      list_platform_support_assignments: {
        Args: { p_agent_user_id: string }
        Returns: {
          can_create_suppliers: boolean
          can_update_suppliers: boolean
          can_view_suppliers: boolean
          is_active: boolean
          tenant_id: string
          tenant_name: string
        }[]
      }
      list_platform_support_candidates: {
        Args: never
        Returns: {
          display_name: string
          email: string
          user_id: string
        }[]
      }
      list_platform_support_team: {
        Args: never
        Returns: {
          assignment_count: number
          display_name: string
          email: string
          status: string
          user_id: string
        }[]
      }
      list_tenant_admin_candidates: {
        Args: never
        Returns: {
          email: string
          full_name: string
          user_id: string
        }[]
      }
      log_platform_admin_access_attempt: {
        Args: { p_route: string }
        Returns: undefined
      }
      normalize_cnpj: { Args: { p_cnpj: string }; Returns: string }
      platform_billing_disconnect: {
        Args: { p_actor_id: string }
        Returns: Json
      }
      platform_billing_save_credentials: {
        Args: {
          p_account_email: string
          p_account_name: string
          p_account_reference: string
          p_actor_id: string
          p_client_id: string
          p_environment: string
          p_provider: string
          p_provider_other_name: string
          p_public_key: string
          p_secret_bundle: Json
        }
        Returns: Json
      }
      register_platform_staff: {
        Args: {
          p_display_name: string
          p_email: string
          p_role_ids: string[]
          p_user_id: string
        }
        Returns: undefined
      }
      register_platform_support_agent: {
        Args: {
          p_can_create_suppliers?: boolean
          p_can_update_suppliers?: boolean
          p_can_view_suppliers?: boolean
          p_display_name: string
          p_email: string
          p_tenant_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      revoke_platform_staff_invitation: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      revoke_platform_support_invitation: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      revoke_tenant_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      save_platform_staff_role: {
        Args: {
          p_description: string
          p_name: string
          p_permission_codes: string[]
          p_role_id: string
          p_slug: string
        }
        Returns: string
      }
      select_procurement_price_quote: {
        Args: { p_item_id: string; p_quote_id: string; p_tenant_id: string }
        Returns: undefined
      }
      set_platform_staff_roles: {
        Args: { p_role_ids: string[]; p_user_id: string }
        Returns: undefined
      }
      set_platform_staff_status: {
        Args: { p_status: string; p_user_id: string }
        Returns: undefined
      }
      set_platform_support_agent_status: {
        Args: { p_status: string; p_user_id: string }
        Returns: undefined
      }
      set_platform_support_assignment: {
        Args: {
          p_agent_user_id: string
          p_can_create_suppliers?: boolean
          p_can_update_suppliers?: boolean
          p_can_view_suppliers?: boolean
          p_is_active: boolean
          p_tenant_id: string
        }
        Returns: undefined
      }
      set_tenant_invitation_auth_user: {
        Args: { p_invitation_id: string; p_invited_user_id: string }
        Returns: undefined
      }
      set_tenant_member_role: {
        Args: { p_membership_id: string; p_role_id: string }
        Returns: undefined
      }
      start_platform_support_session: {
        Args: { p_reason: string; p_tenant_id: string }
        Returns: {
          expires_at: string
          session_id: string
        }[]
      }
    }
    Enums: {
      membership_status: "active" | "inactive" | "suspended" | "invited"
      tenant_status: "active" | "suspended" | "closed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      membership_status: ["active", "inactive", "suspended", "invited"],
      tenant_status: ["active", "suspended", "closed"],
    },
  },
} as const
