import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireUser, jsonError, ApiError } from '../../../lib/api';

const subscribeSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({
    p256dh: z.string().min(10).max(300),
    auth: z.string().min(5).max(100),
  }),
});

export const POST: APIRoute = async (context) => {
  try {
    const { supabase, user } = await requireUser(context);
    const body = await context.request.json().catch(() => null);
    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, 'Subscription tidak valid.');
    }

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        user_agent: context.request.headers.get('user-agent')?.slice(0, 300) ?? null,
      },
      { onConflict: 'endpoint' },
    );

    if (error) throw new ApiError(500, error.message);
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
};

export const DELETE: APIRoute = async (context) => {
  try {
    const { supabase, user } = await requireUser(context);
    const endpoint = context.url.searchParams.get('endpoint');
    if (!endpoint) throw new ApiError(400, 'Endpoint wajib diisi.');

    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .eq('user_id', user.id);
    if (error) throw new ApiError(500, error.message);
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
};
