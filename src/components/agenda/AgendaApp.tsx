import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgendaRow, AgendaStatus, Category, Priority, ProfileRow } from '../../lib/agenda';
import {
  CATEGORY_CHIP,
  CATEGORY_DOT,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  PRIORITY_LABEL,
  STATUS_LABEL,
  formatDateWib,
  todayWib,
} from '../../lib/agenda';
import { getBrowserClient } from '../../lib/supabase/client';

interface Props {
  initialAgendas: AgendaRow[];
  profiles: ProfileRow[];
  meId: string;
  defaultReminderMinutes: number;
}

type Filter = 'all' | 'mine' | 'partner' | 'both';

const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toKey(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function monthMatrix(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startWeekday = (first.getUTCDay() + 6) % 7; // Senin = 0
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toKey(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

const emptyForm = (date: string) => ({
  title: '',
  description: '',
  event_date: date,
  start_time: '',
  end_time: '',
  category: 'task' as Category,
  priority: 'normal' as Priority,
  assignee: '' as string,
  reminder_enabled: true,
  reminder_minutes: 60,
  notify_partner: true,
});

type FormState = ReturnType<typeof emptyForm>;

export default function AgendaApp({ initialAgendas, profiles, meId, defaultReminderMinutes }: Props) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [selected, setSelected] = useState<string>(() => todayWib());
  const [agendas, setAgendas] = useState<AgendaRow[]>(initialAgendas);
  const [filter, setFilter] = useState<Filter>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | AgendaStatus>('all');
  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const partner = profiles.find((p) => p.id !== meId) ?? null;
  const me = profiles.find((p) => p.id === meId) ?? null;

  const nameOf = useCallback(
    (id: string | null | undefined) => {
      if (!id) return 'Kita';
      const p = profiles.find((x) => x.id === id);
      if (!p) return 'Kita';
      const label = p.id === meId ? (p.display_name ?? 'Aku') : (p.display_name ?? 'Pasangan');
      return `${p.avatar_emoji} ${label}`;
    },
    [profiles, meId],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agendas');
      if (!res.ok) return;
      const data = (await res.json()) as { agendas: AgendaRow[] };
      setAgendas(data.agendas);
    } catch {
      /* abaikan */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Baca ?date= dari URL setelah halaman siap (aman untuk SSR).
  useEffect(() => {
    const dateParam = new URLSearchParams(window.location.search).get('date');
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      setSelected(dateParam);
      const [y, m] = dateParam.split('-').map(Number);
      setCursor({ y, m });
    }
  }, []);

  // Realtime: perubahan dari pasangan langsung muncul.
  useEffect(() => {
    if (!import.meta.env.PUBLIC_SUPABASE_URL) return;
    let channel: ReturnType<ReturnType<typeof getBrowserClient>['channel']> | null = null;
    try {
      const supabase = getBrowserClient();
      channel = supabase
        .channel('agendas-realtime')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'agendas' },
          () => void load(),
        )
        .subscribe();
    } catch {
      /* tanpa realtime pun tetap jalan */
    }
    return () => {
      if (channel) {
        try {
          channel.unsubscribe();
        } catch {
          /* noop */
        }
      }
    };
  }, [load]);

  const monthAgendas = useMemo(
    () =>
      agendas.filter((a) => {
        const [y, m] = a.event_date.split('-').map(Number);
        return y === cursor.y && m === cursor.m;
      }),
    [agendas, cursor],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, AgendaRow[]>();
    for (const a of monthAgendas) {
      const list = map.get(a.event_date) ?? [];
      list.push(a);
      map.set(a.event_date, list);
    }
    return map;
  }, [monthAgendas]);

  const rows = useMemo(() => {
    return agendas.filter((a) => {
      if (a.event_date !== selected) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (filter === 'mine') return a.created_by === meId || a.assignee === meId;
      if (filter === 'partner') return a.created_by !== meId || a.assignee === partner?.id;
      if (filter === 'both') return a.assignee === null;
      return true;
    });
  }, [agendas, selected, filter, statusFilter, meId, partner]);

  const matrix = useMemo(() => monthMatrix(cursor.y, cursor.m), [cursor]);

  function shiftMonth(delta: number) {
    setCursor((c) => {
      let m = c.m + delta;
      let y = c.y;
      if (m < 1) {
        m = 12;
        y -= 1;
      }
      if (m > 12) {
        m = 1;
        y += 1;
      }
      return { y, m };
    });
  }

  function openCreate(date = selected) {
    setEditingId(null);
    setForm({ ...emptyForm(date), reminder_minutes: defaultReminderMinutes });
    setError(null);
  }

  function openEdit(a: AgendaRow) {
    setEditingId(a.id);
    setForm({
      title: a.title,
      description: a.description ?? '',
      event_date: a.event_date,
      start_time: a.start_time ?? '',
      end_time: a.end_time ?? '',
      category: a.category,
      priority: a.priority,
      assignee: a.assignee ?? '',
      reminder_enabled: a.reminder_enabled,
      reminder_minutes: defaultReminderMinutes,
      notify_partner: a.notify_partner,
    });
    setError(null);
  }

  async function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        event_date: form.event_date,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        category: form.category,
        priority: form.priority,
        assignee: form.assignee || null,
        reminder_enabled: form.reminder_enabled,
        reminder_minutes: form.reminder_minutes,
        notify_partner: form.notify_partner,
      };
      const res = await fetch(editingId ? `/api/agendas/${editingId}` : '/api/agendas', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Gagal menyimpan agenda.');
      setForm(null);
      setEditingId(null);
      setSelected(payload.event_date);
      const [y, m] = payload.event_date.split('-').map(Number);
      setCursor({ y, m });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan agenda.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(a: AgendaRow) {
    const next: AgendaStatus = a.status === 'done' ? 'pending' : 'done';
    await fetch(`/api/agendas/${a.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    await load();
  }

  async function remove(a: AgendaRow) {
    if (!confirm(`Hapus agenda "${a.title}"?`)) return;
    const res = await fetch(`/api/agendas/${a.id}`, { method: 'DELETE' });
    if (res.ok) await load();
  }

  const monthLabel = new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(cursor.y, cursor.m - 1, 1)));

  const editingAgenda = editingId ? (agendas.find((a) => a.id === editingId) ?? null) : null;

  return (
    <div className="space-y-5">
      {/* Kalender */}
      <div className="glass rounded-3xl p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Kalender
            </p>
            <h2 className="font-display text-xl font-bold capitalize">{monthLabel}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="btn-ghost grid h-9 w-9 place-items-center rounded-xl"
              aria-label="Bulan sebelumnya"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => {
                const t = todayWib();
                const [y, m] = t.split('-').map(Number);
                setCursor({ y, m });
                setSelected(t);
              }}
              className="btn-ghost rounded-xl px-3 py-2 text-xs font-bold"
            >
              Hari ini
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="btn-ghost grid h-9 w-9 place-items-center rounded-xl"
              aria-label="Bulan berikutnya"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => openCreate(selected)}
              className="btn-primary rounded-xl px-4 py-2 text-xs font-bold"
            >
              + Tambah
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold text-ink-faint sm:text-xs">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {matrix.flat().map((key, i) => {
            if (!key) return <div key={`e${i}`} className="min-h-11 sm:min-h-14" />;
            const day = Number(key.slice(8));
            const isToday = key === todayWib();
            const isSelected = key === selected;
            const list = byDate.get(key) ?? [];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                onDoubleClick={() => openCreate(key)}
                className={[
                  'relative flex min-h-11 flex-col items-center rounded-2xl px-1 pt-1.5 pb-1 text-sm transition sm:min-h-14',
                  isSelected
                    ? 'bg-gradient-to-br from-sky-300 to-blush-300 text-white shadow-md shadow-sky-200/70'
                    : isToday
                      ? 'bg-blush-100 text-ink'
                      : 'bg-white/60 text-ink hover:bg-white',
                ].join(' ')}
              >
                <span className="font-semibold">{day}</span>
                <span className="mt-0.5 flex flex-wrap justify-center gap-0.5">
                  {list.slice(0, 3).map((a) => (
                    <span
                      key={a.id}
                      className={[
                        'h-1.5 w-1.5 rounded-full',
                        isSelected ? 'bg-white' : (CATEGORY_DOT[a.category] ?? 'bg-butter-400'),
                      ].join(' ')}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Daftar agenda tanggal terpilih */}
      <div className="glass rounded-3xl p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Agenda terpilih
            </p>
            <h2 className="font-display text-lg font-bold">{formatDateWib(selected)}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              className="rounded-xl border border-white bg-white/80 px-3 py-2 text-xs font-semibold outline-none"
            >
              <option value="all">Semua</option>
              <option value="mine">Milikku</option>
              <option value="partner">Milik pasangan</option>
              <option value="both">Berdua</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | AgendaStatus)}
              className="rounded-xl border border-white bg-white/80 px-3 py-2 text-xs font-semibold outline-none"
            >
              <option value="all">Semua status</option>
              <option value="pending">Berjalan</option>
              <option value="done">Selesai</option>
              <option value="cancelled">Batal</option>
            </select>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-sky-200 bg-white/50 px-4 py-8 text-center">
            <p className="text-sm font-semibold text-ink-soft">Belum ada agenda di tanggal ini</p>
            <button
              type="button"
              onClick={() => openCreate(selected)}
              className="btn-soft mt-3 rounded-xl px-4 py-2 text-xs font-bold"
            >
              Tambah agenda
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((a) => (
              <li
                key={a.id}
                className="rounded-2xl border border-white bg-white/75 p-3.5 shadow-sm sm:p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${CATEGORY_CHIP[a.category] ?? 'chip-yellow'}`}
                      >
                        {CATEGORY_LABEL[a.category] ?? a.category}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-ink-soft">
                        {a.priority === 'high'
                          ? 'Prioritas tinggi'
                          : a.priority === 'low'
                            ? 'Prioritas rendah'
                            : PRIORITY_LABEL[a.priority]}
                      </span>
                      {a.status !== 'pending' && (
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            a.status === 'done'
                              ? 'bg-sky-200 text-sky-600'
                              : 'bg-blush-200 text-blush-500'
                          }`}
                        >
                          {STATUS_LABEL[a.status]}
                        </span>
                      )}
                      <span
                        className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-ink-soft ring-1 ring-sky-100"
                        title="Pembuat agenda"
                      >
                        Dibuat oleh {nameOf(a.created_by)}
                      </span>
                    </div>
                    <h3
                      className={`mt-1.5 font-display text-base font-bold ${
                        a.status === 'done' ? 'text-ink-faint line-through' : ''
                      }`}
                    >
                      {a.title}
                    </h3>
                    {a.description && (
                      <p className="mt-1 text-sm text-ink-soft">{a.description}</p>
                    )}
                    <p className="mt-1.5 text-xs font-semibold text-ink-faint">
                      {a.start_time ? `${a.start_time}${a.end_time ? ` – ${a.end_time}` : ''}` : 'Seharian'}
                      {' · '}
                      {a.assignee === meId
                        ? `Untuk ${me?.display_name ?? 'aku'}`
                        : a.assignee === partner?.id
                          ? `Untuk ${partner?.display_name ?? 'pasangan'}`
                          : 'Untuk berdua'}
                      {a.reminder_enabled && a.reminder_at && ' · pengingat aktif'}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleStatus(a)}
                      className={`grid h-9 w-9 place-items-center rounded-xl text-sm font-bold transition ${
                        a.status === 'done'
                          ? 'bg-sky-300 text-white'
                          : 'bg-white text-ink-faint hover:bg-sky-100 hover:text-sky-500'
                      }`}
                      aria-label={a.status === 'done' ? 'Batalkan selesai' : 'Tandai selesai'}
                      title={a.status === 'done' ? 'Batalkan selesai' : 'Tandai selesai'}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(a)}
                      className="btn-ghost rounded-xl px-3 py-2 text-xs font-bold"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(a)}
                      className="rounded-xl bg-blush-100 px-3 py-2 text-xs font-bold text-blush-500 transition hover:bg-blush-200"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Modal form */}
      {form && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setForm(null)}
          role="presentation"
        >
          <div
            className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? 'Edit agenda' : 'Tambah agenda'}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">
                {editingId ? 'Edit agenda' : 'Tambah agenda'}
              </h3>
              <button
                type="button"
                onClick={() => setForm(null)}
                className="btn-ghost grid h-9 w-9 place-items-center rounded-xl"
                aria-label="Tutup"
              >
                ✕
              </button>
            </div>

            {error && (
              <p className="mb-3 rounded-xl bg-blush-100 px-3 py-2 text-sm font-medium text-blush-500">
                {error}
              </p>
            )}

            <p className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-xs font-semibold text-ink-soft">
              Dibuat oleh {nameOf(editingAgenda?.created_by ?? meId)}
            </p>

            <form onSubmit={submit} className="space-y-3.5">
              <div>
                <label className="mb-1.5 block text-sm font-semibold" htmlFor="f-title">
                  Nama agenda *
                </label>
                <input
                  id="f-title"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Mis. Dinner di tempat favorit"
                  className="w-full rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-2.5 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                />
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold" htmlFor="f-date">
                    Tanggal *
                  </label>
                  <input
                    id="f-date"
                    type="date"
                    required
                    value={form.event_date}
                    onChange={(e) => setForm({ ...form, event_date: e.target.value })}
                    className="w-full rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-2.5 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold">Kategori</label>
                  <select
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value as Category })
                    }
                    className="w-full rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-2.5 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                  >
                    {CATEGORY_ORDER.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold" htmlFor="f-start">
                    Jam mulai
                  </label>
                  <input
                    id="f-start"
                    type="time"
                    value={form.start_time}
                    onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                    className="w-full rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-2.5 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold" htmlFor="f-end">
                    Jam selesai
                  </label>
                  <input
                    id="f-end"
                    type="time"
                    value={form.end_time}
                    onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                    className="w-full rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-2.5 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold" htmlFor="f-desc">
                  Deskripsi
                </label>
                <textarea
                  id="f-desc"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Opsional"
                  className="w-full rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-2.5 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                />
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold">Untuk siapa</label>
                  <select
                    value={form.assignee}
                    onChange={(e) => setForm({ ...form, assignee: e.target.value })}
                    className="w-full rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-2.5 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                  >
                    <option value="">Berdua</option>
                    {me && <option value={me.id}>{me.display_name ?? 'Aku'}</option>}
                    {partner && (
                      <option value={partner.id}>{partner.display_name ?? 'Pasangan'}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold">Prioritas</label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
                    className="w-full rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-2.5 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                  >
                    <option value="low">Rendah</option>
                    <option value="normal">Sedang</option>
                    <option value="high">Tinggi</option>
                  </select>
                </div>
              </div>

              <div className="rounded-2xl bg-butter-100/80 p-3.5">
                <label className="flex items-center gap-2.5 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={form.reminder_enabled}
                    onChange={(e) =>
                      setForm({ ...form, reminder_enabled: e.target.checked })
                    }
                    className="h-4 w-4 accent-sky-500"
                  />
                  Aktifkan pengingat di HP
                </label>
                {form.reminder_enabled && (
                  <div className="mt-2.5">
                    <label className="mb-1 block text-xs font-semibold text-ink-soft" htmlFor="f-rem">
                      Kirim pengingat sebelumnya
                    </label>
                    <select
                      id="f-rem"
                      value={form.reminder_minutes}
                      onChange={(e) =>
                        setForm({ ...form, reminder_minutes: Number(e.target.value) })
                      }
                      className="w-full rounded-xl border border-butter-200 bg-white/80 px-3 py-2 text-sm outline-none"
                    >
                      <option value={15}>15 menit sebelum</option>
                      <option value={30}>30 menit sebelum</option>
                      <option value={60}>1 jam sebelum</option>
                      <option value={120}>2 jam sebelum</option>
                      <option value={1440}>1 hari sebelum</option>
                    </select>
                    <p className="mt-1.5 text-[11px] text-ink-soft">
                      Agenda tanpa jam dikirim pukul 09.00 WIB pada tanggalnya.
                    </p>
                  </div>
                )}
                <label className="mt-3 flex items-center gap-2.5 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={form.notify_partner}
                    onChange={(e) => setForm({ ...form, notify_partner: e.target.checked })}
                    className="h-4 w-4 accent-blush-400"
                  />
                  Beri tahu pasangan saat disimpan
                </label>
              </div>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setForm(null)}
                  className="btn-ghost flex-1 rounded-2xl px-4 py-3 text-sm font-bold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="btn-primary flex-1 rounded-2xl px-4 py-3 text-sm font-bold disabled:opacity-60"
                >
                  {busy ? 'Menyimpan…' : editingId ? 'Simpan perubahan' : 'Simpan agenda'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
