import type { APIRoute } from 'astro';
import { createClient } from '../../../lib/supabase/server';

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context);
  await supabase.auth.signOut();
  return context.redirect('/login');
};
