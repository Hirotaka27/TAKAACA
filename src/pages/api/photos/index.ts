import type { APIRoute } from 'astro';
import { requireUser, jsonError, ApiError } from '../../../lib/api';
import { uploadPhoto, publicUrlFor } from '../../../lib/storage';

export interface PhotoRow {
  id: string;
  storage_path: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  web_view_link: string | null;
  uploaded_by: string;
  created_at: string;
  /** URL gambar siap pakai (diisi server, bukan kolom database). */
  url: string;
}

type DbPhoto = Omit<PhotoRow, 'url'>;

function withUrl(row: DbPhoto): PhotoRow {
  return { ...row, url: row.web_view_link || publicUrlFor(row.storage_path) };
}

/** Batas aman permintaan Vercel (±4,5 MB) - sisa dipakai boundary multipart. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const GET: APIRoute = async (context) => {
  try {
    const { supabase } = await requireUser(context);
    const { data, error } = await supabase
      .from('photos')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw new ApiError(500, error.message);
    const photos = ((data ?? []) as DbPhoto[]).map(withUrl);
    return Response.json({ photos });
  } catch (err) {
    return jsonError(err);
  }
};

export const POST: APIRoute = async (context) => {
  try {
    const { supabase, user } = await requireUser(context);

    const form = await context.request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new ApiError(400, 'File tidak ditemukan.');

    if (!file.type.startsWith('image/')) {
      throw new ApiError(400, 'Hanya file gambar yang diizinkan.');
    }
    if (file.size === 0) throw new ApiError(400, 'File kosong.');
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ApiError(
        413,
        `Ukuran foto maksimal ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB setelah kompresi.`,
      );
    }

    const safeName =
      file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `foto-${Date.now()}.jpg`;

    const uploaded = await uploadPhoto({
      userId: user.id,
      mimeType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
    });

    const { data, error } = await supabase
      .from('photos')
      .insert({
        storage_path: uploaded.storagePath,
        name: safeName,
        mime_type: file.type,
        size_bytes: file.size,
        web_view_link: uploaded.publicUrl,
        uploaded_by: user.id,
      })
      .select('*')
      .single();

    if (error) throw new ApiError(500, error.message);
    return Response.json({ photo: withUrl(data as DbPhoto) }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
};
