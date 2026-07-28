import type { DadosPerfil, Perfil, SessaoTreino } from './types';
import { cabecalhos, notificarNaoAutorizado } from './session';

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

// ---------- Recomendação de carga ----------
// Procura o exercício (por nome) nas sessões mais recentes e sugere a próxima carga. Antes só
// olhava "completou todas as reps?" — agora também usa o RIR (repetições em reserva) coletado
// na série final da última vez: RIR baixo (perto da falha) seguraa progressão mesmo tendo
// completado; RIR alto (sobrou fôlego) libera subir mais que o padrão de 2,5%. Sem RIR registrado
// (sessões antigas, ou controle que ainda não chegou na série final), cai no comportamento de
// sempre: sobe ~2,5% se completou, mantém se não completou.
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
    if (!completou) {
      return { cargaKg: ultima, motivo: `Mantenha ${ultima} kg e capriche na execução.` };
    }
    const rirUltima = item.seriesFeitas[item.seriesFeitas.length - 1]?.rir;
    if (rirUltima != null && rirUltima <= 1) {
      return { cargaKg: ultima, motivo: `Última vez: ${ultima} kg bem perto da falha (RIR ${rirUltima}). Mantenha essa carga e capriche na execução hoje.` };
    }
    if (rirUltima != null && rirUltima >= 4) {
      const nova = Math.round((ultima * 1.05 + Number.EPSILON) * 2) / 2;
      const sugerida = Math.max(nova, ultima + 2);
      return { cargaKg: sugerida, motivo: `Última vez: ${ultima} kg sobrando fôlego (RIR ${rirUltima}). Pode subir mais hoje!` };
    }
    const nova = Math.round((ultima * 1.025 + Number.EPSILON) * 2) / 2;
    const sugerida = Math.max(nova, ultima + 1);
    return { cargaKg: sugerida, motivo: `Última vez: ${ultima} kg completando tudo. Bora subir!` };
  }
  return { motivo: 'Primeira vez neste exercício — comece com carga confortável e anote.' };
}
