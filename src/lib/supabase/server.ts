import { createServerClient } from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export interface CookieContext {
  request: Request;
  cookies: AstroCookies;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** Baca semua cookie dari request (Astro tidak menyediakan `getAll`). */
function readRequestCookies(request: Request): { name: string; value: string }[] {
  const header = request.headers.get('cookie');
  if (!header) return [];
  return header
    .split(';')
    .map((part) => {
      const idx = part.indexOf('=');
      if (idx < 0) return null;
      const name = part.slice(0, idx).trim();
      const raw = part.slice(idx + 1).trim();
      if (!name) return null;
      try {
        return { name, value: decodeURIComponent(raw) };
      } catch {
        return { name, value: raw };
      }
    })
    .filter((c): c is { name: string; value: string } => c !== null);
}

export function createClient(context: CookieContext) {
  if (!SUPABASE_URL || /placeholder/i.test(SUPABASE_URL)) {
    throw new Error(
      'PUBLIC_SUPABASE_URL belum diisi di .env. Isi dengan https://<project-id>.supabase.co lalu restart dev server.',
    );
  }
  if (!SUPABASE_ANON_KEY || /placeholder/i.test(SUPABASE_ANON_KEY)) {
    throw new Error('PUBLIC_SUPABASE_ANON_KEY belum diisi di .env. Lalu restart dev server.');
  }
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return readRequestCookies(context.request);
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            context.cookies.set(name, value, {
              ...options,
              httpOnly: false,
              sameSite: 'lax',
              secure: import.meta.env.PROD,
            }),
          );
        } catch {
          // Dipanggil dari middleware: cookie diterapkan Astro ke response.
        }
      },
    },
  });
}

/** Client service-role. Hanya untuk kode server (cron, Storage, dsb). */
export function createServiceClient() {
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY belum di-set di environment server.');
  }
  if (/placeholder/i.test(key)) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY masih placeholder. Isi kunci asli di .env lalu restart dev server (astro dev stop && astro dev --background).',
    );
  }
  return createSupabaseClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
