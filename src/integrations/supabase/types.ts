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
      document_templates: {
        Row: {
          content: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_active: boolean
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_active?: boolean
          tenant_id: string
          title: string
          updated_at?: string
          updated_by?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_active?: boolean
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_templates_tenant_id_fkey"
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
          id: string
          signature_statement: string | null
          signed_at: string | null
          signed_by: string | null
          signed_email: string | null
          signed_name: string | null
          status: string
          supplier_id: string | null
          template_id: string | null
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          content_snapshot: string
          created_at?: string
          created_by?: string
          id?: string
          signature_statement?: string | null
          signed_at?: string | null
          signed_by?: string | null
          signed_email?: string | null
          signed_name?: string | null
          status?: string
          supplier_id?: string | null
          template_id?: string | null
          tenant_id: string
          title: string
          updated_at?: string
          updated_by?: string
        }
        Update: {
          content_snapshot?: string
          created_at?: string
          created_by?: string
          id?: string
          signature_statement?: string | null
          signed_at?: string | null
          signed_by?: string | null
          signed_email?: string | null
          signed_name?: string | null
          status?: string
          supplier_id?: string | null
          template_id?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
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
          id: string
          issue_date: string | null
          notes: string | null
          status: string
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
          id?: string
          issue_date?: string | null
          notes?: string | null
          status?: string
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
          id?: string
          issue_date?: string | null
          notes?: string | null
          status?: string
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
          cnpj: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          created_by: string
          id: string
          municipality: string | null
          name: string
          slug: string
          state: string | null
          status: Database["public"]["Enums"]["tenant_status"]
          street: string | null
          updated_at: string
        }
        Insert: {
          cnpj?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by: string
          id?: string
          municipality?: string | null
          name: string
          slug: string
          state?: string | null
          status?: Database["public"]["Enums"]["tenant_status"]
          street?: string | null
          updated_at?: string
        }
        Update: {
          cnpj?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string
          id?: string
          municipality?: string | null
          name?: string
          slug?: string
          state?: string | null
          status?: Database["public"]["Enums"]["tenant_status"]
          street?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_tenant_member: {
        Args: { p_role_id: string; p_tenant_id: string; p_user_id: string }
        Returns: string
      }
      create_tenant_with_admin: {
        Args: { p_admin_user_id: string; p_name: string; p_slug: string }
        Returns: Json
      }
      find_tenant_user_by_email: {
        Args: { p_email: string; p_tenant_id: string }
        Returns: {
          full_name: string
          user_id: string
        }[]
      }
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
      get_supplier_capabilities: {
        Args: { p_tenant_id: string }
        Returns: {
          can_create: boolean
          can_deactivate: boolean
          can_update: boolean
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
      is_valid_cnpj: { Args: { p_cnpj: string }; Returns: boolean }
      normalize_cnpj: { Args: { p_cnpj: string }; Returns: string }
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
