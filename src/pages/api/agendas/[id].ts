import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireUser, jsonError, ApiError } from '../../../lib/api';
import {
  CATEGORY_VALUES,
  computeReminderAt,
  type AgendaRow,
  type ProfileRow,
} from '../../../lib/agenda';
import { sendPushToUsers } from '../../../lib/notify';

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  event_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .nullable(),
  end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .nullable(),
  category: z.enum(CATEGORY_VALUES).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  assignee: z.uuid().optional().nullable(),
  status: z.enum(['pending', 'done', 'cancelled']).optional(),
  reminder_enabled: z.boolean().optional(),
  reminder_minutes: z.number().int().min(0).max(10080).optional(),
  notify_partner: z.boolean().optional(),
});

async function fetchAgenda(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  id: string,
): Promise<AgendaRow> {
  const { data, error } = await supabase.from('agendas').select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Agenda tidak ditemukan.');
  return data as AgendaRow;
}

export const PATCH: APIRoute = async (context) => {
  try {
    const { supabase, user } = await requireUser(context);
    const id = context.params.id ?? '';
    const current = await fetchAgenda(supabase, id);

    const body = await context.request.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Data tidak valid.');
    }
    const input = parsed.data;

    const event_date = input.event_date ?? current.event_date;
    const start_time = input.start_time !== undefined ? input.start_time : current.start_time;
    if (input.start_time && input.end_time && input.end_time < input.start_time) {
      throw new ApiError(400, 'Jam selesai tidak boleh sebelum jam mulai.');
    }

    const patch: Record<string, unknown> = { ...input };
    delete patch.reminder_minutes;

    // Hitung ulang pengingat bila tanggal/jam/status pengingat berubah.
    const reminderRelevant =
      input.event_date !== undefined ||
      input.start_time !== undefined ||
      input.reminder_enabled !== undefined;
    if (reminderRelevant) {
      const reminderEnabled = input.reminder_enabled ?? current.reminder_enabled;
      if (!reminderEnabled) {
        patch.reminder_at = null;
        patch.reminder_sent_at = null;
      } else {
        const { data: prof } = await supabase
          .from('profiles')
          .select('default_reminder_minutes')
          .eq('id', user.id)
          .maybeSingle();
        const minutes =
          input.reminder_minutes ?? (prof as ProfileRow | null)?.default_reminder_minutes ?? 60;
        const nextReminder = computeReminderAt(event_date, start_time, minutes);
        // Pengingat lama hanya dipakai ulang kalau waktunya masih sama.
        patch.reminder_at = nextReminder;
        patch.reminder_sent_at =
          nextReminder === current.reminder_at ? current.reminder_sent_at : null;
      }
    }

    if (input.status !== undefined) {
      patch.completed_at =
        input.status === 'done' ? new Date().toISOString() : input.status === 'pending' ? null : current.completed_at;
      if (input.status !== 'pending') {
        patch.reminder_at = null;
        patch.reminder_sent_at = null;
      }
    }

    const { data, error } = await supabase
      .from('agendas')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new ApiError(500, error.message);
    const agenda = data as AgendaRow;

    const shouldNotify = input.notify_partner ?? current.notify_partner;
    const changed =
      input.title !== undefined ||
      input.event_date !== undefined ||
      input.start_time !== undefined ||
      input.status !== undefined;
    if (shouldNotify && changed) {
      const { data: others } = await supabase.from('profiles').select('id').neq('id', user.id);
      const targets = ((others ?? []) as { id: string }[]).map((r) => r.id);
      await sendPushToUsers(targets, {
        title: 'Agenda diperbarui ✨',
        body: `${agenda.title} · ${agenda.event_date}`,
        url: `/agenda?date=${agenda.event_date}`,
        tag: `agenda-${agenda.id}`,
      });
    }

    return Response.json({ agenda });
  } catch (err) {
    return jsonError(err);
  }
};

export const DELETE: APIRoute = async (context) => {
  try {
    const { supabase } = await requireUser(context);
    const id = context.params.id ?? '';
    await fetchAgenda(supabase, id);

    const { error } = await supabase.from('agendas').delete().eq('id', id);
    if (error) throw new ApiError(500, error.message);
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
};
