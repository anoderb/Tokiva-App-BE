import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';

/**
 * Supabase Admin Client (Service Role)
 * Melewati Row Level Security (RLS) untuk operasi backend server.
 */
export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Supabase Auth Client (Anon Key)
 * Digunakan khusus untuk verifikasi kredensial signInWithPassword
 * agar tidak mencemari sesi internal supabaseAdmin.
 */
export const supabaseAuth = createClient(
  config.supabase.url,
  config.supabase.anonKey || config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

