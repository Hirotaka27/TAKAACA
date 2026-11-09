import { useCallback, useEffect, useState } from 'react';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export default function EnablePush() {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [iosHint, setIosHint] = useState(false);

  const checkExisting = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setSubscribed(Boolean(sub));
      setPermission(Notification.permission);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    setSupported('serviceWorker' in navigator && 'PushManager' in window);
    setPermission(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
    setIosHint(isIos() && !isStandalone());
    void checkExisting();
  }, [checkExisting]);

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      const keyRes = await fetch('/api/push/public-key');
      const keyData = await keyRes.json().catch(() => ({}));
      if (!keyRes.ok) throw new Error(keyData.error ?? 'Push belum dikonfigurasi server.');

      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);
      if (permissionResult !== 'granted') {
        throw new Error('Izin notifikasi ditolak. Izinkan lewat pengaturan browser.');
      }

      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) as BufferSource,
        });
      }

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Gagal menyimpan subscription.');

      setSubscribed(true);
      setMessage('Notifikasi aktif! Kamu akan diingatkan lewat HP.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal mengaktifkan notifikasi.');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, {
          method: 'DELETE',
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setMessage('Notifikasi dimatikan.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal mematikan notifikasi.');
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <p className="rounded-2xl bg-white/70 px-4 py-3 text-sm text-ink-soft">
        Browser ini tidak mendukung notifikasi. Coba Chrome, Edge, atau Firefox terbaru.
      </p>
    );
  }

  return (
    <div className="rounded-2xl bg-white/75 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold">Notifikasi pengingat di HP</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {subscribed
              ? 'Sedang aktif — pengingat agenda akan masuk sebagai notifikasi.'
              : 'Aktifkan agar agenda mengingatkan kamu sebelum waktunya.'}
          </p>
        </div>
        <button
          type="button"
          onClick={subscribed ? disable : enable}
          disabled={busy || permission === 'denied'}
          className={[
            'rounded-2xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-60',
            subscribed ? 'btn-ghost' : 'btn-primary',
          ].join(' ')}
        >
          {busy ? 'Memproses…' : subscribed ? 'Matikan' : 'Aktifkan notifikasi'}
        </button>
      </div>

      {permission === 'denied' && (
        <p className="mt-2 text-xs font-semibold text-blush-500">
          Izin notifikasi diblokir. Buka pengaturan situs di browser, lalu izinkan notifikasi.
        </p>
      )}
      {iosHint && (
        <p className="mt-2 text-xs font-semibold text-ink-soft">
          Di iPhone: buka menu Share → <strong>Add to Home Screen</strong> dulu supaya notifikasi
          bisa masuk.
        </p>
      )}
      {message && <p className="mt-2 text-xs font-semibold text-sky-500">{message}</p>}
    </div>
  );
}
