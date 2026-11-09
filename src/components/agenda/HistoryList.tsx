import { useMemo, useState } from 'react';
import type { AgendaRow, ProfileRow } from '../../lib/agenda';
import { CATEGORY_LABEL, STATUS_LABEL, formatDateWib } from '../../lib/agenda';

interface Props {
  items: AgendaRow[];
  profiles: ProfileRow[];
  meId: string;
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export default function HistoryList({ items, profiles, meId }: Props) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'done' | 'cancelled'>('all');

  const nameOf = (id: string | null) => {
    if (!id) return 'Berdua';
    const p = profiles.find((x) => x.id === id);
    if (!p) return 'Berdua';
    return p.id === meId ? (p.display_name ?? 'Aku') : (p.display_name ?? 'Pasangan');
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((a) => {
      if (status !== 'all' && a.status !== status) return false;
      if (!needle) return true;
      return (
        a.title.toLowerCase().includes(needle) ||
        (a.description ?? '').toLowerCase().includes(needle)
      );
    });
  }, [items, q, status]);

  const grouped = useMemo(() => {
    const map = new Map<string, AgendaRow[]>();
    for (const a of filtered) {
      const key = monthKey(a.event_date);
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  return (
    <div className="space-y-5">
      <div className="glass flex flex-wrap items-center gap-3 rounded-3xl p-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari agenda…"
          className="min-w-40 flex-1 rounded-2xl border border-white bg-white/80 px-4 py-2.5 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'all' | 'done' | 'cancelled')}
          className="rounded-2xl border border-white bg-white/80 px-4 py-2.5 text-sm font-semibold outline-none"
        >
          <option value="all">Semua status</option>
          <option value="done">Selesai</option>
          <option value="cancelled">Dibatalkan</option>
        </select>
      </div>

      {grouped.length === 0 ? (
        <div className="glass rounded-3xl px-4 py-12 text-center">
          <p className="text-3xl">🗓️</p>
          <p className="mt-2 font-display text-lg font-bold">Belum ada riwayat</p>
          <p className="mt-1 text-sm text-ink-soft">
            Agenda yang selesai atau dibatalkan akan muncul di sini.
          </p>
        </div>
      ) : (
        grouped.map(([key, list]) => (
          <section key={key} className="glass rounded-3xl p-4 sm:p-5">
            <h2 className="mb-3 font-display text-lg font-bold capitalize">{monthLabel(key)}</h2>
            <ul className="space-y-3">
              {list.map((a) => (
                <li
                  key={a.id}
                  className="rounded-2xl border border-white bg-white/75 p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-ink-faint">
                      {formatDateWib(a.event_date, { weekday: undefined })}
                    </span>
                    <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-bold text-sky-500">
                      {CATEGORY_LABEL[a.category] ?? a.category}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        a.status === 'done'
                          ? 'bg-sky-200 text-sky-600'
                          : 'bg-blush-200 text-blush-500'
                      }`}
                    >
                      {STATUS_LABEL[a.status]}
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
                    {a.start_time ? a.start_time : 'Seharian'} · {nameOf(a.assignee)}
                    {' · dibuat oleh '}
                    {nameOf(a.created_by)}
                    {a.completed_at &&
                      ` · selesai ${new Intl.DateTimeFormat('id-ID', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: 'Asia/Jakarta',
                      }).format(new Date(a.completed_at))}`}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
