/** Zona waktu aplikasi: WIB (UTC+7), tanpa DST. */
export const TZ_OFFSET_MINUTES = 7 * 60;

export const CATEGORY_VALUES = [
  'task',
  'date',
  'anniversary',
  'trip',
  'gift',
  'movie',
  'food',
  'other',
] as const;

export type Category = (typeof CATEGORY_VALUES)[number];
export type Priority = 'low' | 'normal' | 'high';
export type AgendaStatus = 'pending' | 'done' | 'cancelled';

export interface AgendaRow {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  category: Category;
  priority: Priority;
  assignee: string | null;
  status: AgendaStatus;
  completed_at: string | null;
  reminder_enabled: boolean;
  reminder_at: string | null;
  reminder_sent_at: string | null;
  notify_partner: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_emoji: string | null;
  anniversary_date: string | null;
  default_reminder_minutes: number;
  created_at: string;
}

/**
 * Hitung waktu pengingat dalam ISO UTC.
 * - Ada jam mulai: `reminderMinutes` sebelum jam mulai pada tanggal agenda.
 * - Tanpa jam (agenda seharian): pukul 09:00 WIB pada tanggal agenda.
 */
export function computeReminderAt(
  eventDate: string,
  startTime: string | null | undefined,
  reminderMinutes = 60,
): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate);
  if (!m) return null;
  const [, y, mo, d] = m;

  if (startTime) {
    const t = /^(\d{2}):(\d{2})$/.exec(startTime);
    if (!t) return null;
    const utcMs =
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(t[1]), Number(t[2])) -
      TZ_OFFSET_MINUTES * 60_000 -
      reminderMinutes * 60_000;
    return new Date(utcMs).toISOString();
  }

  const utcMs =
    Date.UTC(Number(y), Number(mo) - 1, Number(d), 9, 0) - TZ_OFFSET_MINUTES * 60_000;
  return new Date(utcMs).toISOString();
}

/** `YYYY-MM-DD` untuk zona WIB. */
export function todayWib(now = new Date()): string {
  const shifted = new Date(now.getTime() + TZ_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function formatDateWib(isoDate: string, opts?: Intl.DateTimeFormatOptions): string {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, 12));
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...opts,
  }).format(date);
}

export const CATEGORY_LABEL: Record<Category, string> = {
  task: 'Tugas',
  date: 'Kencan',
  anniversary: 'Anniversary',
  trip: 'Jalan-jalan',
  gift: 'Kado',
  movie: 'Nonton',
  food: 'Kuliner',
  other: 'Lainnya',
};

/** Urutan tampil di dropdown kategori. */
export const CATEGORY_ORDER: Category[] = [...CATEGORY_VALUES];

/** Warna chip untuk daftar agenda & riwayat. */
export const CATEGORY_CHIP: Record<Category, string> = {
  task: 'bg-sky-100 text-sky-500',
  date: 'bg-blush-100 text-blush-500',
  anniversary: 'chip-yellow',
  trip: 'bg-teal-100 text-teal-500',
  gift: 'bg-violet-100 text-violet-500',
  movie: 'bg-indigo-100 text-indigo-500',
  food: 'bg-orange-100 text-orange-500',
  other: 'bg-slate-100 text-slate-500',
};

/** Warna titik kecil di kalender. */
export const CATEGORY_DOT: Record<Category, string> = {
  task: 'bg-sky-400',
  date: 'bg-blush-400',
  anniversary: 'bg-butter-400',
  trip: 'bg-teal-400',
  gift: 'bg-violet-400',
  movie: 'bg-indigo-400',
  food: 'bg-orange-400',
  other: 'bg-slate-400',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Rendah',
  normal: 'Sedang',
  high: 'Tinggi',
};

export const STATUS_LABEL: Record<AgendaStatus, string> = {
  pending: 'Berjalan',
  done: 'Selesai',
  cancelled: 'Batal',
};
