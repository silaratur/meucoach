import type { DadosPerfil, Perfil, SessaoTreino } from './types';
import { cabecalhos, notificarAssinaturaNecessaria, notificarNaoAutorizado } from './session';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function horaAgora(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------- Perfil e dados: persistidos no servidor (banco de dados) ----------
// Usam o token da pessoa ativa (definido em session.ts) — por isso as funções
// não precisam recebê-lo como parâmetro.
async function chamar<T>(url: string, opcoes: RequestInit = {}): Promise<T> {
  const resp = await fetch(url, {
    ...opcoes,
    headers: cabecalhos({ 'Content-Type': 'application/json', ...(opcoes.headers as Record<string, string> | undefined) }),
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) notificarNaoAutorizado();
  if (resp.status === 402) notificarAssinaturaNecessaria();
  if (!resp.ok) throw new Error((data as { error?: string }).error || `Erro ${resp.status}`);
  return data as T;
}

export async function buscarPerfilEDados(): Promise<{ perfil: Perfil; dados: DadosPerfil }> {
  return chamar('/api/perfil');
}

export async function salvarPerfilRemoto(perfil: Perfil): Promise<void> {
  await chamar('/api/perfil', { method: 'PUT', body: JSON.stringify(perfil) });
}

export async function salvarDadosRemoto(dados: DadosPerfil): Promise<void> {
  await chamar('/api/dados', { method: 'PUT', body: JSON.stringify(dados) });
}

export async function excluirContaRemota(): Promise<void> {
  await chamar('/api/perfil', { method: 'DELETE' });
}

// ---------- Assinatura (Mercado Pago) ----------
export interface StatusAssinatura {
  status: 'inativa' | 'ativa' | 'atrasada' | 'cancelada' | 'isenta';
  validaAte: string | null;
}

export async function obterAssinatura(): Promise<StatusAssinatura> {
  return chamar('/api/assinatura');
}

export async function iniciarAssinatura(): Promise<{ initPoint: string }> {
  return chamar('/api/assinatura/iniciar', { method: 'POST' });
}

export async function cancelarAssinatura(): Promise<void> {
  await chamar('/api/assinatura/cancelar', { method: 'POST' });
}

// ---------- Recomendação de carga ----------
// Procura o exercício (por nome) nas sessões mais recentes e sugere a próxima carga:
// se completou todas as séries, sobe ~2.5% (mín. 1 kg); senão mantém.
export function cargaRecomendada(sessoes: SessaoTreino[], nomeExercicio: string): { cargaKg?: number; motivo: string } {
  const nome = nomeExercicio.trim().toLowerCase();
  const ordenadas = [...sessoes].sort((a, b) => b.data.localeCompare(a.data));
  for (const sessao of ordenadas) {
    const item = sessao.itens.find((i) => i.nome.trim().toLowerCase() === nome);
    if (!item) continue;
    const cargas = item.seriesFeitas.map((s) => s.cargaKg).filter((c): c is number => typeof c === 'number' && c > 0);
    if (!cargas.length) return { motivo: 'Sem carga registrada da última vez — anote hoje para eu acompanhar.' };
    const ultima = Math.max(...cargas);
    const completou = item.seriesFeitas.length > 0 && item.seriesFeitas.every((s) => (s.reps ?? 0) > 0);
    if (completou) {
      const nova = Math.round((ultima * 1.025 + Number.EPSILON) * 2) / 2;
      const sugerida = Math.max(nova, ultima + 1);
      return { cargaKg: sugerida, motivo: `Última vez: ${ultima} kg completando tudo. Bora subir!` };
    }
    return { cargaKg: ultima, motivo: `Mantenha ${ultima} kg e capriche na execução.` };
  }
  return { motivo: 'Primeira vez neste exercício — comece com carga confortável e anote.' };
}
