import { createClient } from '@supabase/supabase-js';
const config = import.meta.env as Record<string,string|undefined>;
export const configured = Boolean(config.VITE_SUPABASE_URL && config.VITE_SUPABASE_PUBLISHABLE_KEY);
export const db = configured ? createClient(config.VITE_SUPABASE_URL!,config.VITE_SUPABASE_PUBLISHABLE_KEY!) : null;
