// Notificações push (lembrete diário) — mesmo padrão de "gerar uma vez e persistir em disco"
// já usado pro JWT_SECRET em db.mjs, assim as inscrições continuam válidas entre reinícios.
import webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

function obterChavesVapid() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const arquivo = path.join(dataDir, 'vapid-keys.json');
  if (fs.existsSync(arquivo)) return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const chaves = webpush.generateVAPIDKeys();
  fs.writeFileSync(arquivo, JSON.stringify(chaves), { mode: 0o600 });
  return chaves;
}

export const VAPID = obterChavesVapid();
webpush.setVapidDetails('mailto:contato@meucoach.app', VAPID.publicKey, VAPID.privateKey);

// Retorna false quando a inscrição expirou/foi revogada pelo navegador (410/404) — quem chama
// deve apagar essa inscrição do banco nesse caso, em vez de continuar tentando enviar pra ela.
export async function enviarPush(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) return false;
    throw err;
  }
}
