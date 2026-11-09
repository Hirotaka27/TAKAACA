import { randomUUID } from 'node:crypto';
import { createServiceClient } from './supabase/server';

export const PHOTO_BUCKET = 'photos';

export interface UploadedPhoto {
  storagePath: string;
  publicUrl: string;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

function bucket() {
  return createServiceClient().storage.from(PHOTO_BUCKET);
}

/** URL publik permanen untuk sebuah objek di bucket photos. */
export function publicUrlFor(storagePath: string): string {
  return createServiceClient().storage.from(PHOTO_BUCKET).getPublicUrl(storagePath).data
    .publicUrl;
}

/** Simpan foto. Path = <userId>/<uuid>.<ext> sehingga tidak bisa ditebak. */
export async function uploadPhoto(opts: {
  userId: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<UploadedPhoto> {
  const ext = EXT_BY_MIME[opts.mimeType] ?? 'jpg';
  const storagePath = `${opts.userId}/${randomUUID()}.${ext}`;
  const { error } = await bucket().upload(storagePath, opts.buffer, {
    contentType: opts.mimeType,
    upsert: false,
  });
  if (error) throw new Error(`Gagal mengunggah foto: ${error.message}`);
  return { storagePath, publicUrl: publicUrlFor(storagePath) };
}

/** Hapus objek foto. Error dilempar agar pemanggil bisa memutuskan. */
export async function deletePhoto(storagePath: string): Promise<void> {
  const { error } = await bucket().remove([storagePath]);
  if (error) throw new Error(`Gagal menghapus foto: ${error.message}`);
}
