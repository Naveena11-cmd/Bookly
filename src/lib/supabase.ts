import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes('your-project.supabase.co') &&
  !supabaseAnonKey.includes('your-supabase-anon-key')
);

// Fallback dummy URL to prevent createClient constructor from crashing if env is not configured yet
const resolvedUrl = isSupabaseConfigured ? supabaseUrl : 'https://placeholder-project.supabase.co';
const resolvedKey = isSupabaseConfigured ? supabaseAnonKey : 'placeholder-anon-key';

export const supabase = createClient(resolvedUrl, resolvedKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export interface Business {
  id: string;
  owner_user_id: string;
  name: string;
  slug: string;
  timezone: string;
  phone?: string | null;
  email?: string | null;
  status: 'active' | 'suspended';
  created_at: string;
}

export interface Service {
  id: string;
  business_id: string;
  name: string;
  description?: string | null;
  duration_minutes: number;
  price_cents: number;
  active: boolean;
  created_at: string;
}

export interface Provider {
  id: string;
  business_id: string;
  name: string;
  active: boolean;
}

export interface Client {
  id: string;
  business_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface Booking {
  id: string;
  business_id: string;
  service_id: string;
  provider_id: string;
  client_id: string;
  starts_at: string;
  ends_at: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  price_cents: number;
  source: string;
  notes?: string | null;
  created_at: string;
  service?: Pick<Service, 'name' | 'duration_minutes'>;
  provider?: Pick<Provider, 'name'>;
  client?: Pick<Client, 'name' | 'email' | 'phone'>;
}

export interface ClientStat {
  id: string;
  business_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  lifetime_value_cents: number;
  completed_count: number;
  total_bookings: number;
  last_appointment?: string | null;
  next_appointment?: string | null;
}

export interface DashboardSummary {
  today: number;
  upcoming: number;
  revenue_cents: number;
  clients: number;
  no_show_rate: number;
}
