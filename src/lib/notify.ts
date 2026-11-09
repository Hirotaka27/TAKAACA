import { setVapidDetails, sendNotification } from 'web-push';
import type { PushSubscription } from 'web-push';
import { createServiceClient } from './supabase/server';

let configured = false;
let failed = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  if (failed) return false;
  const publicKey = import.meta.env.VAPID_PUBLIC_KEY;
  const privateKey = import.meta.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  try {
    setVapidDetails(
      import.meta.env.VAPID_SUBJECT || 'mailto:admin@example.com',
      publicKey,
      privateKey,
    );
    configured = true;
    return true;
  } catch (err) {
    // VAPID tidak valid - notifikasi dilewati agar operasi lain tetap jalan.
    failed = true;
    console.error('[push] VAPID tidak valid:', err instanceof Error ? err.message : err);
    return false;
  }
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/** Kirim Web Push ke sejumlah user. Subscription mati otomatis dibuang. */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (userIds.length === 0 || !ensureConfigured()) return;

  const supabase = createServiceClient();
  const unique = [...new Set(userIds)];
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', unique);
  if (error || !subs || subs.length === 0) return;

  const deadIds: string[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      const subscription: PushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await sendNotification(subscription, JSON.stringify(payload));
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) deadIds.push(sub.id);
      }
    }),
  );

  if (deadIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', deadIds);
  }
}
