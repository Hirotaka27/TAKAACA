-- Supabase Cron: cek pengingat agenda tiap menit lalu panggil Vercel.
-- Ganti <APP_URL> dan <CRON_SECRET> sebelum dijalankan.
--
-- pg_cron + pg_net tersedia di semua plan Supabase termasuk Free.
-- Kenapa bukan Vercel Cron: plan Hobby hanya boleh jalan sekali sehari.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('takaaca-reminders')
where exists (select 1 from cron.job where jobname = 'takaaca-reminders');

select cron.schedule(
  'takaaca-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := '<APP_URL>/api/cron/reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <CRON_SECRET>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- Cek riwayat eksekusi:
-- select * from cron.job_run_details order by start_time desc limit 20;
