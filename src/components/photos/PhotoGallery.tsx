import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProfileRow } from '../../lib/agenda';

export interface Photo {
  id: string;
  storage_path: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  web_view_link: string | null;
  uploaded_by: string;
  created_at: string;
  url: string;
}

interface Props {
  initialPhotos: Photo[];
  profiles: ProfileRow[];
  meId: string;
}

const MAX_DIMENSION = 2560;
const TARGET_MAX_BYTES = 3.8 * 1024 * 1024;

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Gagal memproses gambar.'))),
      'image/jpeg',
      quality,
    );
  });
}

/** Kompres foto di browser supaya aman melewati batas body Vercel (±4,5 MB). */
async function compressImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    let quality = 0.86;
    let blob = await canvasToBlob(canvas, quality);
    while (blob.size > TARGET_MAX_BYTES && quality > 0.5) {
      quality -= 0.12;
      blob = await canvasToBlob(canvas, quality);
    }

    if (blob.size > 4 * 1024 * 1024) {
      throw new Error('Foto terlalu besar bahkan setelah kompresi.');
    }

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'foto';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch (err) {
    // Gambar tidak bisa didekode browser (mis. HEIC) - pakai asli bila masih muat.
    if (file.size <= 4 * 1024 * 1024) return file;
    throw err instanceof Error && err.message.includes('terlalu besar')
      ? err
      : new Error('Foto tidak bisa diproses. Coba format JPG/PNG.');
  }
}

export default function PhotoGallery({ initialPhotos, profiles, meId }: Props) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [uploader, setUploader] = useState<'all' | 'mine' | 'partner'>('all');
  const [active, setActive] = useState<Photo | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const nameOf = useCallback(
    (id: string) => {
      const p = profiles.find((x) => x.id === id);
      if (!p) return 'Kita';
      return p.id === meId ? (p.display_name ?? 'Aku') : (p.display_name ?? 'Pasangan');
    },
    [profiles, meId],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return photos.filter((p) => {
      if (uploader === 'mine' && p.uploaded_by !== meId) return false;
      if (uploader === 'partner' && p.uploaded_by === meId) return false;
      if (!needle) return true;
      return p.name.toLowerCase().includes(needle);
    });
  }, [photos, query, uploader, meId]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      setUploading(true);
      setError(null);
      setSuccess(null);
      let ok = 0;

      for (let i = 0; i < list.length; i++) {
        setProgress(`Mengunggah ${i + 1}/${list.length}: ${list[i].name}`);
        try {
          const compressed = await compressImage(list[i]);
          const fd = new FormData();
          fd.append('file', compressed);
          const res = await fetch('/api/photos', { method: 'POST', body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? 'Gagal mengunggah.');
          setPhotos((prev) => [data.photo as Photo, ...prev]);
          ok++;
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Gagal mengunggah foto.');
          break;
        }
      }

      setUploading(false);
      setProgress(null);
      if (ok > 0) setSuccess(`${ok} foto tersimpan ✓`);
      if (inputRef.current) inputRef.current.value = '';
    },
    [],
  );

  async function remove(p: Photo) {
    if (!confirm(`Hapus foto "${p.name}"?`)) return;
    const res = await fetch(`/api/photos/${p.id}`, { method: 'DELETE' });
    if (res.ok) {
      setPhotos((prev) => prev.filter((x) => x.id !== p.id));
      setActive(null);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Gagal menghapus foto.');
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="space-y-5">
      {/* Aksi unggah */}
      <div className="glass rounded-3xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">Galeri foto</h2>
            <p className="text-sm text-ink-soft">
              Foto otomatis tersimpan di penyimpanan aplikasi dan bisa dilihat bersama.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void uploadFiles(e.target.files);
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="btn-primary rounded-2xl px-4 py-2.5 text-sm font-bold disabled:opacity-60"
            >
              {uploading ? 'Mengunggah…' : '+ Unggah foto'}
            </button>
          </div>
        </div>

        {progress && (
          <p className="mt-3 rounded-xl bg-sky-100 px-3 py-2 text-xs font-semibold text-sky-500">
            {progress}
          </p>
        )}
        {success && (
          <p className="mt-3 rounded-xl bg-blush-100 px-3 py-2 text-xs font-semibold text-blush-500">
            {success}
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-xl bg-blush-100 px-3 py-2 text-xs font-semibold text-blush-500">
            {error}
          </p>
        )}
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari nama foto…"
          className="min-w-40 flex-1 rounded-2xl border border-white bg-white/80 px-4 py-2.5 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
        />
        <select
          value={uploader}
          onChange={(e) => setUploader(e.target.value as 'all' | 'mine' | 'partner')}
          className="rounded-2xl border border-white bg-white/80 px-4 py-2.5 text-sm font-semibold outline-none"
        >
          <option value="all">Semua orang</option>
          <option value="mine">Unggahan ku</option>
          <option value="partner">Unggahan pasangan</option>
        </select>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="glass rounded-3xl px-4 py-14 text-center">
          <p className="text-4xl">📷</p>
          <p className="mt-3 font-display text-lg font-bold">Belum ada foto</p>
          <p className="mt-1 text-sm text-ink-soft">
            Unggah foto pertama kamu - akan tersimpan otomatis di sini.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActive(p)}
              className="group relative aspect-square overflow-hidden rounded-3xl bg-sky-50 ring-1 ring-white transition hover:shadow-lg hover:shadow-sky-200/60"
            >
              <img
                src={p.url}
                alt={p.name}
                loading="lazy"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-2.5 py-2 text-left text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
                {p.name}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"
          onClick={() => setActive(null)}
          role="presentation"
        >
          <div
            className="max-h-[92dvh] w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={active.name}
          >
            <img
              src={active.url}
              alt={active.name}
              className="max-h-[65dvh] w-full bg-sky-50 object-contain"
            />
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-display font-bold">{active.name}</p>
                <p className="text-xs text-ink-faint">
                  {nameOf(active.uploaded_by)} ·{' '}
                  {new Intl.DateTimeFormat('id-ID', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'Asia/Jakarta',
                  }).format(new Date(active.created_at))}
                </p>
              </div>
              <div className="flex gap-2">
                {active.url && (
                  <a
                    href={active.url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost rounded-xl px-3 py-2 text-xs font-bold"
                  >
                    Buka foto asli
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void remove(active)}
                  className="rounded-xl bg-blush-100 px-3 py-2 text-xs font-bold text-blush-500 hover:bg-blush-200"
                >
                  Hapus
                </button>
                <button
                  type="button"
                  onClick={() => setActive(null)}
                  className="btn-primary rounded-xl px-3 py-2 text-xs font-bold"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
