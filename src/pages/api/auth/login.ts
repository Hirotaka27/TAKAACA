import type { APIRoute } from 'astro';
import { createClient } from '../../../lib/supabase/server';
import { jsonError } from '../../../lib/api';

export const POST: APIRoute = async (context) => {
  try {
    const form = await context.request.formData();
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const password = String(form.get('password') ?? '');

    if (!email || !password) {
      return context.redirect('/login?error=' + encodeURIComponent('Email dan password wajib diisi.'));
    }

    const supabase = createClient(context);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      return context.redirect(
        '/login?error=' + encodeURIComponent(error?.message ?? 'Gagal masuk. Coba lagi.'),
      );
    }

    const want = String(form.get('next') ?? '');
    const next = want.startsWith('/') && !want.startsWith('//') ? want : '/';
    return context.redirect(next);
  } catch (err) {
    return jsonError(err);
  }
};
