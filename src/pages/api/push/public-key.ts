import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
  const key = import.meta.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return Response.json({ error: 'Push belum dikonfigurasi di server.' }, { status: 503 });
  }
  return Response.json({ publicKey: key });
};
