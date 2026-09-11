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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          id: string
          metadata: Json
          reason: string | null
          target_id: string
          target_type: string
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string | null
          target_id: string
          target_type: string
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string | null
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          fivesim_country_code: string
          flag_emoji: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          fivesim_country_code: string
          flag_emoji: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          fivesim_country_code?: string
          flag_emoji?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          fetched_at: string
          id: string
          pair: string
          rate: number
          source: string
        }
        Insert: {
          fetched_at?: string
          id?: string
          pair: string
          rate: number
          source: string
        }
        Update: {
          fetched_at?: string
          id?: string
          pair?: string
          rate?: number
          source?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          completed_at: string | null
          country_code: string
          created_at: string
          expires_at: string
          fivesim_order_id: string
          id: string
          otp_code: string | null
          phone_number: string
          price_kobo: number
          service_id: string
          status: Database["public"]["Enums"]["order_status"]
          upstream_cost_kobo: number
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          country_code: string
          created_at?: string
          expires_at: string
          fivesim_order_id: string
          id?: string
          otp_code?: string | null
          phone_number: string
          price_kobo: number
          service_id: string
          status?: Database["public"]["Enums"]["order_status"]
          upstream_cost_kobo: number
          user_id: string
        }
        Update: {
          completed_at?: string | null
          country_code?: string
          created_at?: string
          expires_at?: string
          fivesim_order_id?: string
          id?: string
          otp_code?: string | null
          phone_number?: string
          price_kobo?: number
          service_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          upstream_cost_kobo?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_rules: {
        Row: {
          country_id: string | null
          id: string
          markup_type: Database["public"]["Enums"]["pricing_markup_type"]
          markup_value: Json
          min_margin_pct: number
          priority: number
          scope: Database["public"]["Enums"]["pricing_rule_scope"]
          service_id: string | null
          updated_at: string
        }
        Insert: {
          country_id?: string | null
          id?: string
          markup_type: Database["public"]["Enums"]["pricing_markup_type"]
          markup_value: Json
          min_margin_pct?: number
          priority: number
          scope: Database["public"]["Enums"]["pricing_rule_scope"]
          service_id?: string | null
          updated_at?: string
        }
        Update: {
          country_id?: string | null
          id?: string
          markup_type?: Database["public"]["Enums"]["pricing_markup_type"]
          markup_value?: Json
          min_margin_pct?: number
          priority?: number
          scope?: Database["public"]["Enums"]["pricing_rule_scope"]
          service_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_rules_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_rules_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          category: string
          fivesim_product_code: string
          icon_key: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          category: string
          fivesim_product_code: string
          icon_key?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          category?: string
          fivesim_product_code?: string
          icon_key?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_admin: boolean
          is_frozen: boolean
          username: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          is_admin?: boolean
          is_frozen?: boolean
          username: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_admin?: boolean
          is_frozen?: boolean
          username?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount_kobo: number
          created_at: string
          id: string
          metadata: Json
          order_id: string | null
          reference: string
          type: Database["public"]["Enums"]["wallet_transaction_type"]
          user_id: string
        }
        Insert: {
          amount_kobo: number
          created_at?: string
          id?: string
          metadata?: Json
          order_id?: string | null
          reference: string
          type: Database["public"]["Enums"]["wallet_transaction_type"]
          user_id: string
        }
        Update: {
          amount_kobo?: number
          created_at?: string
          id?: string
          metadata?: Json
          order_id?: string | null
          reference?: string
          type?: Database["public"]["Enums"]["wallet_transaction_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          balance_kobo: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance_kobo?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance_kobo?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_order_and_debit_wallet: {
        Args: {
          p_country_code: string
          p_expires_at: string
          p_fivesim_order_id: string
          p_metadata?: Json
          p_phone_number: string
          p_price_kobo: number
          p_service_id: string
          p_upstream_cost_kobo: number
          p_user_id: string
        }
        Returns: {
          completed_at: string | null
          country_code: string
          created_at: string
          expires_at: string
          fivesim_order_id: string
          id: string
          otp_code: string | null
          phone_number: string
          price_kobo: number
          service_id: string
          status: Database["public"]["Enums"]["order_status"]
          upstream_cost_kobo: number
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      order_status:
        | "pending"
        | "sms_received"
        | "expired_refunded"
        | "cancelled_refunded"
        | "banned"
      pricing_markup_type: "percent" | "flat_kobo" | "tiered"
      pricing_rule_scope: "global" | "service" | "country" | "service_country"
      wallet_transaction_type:
        | "topup"
        | "purchase"
        | "refund"
        | "admin_adjustment"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      order_status: [
        "pending",
        "sms_received",
        "expired_refunded",
        "cancelled_refunded",
        "banned",
      ],
      pricing_markup_type: ["percent", "flat_kobo", "tiered"],
      pricing_rule_scope: ["global", "service", "country", "service_country"],
      wallet_transaction_type: [
        "topup",
        "purchase",
        "refund",
        "admin_adjustment",
      ],
    },
  },
} as const
