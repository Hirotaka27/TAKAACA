import type { APIRoute } from 'astro';
import { createServiceClient } from '../../../lib/supabase/server';
import { sendPushToUsers } from '../../../lib/notify';
import { formatDateWib, type AgendaRow } from '../../../lib/agenda';

/**
 * Dijalankan Supabase Cron tiap menit (lihat supabase/migrations/0002_cron.sql).
 * Vercel Hobby hanya mendukung cron sekali sehari, jadi penjadwalan dipindah
 * ke pg_cron Supabase yang tersedia di semua plan.
 */
export const GET: APIRoute = async ({ request }) => {
  const secret = import.meta.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET belum di-set.' }, { status: 503 });
  }

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const nowIso = new Date().toISOString();
    const cutoff = new Date(Date.now() - 2 * 86400000).toISOString();

    const { data: due, error } = await supabase
      .from('agendas')
      .select('*')
      .eq('status', 'pending')
      .eq('reminder_enabled', true)
      .lte('reminder_at', nowIso)
      .gte('reminder_at', cutoff)
      .is('reminder_sent_at', null)
      .limit(50);

    if (error) throw new Error(error.message);

    const agendas = (due ?? []) as AgendaRow[];
    if (agendas.length === 0) {
      return Response.json({ ok: true, sent: 0 });
    }

    const { data: profiles } = await supabase.from('profiles').select('id');
    const allUserIds = ((profiles ?? []) as { id: string }[]).map((p) => p.id);

    let sent = 0;
    for (const agenda of agendas) {
      const targets = agenda.assignee ? [agenda.assignee] : allUserIds;
      const when = agenda.start_time
        ? `${agenda.start_time} WIB`
        : 'pukul 09.00 WIB';
      await sendPushToUsers(targets, {
        title: `Pengingat: ${agenda.title} 💛`,
        body: `${formatDateWib(agenda.event_date)} · ${when}`,
        url: `/agenda?date=${agenda.event_date}`,
        tag: `reminder-${agenda.id}`,
      });
      sent++;

      await supabase
        .from('agendas')
        .update({ reminder_sent_at: nowIso })
        .eq('id', agenda.id)
        .is('reminder_sent_at', null);
    }

    return Response.json({ ok: true, sent });
  } catch (err) {
    console.error('[cron/reminders]', err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'Gagal' },
      { status: 500 },
    );
  }
};
