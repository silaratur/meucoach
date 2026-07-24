// Lembrete diário via notificação push — pede permissão do navegador, inscreve o aparelho no
// service worker já existente (public/sw.js) e manda a inscrição pro servidor guardar.
import { cabecalhos } from './session';

function urlBase64ParaUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalizado = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const bruto = atob(normalizado);
  const bytes = new Uint8Array(new ArrayBuffer(bruto.length));
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
  return bytes;
}

export function suportaPush(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function permissaoPush(): NotificationPermission | 'indisponivel' {
  return suportaPush() ? Notification.permission : 'indisponivel';
}

export async function inscricaoAtiva(): Promise<boolean> {
  if (!suportaPush()) return false;
  const registro = await navigator.serviceWorker.getRegistration();
  if (!registro) return false;
  const subscription = await registro.pushManager.getSubscription();
  return !!subscription;
}

export async function ativarLembretes(): Promise<boolean> {
  if (!suportaPush()) return false;
  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') return false;

  const registro = await navigator.serviceWorker.ready;
  const { publicKey } = await fetch('/api/push/chave-publica').then((r) => r.json());
  const subscription = await registro.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ParaUint8Array(publicKey),
  });
  const json = subscription.toJSON();
  await fetch('/api/push/inscrever', {
    method: 'POST',
    headers: cabecalhos({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  return true;
}

export async function desativarLembretes(): Promise<void> {
  if (!suportaPush()) return;
  const registro = await navigator.serviceWorker.getRegistration();
  const subscription = await registro?.pushManager.getSubscription();
  if (!subscription) return;
  await fetch('/api/push/cancelar', {
    method: 'POST',
    headers: cabecalhos({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}

export async function testarLembrete(): Promise<boolean> {
  const resp = await fetch('/api/push/testar', { method: 'POST', headers: cabecalhos() });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data as { error?: string }).error || 'Falha ao enviar notificação de teste.');
  return !!(data as { ok?: boolean }).ok;
}
