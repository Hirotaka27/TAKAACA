import type { APIRoute } from 'astro';
import { requireUser, jsonError, ApiError } from '../../../lib/api';
import { deletePhoto } from '../../../lib/storage';
import type { PhotoRow } from './index';

async function fetchPhoto(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  id: string,
): Promise<PhotoRow> {
  const { data, error } = await supabase.from('photos').select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw new ApiError(404, 'Foto tidak ditemukan.');
  const row = data as PhotoRow;
  return row.url ? row : { ...row, url: row.web_view_link ?? '' };
}

export const DELETE: APIRoute = async (context) => {
  try {
    const { supabase } = await requireUser(context);
    const id = context.params.id ?? '';
    const photo = await fetchPhoto(supabase, id);

    try {
      await deletePhoto(photo.storage_path);
    } catch (err) {
      // File gagal dihapus - tetap lanjut supaya data tidak nyangkut.
      console.error('[photos/delete] storage', err);
    }

    const { error } = await supabase.from('photos').delete().eq('id', id);
    if (error) throw new ApiError(500, error.message);
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
};
