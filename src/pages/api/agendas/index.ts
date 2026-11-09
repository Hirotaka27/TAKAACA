import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireUser, jsonError, ApiError } from '../../../lib/api';
import {
  CATEGORY_VALUES,
  computeReminderAt,
  type ProfileRow,
  type AgendaRow,
} from '../../../lib/agenda';
import { sendPushToUsers } from '../../../lib/notify';

export const agendaSchema = z.object({
  title: z.string().trim().min(1, 'Nama agenda wajib diisi.').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD.'),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Format jam harus HH:MM.')
    .optional()
    .nullable(),
  end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Format jam harus HH:MM.')
    .optional()
    .nullable(),
  category: z.enum(CATEGORY_VALUES).default('task'),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  assignee: z.uuid().optional().nullable(),
  reminder_enabled: z.boolean().default(true),
  reminder_minutes: z.number().int().min(0).max(10080).optional(),
  notify_partner: z.boolean().default(true),
});

async function defaultReminderMinutes(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from('profiles')
    .select('default_reminder_minutes')
    .eq('id', userId)
    .maybeSingle();
  return (data as ProfileRow | null)?.default_reminder_minutes ?? 60;
}

export const GET: APIRoute = async (context) => {
  try {
    const { supabase } = await requireUser(context);
    const from = context.url.searchParams.get('from');
    const to = context.url.searchParams.get('to');

    let query = supabase
      .from('agendas')
      .select('*')
      .order('event_date', { ascending: true })
      .order('start_time', { ascending: true });
    if (from) query = query.gte('event_date', from);
    if (to) query = query.lte('event_date', to);

    const { data, error } = await query;
    if (error) throw new ApiError(500, error.message);
    return Response.json({ agendas: (data ?? []) as AgendaRow[] });
  } catch (err) {
    return jsonError(err);
  }
};

export const POST: APIRoute = async (context) => {
  try {
    const { supabase, user } = await requireUser(context);
    const body = await context.request.json().catch(() => null);
    const parsed = agendaSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Data tidak valid.');
    }
    const input = parsed.data;

    if (input.start_time && input.end_time && input.end_time < input.start_time) {
      throw new ApiError(400, 'Jam selesai tidak boleh sebelum jam mulai.');
    }

    const defaultMinutes = await defaultReminderMinutes(supabase, user.id);
    const reminderAt = input.reminder_enabled
      ? computeReminderAt(input.event_date, input.start_time, input.reminder_minutes ?? defaultMinutes)
      : null;

    const { data, error } = await supabase
      .from('agendas')
      .insert({
        title: input.title,
        description: input.description ?? null,
        event_date: input.event_date,
        start_time: input.start_time ?? null,
        end_time: input.end_time ?? null,
        category: input.category,
        priority: input.priority,
        assignee: input.assignee ?? null,
        reminder_enabled: input.reminder_enabled,
        reminder_at: reminderAt,
        notify_partner: input.notify_partner,
        created_by: user.id,
      })
      .select('*')
      .single();

    if (error) throw new ApiError(500, error.message);
    const agenda = data as AgendaRow;

    if (input.notify_partner) {
      const { data: others } = await supabase.from('profiles').select('id').neq('id', user.id);
      const targets = ((others ?? []) as { id: string }[]).map((r) => r.id);
      await sendPushToUsers(targets, {
        title: 'Agenda baru 💕',
        body: `${agenda.title} · ${agenda.event_date}`,
        url: `/agenda?date=${agenda.event_date}`,
        tag: `agenda-${agenda.id}`,
      });
    }

    return Response.json({ agenda }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
};
