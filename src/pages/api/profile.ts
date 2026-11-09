import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireUser, jsonError, ApiError } from '../../lib/api';

const schema = z.object({
  display_name: z.string().trim().min(1, 'Nama wajib diisi.').max(60),
  avatar_emoji: z.string().trim().min(1).max(8),
  anniversary_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  default_reminder_minutes: z.number().int().min(0).max(10080),
});

export const PATCH: APIRoute = async (context) => {
  try {
    const { supabase, user } = await requireUser(context);
    const body = await context.request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Data tidak valid.');
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: parsed.data.display_name,
        avatar_emoji: parsed.data.avatar_emoji,
        anniversary_date: parsed.data.anniversary_date || null,
        default_reminder_minutes: parsed.data.default_reminder_minutes,
      })
      .eq('id', user.id);

    if (error) throw new ApiError(500, error.message);
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
};
