'use client';
import { createBrowserClient } from '@supabase/ssr';
import { envPublique } from '@/lib/env';
import type { Database } from './types';

/** Client Supabase côté navigateur (clé publique ; la RLS fait la loi). */
export function clientNavigateur() {
  return createBrowserClient<Database>(
    envPublique.NEXT_PUBLIC_SUPABASE_URL,
    envPublique.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
