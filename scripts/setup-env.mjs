#!/usr/bin/env node
// Isi kunci yang bisa digenerate otomatis ke .env (VAPID + CRON_SECRET).
// Pemakaian:
//   npm run setup
//   npm run setup -- --app-url=https://andalu.vercel.app   (juga menulis supabase/cron.generated.sql)
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateVAPIDKeys } from 'web-push';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const examplePath = resolve(root, '.env.example');
const cronSrcPath = resolve(root, 'supabase/migrations/0002_cron.sql');
const cronOutPath = resolve(root, 'supabase/cron.generated.sql');

const appUrlArg = process.argv.find((a) => a.startsWith('--app-url='))?.slice('--app-url='.length);

if (!existsSync(envPath)) {
  if (!existsSync(examplePath)) {
    console.error('✗ .env.example tidak ditemukan.');
    process.exit(1);
  }
  writeFileSync(envPath, readFileSync(examplePath, 'utf8'));
  console.log('• .env dibuat dari .env.example');
}

let text = readFileSync(envPath, 'utf8');

function getValue(key) {
  const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim() : '';
}

function setValue(key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) {
    text = text.replace(re, `${key}=${value}`);
  } else {
    text = `${text.replace(/\n*$/, '')}\n${key}=${value}\n`;
  }
}

function isBlank(value) {
  return !value || /placeholder|xxxx|contoh/i.test(value);
}

const filled = [];
const manual = [];

// VAPID (Web Push)
if (isBlank(getValue('VAPID_PUBLIC_KEY')) || isBlank(getValue('VAPID_PRIVATE_KEY'))) {
  const { publicKey, privateKey } = generateVAPIDKeys();
  setValue('VAPID_PUBLIC_KEY', publicKey);
  setValue('VAPID_PRIVATE_KEY', privateKey);
  filled.push('VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY');
}
if (isBlank(getValue('VAPID_SUBJECT'))) {
  setValue('VAPID_SUBJECT', 'mailto:admin@example.com');
}

// Secret cron
if (isBlank(getValue('CRON_SECRET'))) {
  setValue('CRON_SECRET', randomBytes(24).toString('hex'));
  filled.push('CRON_SECRET');
}

writeFileSync(envPath, text);

// Validasi kunci yang harus diisi manual
const supabaseKeys = [
  ['PUBLIC_SUPABASE_URL', 'https://xxxx.supabase.co'],
  ['PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_...'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_...'],
];
for (const [key, contoh] of supabaseKeys) {
  const value = getValue(key);
  if (isBlank(value)) {
    manual.push(`${key} (contoh format: ${contoh})`);
  } else if (key === 'PUBLIC_SUPABASE_URL' && !/^https:\/\//.test(value)) {
    manual.push(`${publicUrlWarning(key, value)}`);
  }
}

function publicUrlWarning(key, value) {
  return `${key} tidak valid: "${value}" - harus URL API seperti https://<project-id>.supabase.co (bukan halaman dashboard)`;
}

// Cron SQL siap tempel
if (appUrlArg) {
  if (!/^https?:\/\//.test(appUrlArg)) {
    console.error('✗ --app-url harus diawali https:// atau http://');
    process.exit(1);
  }
  const cronSecret = getValue('CRON_SECRET');
  const sql = readFileSync(cronSrcPath, 'utf8')
    .replaceAll('<APP_URL>', appUrlArg.replace(/\/$/, ''))
    .replaceAll('<CRON_SECRET>', cronSecret);
  writeFileSync(cronOutPath, sql);
  console.log(`✓ supabase/cron.generated.sql ditulis (APP_URL = ${appUrlArg})`);
}

console.log('');
if (filled.length) {
  console.log('✓ Diisi otomatis ke .env:');
  for (const item of filled) console.log(`   - ${item}`);
}
if (manual.length) {
  console.log('');
  console.log('⚠ Masih perlu Anda isi manual di .env:');
  for (const item of manual) console.log(`   - ${item}`);
  console.log('   Ambil dari Supabase Dashboard -> Project Settings -> API');
} else {
  console.log('✓ Semua kunci .env sudah terisi.');
}
console.log('');
console.log('Langkah berikutnya:');
console.log('   1. Supabase -> Authentication -> Users -> Add user (2 akun)');
console.log('   2. Supabase -> SQL Editor -> jalankan 0001_init.sql');
if (!appUrlArg) {
  console.log('   3. SQL Editor -> jalankan supabase/cron.generated.sql');
  console.log('      (buat dulu: npm run setup -- --app-url=https://<domain-anda>)');
} else {
  console.log('   3. SQL Editor -> jalankan supabase/cron.generated.sql');
}
