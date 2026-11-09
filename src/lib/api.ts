import type { APIContext } from 'astro';
import { createClient } from '../lib/supabase/server';

/** User dari sesi Supabase; lempar 401 kalau tidak ada. */
export async function requireUser(context: APIContext) {
  const supabase = createClient(context);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new ApiError(401, 'Belum masuk.');
  }
  return { supabase, user };
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function jsonError(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : 'Terjadi kesalahan.';
  console.error('[api]', error);
  return Response.json({ error: message }, { status: 500 });
}
