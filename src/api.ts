import type { DiaAlimentar, DiaTreinoPlano, Exercicio, MetaDiaAlimentar, Perfil, Pesagem, Registro, SugestaoRefeicao, Treino, TipoRefeicao } from './types';
import { cabecalhos, notificarNaoAutorizado } from './session';

async function post<T>(url: string, body: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: cabecalhos({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) notificarNaoAutorizado();
  if (!resp.ok) throw new Error((data as { error?: string }).error || `Erro ${resp.status}`);
  return data as T;
}

async function get<T>(url: string): Promise<T> {
  const resp = await fetch(url, { headers: cabecalhos() });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) notificarNaoAutorizado();
  if (!resp.ok) throw new Error((data as { error?: string }).error || `Erro ${resp.status}`);
  return data as T;
}

export interface JobIA {
  status: 'processando' | 'concluido' | 'falhou';
  erro?: string;
}

export function statusJobIA(jobId: string) {
  return get<JobIA>(`/api/jobs-ia/${jobId}`);
}

// Invalida todos os tokens já emitidos pra esta conta (perde/roubo de aparelho, suspeita de
// token vazado) — inclusive o que está fazendo esta própria chamada; o cliente precisa logar de
// novo em qualquer aparelho depois disso.
export function sairDeTodosAparelhos() {
  return post<{ ok: boolean }>('/api/auth/sair-de-todos-aparelhos', {});
}

export function avaliarDia(
  perfil: Perfil,
  dia: DiaAlimentar,
  sessoesRecentes: unknown[],
  totais?: unknown,
  meta?: unknown,
  atividadeRecente?: unknown,
  avaliacaoAnteriorHoje?: string,
) {
  return post<{ texto: string }>('/api/ai/avaliar', { perfil, dia, sessoesRecentes, totais, meta, atividadeRecente, avaliacaoAnteriorHoje });
}

export interface EstimativaRegistro {
  id: string;
  calorias: number;
  proteinas_g: number;
  carboidratos_g: number;
  gorduras_g: number;
  fibras_g: number;
  comentario: string;
}

export function estimarCalorias(perfil: Perfil, registros: { id: string; tipo: string; descricao: string }[]) {
  return post<{ estimativas: EstimativaRegistro[] }>('/api/ai/calorias', { perfil, registros });
}

export type LeituraBalanca = Partial<Omit<Pesagem, 'data' | 'midias'>> & {
  ehBalanca: boolean;
  pesoKg: number;
  observacao: string;
};

export function analisarBalanca(perfil: Perfil, imagemBase64: string, mediaType: string) {
  return post<LeituraBalanca>('/api/ai/balanca', { perfil, imagemBase64, mediaType });
}

export function sugerirRefeicoes(perfil: Perfil, tipoRefeicao: string, registrosDoDia: Registro[], atividadeRecente?: unknown) {
  return post<{ sugestoes: SugestaoRefeicao[] }>('/api/ai/refeicoes', { perfil, tipoRefeicao, registrosDoDia, atividadeRecente });
}

export interface AnaliseFoto {
  descricao: string;
  calorias: number;
  proteinas_g: number;
  carboidratos_g: number;
  gorduras_g: number;
  fibras_g: number;
  comentario: string;
  ehComida: boolean;
}

export function analisarFoto(perfil: Perfil, imagemBase64: string, mediaType: string, tipoRefeicao: string, correcaoTexto?: string) {
  return post<AnaliseFoto>('/api/ai/foto', { perfil, imagemBase64, mediaType, tipoRefeicao, correcaoTexto });
}

export interface FormCorrida {
  nivelCorrida: string;
  objetivoCorrida: string;
  diasCorrida: string[];
  capacidadeAtual: string;
  observacoes: string;
}

export interface BlocoCorridaIA {
  atividade: 'correr' | 'caminhar';
  ritmo: 'leve' | 'moderado' | 'forte' | 'máximo';
  duracaoSeg: number;
  velocidadeAlvoKmH?: number;
}

export interface EtapaCorridaIA {
  tipo: 'aquecimento' | 'intervalado' | 'continuo' | 'resfriamento';
  repeticoes: number;
  blocos: BlocoCorridaIA[];
}

export interface PlanoCorridaIA {
  nome: string;
  objetivo: string;
  dias: {
    semana: number;
    dia: string;
    tipo: string;
    titulo: string;
    detalhes: string;
    distanciaKm?: number;
    duracaoMin?: number;
    etapas?: EtapaCorridaIA[];
  }[];
  dicas: string;
}

export function gerarPlanoCorrida(perfil: Perfil, form: FormCorrida, corridasRecentes: unknown[], musculacao: unknown) {
  return post<{ jobId: string }>('/api/ai/corrida', { perfil, ...form, corridasRecentes, musculacao });
}

export interface AvaliacaoSono {
  ehSono: boolean;
  data: string;
  sonoHoras: number;
  sonoQualidade: string;
  frequenciaCardiacaMedia: number;
  comentario: string;
}

export function avaliarSono(perfil: Perfil, imagemBase64: string, mediaType: string) {
  return post<AvaliacaoSono>('/api/ai/sono', { perfil, imagemBase64, mediaType });
}

export interface LeituraAtividadeFoto {
  ehIndicadorAtividade: boolean;
  data: string;
  passos: number;
  calorias: number;
  minutosAtivos: number;
  comentario: string;
}

export function analisarAtividadeFoto(perfil: Perfil, imagemBase64: string, mediaType: string) {
  return post<LeituraAtividadeFoto>('/api/ai/atividade-foto', { perfil, imagemBase64, mediaType });
}

export interface LeituraCorridaFoto {
  ehResumoCorrida: boolean;
  data: string;
  distanciaKm: number;
  duracaoMin: number;
  ritmoMinKm: number;
  velocidadeKmH: number;
  calorias: number;
  frequenciaCardiacaMedia: number;
  comentario: string;
}

export function analisarCorridaFoto(perfil: Perfil, imagemBase64: string, mediaType: string) {
  return post<LeituraCorridaFoto>('/api/ai/corrida-foto', { perfil, imagemBase64, mediaType });
}

export function gerarTreino(
  perfil: Perfil,
  local: string,
  foco: string,
  duracaoMin: number,
  historico: { exercicio: string; ultimaCargaKg?: number }[],
  sessoesRecentes?: unknown[],
  planoCorridaResumo?: unknown,
  planoAnteriorResumo?: unknown,
  avaliacaoRecente?: string,
  atividadeRecente?: unknown,
) {
  return post<Omit<Treino, 'id' | 'criadoEm'>>('/api/ai/treino', {
    perfil,
    local,
    foco,
    duracaoMin,
    historico,
    sessoesRecentes,
    planoCorridaResumo,
    planoAnteriorResumo,
    avaliacaoRecente,
    atividadeRecente,
  });
}

export interface ExercicioSubstituto {
  nome: string;
  series: number;
  repeticoes: string;
  cargaSugerida: string;
  descansoSeg: number;
  instrucoes: string;
  dicaRapida: string;
  cadenciaSeg: number;
}

export function trocarExercicio(perfil: Perfil, exercicio: Exercicio, local: string) {
  return post<ExercicioSubstituto>('/api/ai/trocar-exercicio', { perfil, exercicio, local });
}

export interface PlanoMensalIA {
  nome: string;
  semanas: number;
  avaliacaoInicial: string;
  estrategiaMes: string;
  dias: (Omit<DiaTreinoPlano, 'id' | 'exercicios'> & { exercicios: Omit<DiaTreinoPlano['exercicios'][number], 'id'>[] })[];
  recomendacoesGerais: string;
}

export function gerarPlano(
  perfil: Perfil,
  local: string,
  duracaoMin: number,
  semanas: number,
  historico: { exercicio: string; ultimaCargaKg?: number }[],
  sessoesRecentes: unknown[],
  planoCorridaResumo?: unknown,
  planoAnteriorResumo?: unknown,
  foco?: string,
  avaliacaoRecente?: string,
  atividadeRecente?: unknown,
) {
  return post<{ jobId: string }>('/api/ai/plano', {
    perfil,
    local,
    duracaoMin,
    semanas,
    historico,
    sessoesRecentes,
    planoCorridaResumo,
    planoAnteriorResumo,
    foco,
    avaliacaoRecente,
    atividadeRecente,
  });
}

export interface MetaPorDiaSemana {
  diaSemana: string;
  treinoNesteDia: boolean;
  meta: MetaDiaAlimentar | null;
}

export interface ItemRefeicaoIA {
  nome: string;
  quantidade: number;
  unidade: string;
  calorias: number;
  proteinas_g: number;
  carboidratos_g: number;
  gorduras_g: number;
  receitaNome: string;
}

export interface RefeicaoPlanoIA {
  tipo: TipoRefeicao;
  nomeSugerido: string;
  horarioSugerido: string;
  itens: ItemRefeicaoIA[];
  observacao: string;
}

export interface DiaModeloAlimentarIA {
  semanaModelo: 'A' | 'B';
  diaSemana: string;
  refeicoes: RefeicaoPlanoIA[];
}

export interface ReceitaPlanoIA {
  nome: string;
  tempoPreparoMin: number;
  ingredientes: { nome: string; quantidade: number; unidade: string }[];
  modoPreparo: string[];
}

export interface PlanoAlimentarIA {
  nome: string;
  semanas: number;
  avaliacaoInicial: string;
  estrategia: string;
  diasModelo: DiaModeloAlimentarIA[];
  receitas: ReceitaPlanoIA[];
  recomendacoesGerais: string;
}

export function gerarPlanoAlimentar(
  perfil: Perfil,
  semanas: number,
  tiposRefeicao: TipoRefeicao[],
  metasPorDiaSemana: MetaPorDiaSemana[],
  observacoes: string,
  sessoesRecentes: unknown[],
  atividadeRecente?: unknown,
) {
  return post<{ jobId: string }>('/api/ai/plano-alimentar', {
    perfil,
    semanas,
    tiposRefeicao,
    metasPorDiaSemana,
    observacoes,
    sessoesRecentes,
    atividadeRecente,
  });
}
