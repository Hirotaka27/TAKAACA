import { defineMiddleware } from 'astro:middleware';
import { createClient } from './lib/supabase/server';

const PUBLIC_PAGES = ['/login'];
const PUBLIC_FILES = ['/manifest.webmanifest', '/sw.js', '/favicon.ico', '/favicon.svg'];
const PUBLIC_APIS = ['/api/auth/login', '/api/cron/reminders'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PAGES.includes(pathname)) return true;
  if (PUBLIC_FILES.includes(pathname)) return true;
  if (pathname.startsWith('/icons/')) return true;
  if (pathname.startsWith('/_astro/')) return true;
  return PUBLIC_APIS.some((p) => pathname === p);
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (isPublic(pathname)) {
    context.locals.user = null;
    return next();
  }

  const supabase = createClient(context);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  context.locals.user = user;

  if (!user) {
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Belum masuk.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return context.redirect('/login');
  }

  if (pathname === '/login') {
    return context.redirect('/');
  }

  return next();
});
