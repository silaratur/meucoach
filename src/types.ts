export type Objetivo =
  | 'emagrecer'
  | 'hipertrofia'
  | 'definicao'
  | 'recomposicao'
  | 'forca'
  | 'manter'
  | 'resistencia'
  | 'desempenho'
  | 'saude';

export const OBJETIVOS: { value: Objetivo; label: string }[] = [
  { value: 'emagrecer', label: 'Emagrecer' },
  { value: 'hipertrofia', label: 'Ganhar músculo (hipertrofia)' },
  { value: 'definicao', label: 'Definição muscular' },
  { value: 'recomposicao', label: 'Recomposição (perder gordura + ganhar músculo)' },
  { value: 'forca', label: 'Ganhar força' },
  { value: 'manter', label: 'Manter peso e forma' },
  { value: 'resistencia', label: 'Resistência / condicionamento' },
  { value: 'desempenho', label: 'Desempenho esportivo' },
  { value: 'saude', label: 'Saúde geral' },
];

export const SUPLEMENTOS_COMUNS = [
  'Whey protein',
  'Creatina',
  'Ômega 3',
  'Multivitamínico',
  'Vitamina D',
  'Cafeína / pré-treino',
  'Proteína vegetal',
  'BCAA',
  'Glutamina',
  'Colágeno',
  'Magnésio',
  'Melatonina',
];

export type NivelExperiencia = 'nunca' | 'iniciante' | 'intermediario' | 'avancado';

export const NIVEIS_EXPERIENCIA: { value: NivelExperiencia; label: string }[] = [
  { value: 'nunca', label: 'Nunca treinei musculação' },
  { value: 'iniciante', label: 'Iniciante (menos de 6 meses)' },
  { value: 'intermediario', label: 'Intermediário (6 meses a 2 anos)' },
  { value: 'avancado', label: 'Avançado (mais de 2 anos)' },
];

export type HorarioTreino = 'manha' | 'almoco' | 'tarde' | 'noite' | 'varia';

export const HORARIOS_TREINO: { value: HorarioTreino; label: string }[] = [
  { value: 'manha', label: 'Manhã (antes do trabalho)' },
  { value: 'almoco', label: 'Hora do almoço' },
  { value: 'tarde', label: 'Tarde' },
  { value: 'noite', label: 'Noite' },
  { value: 'varia', label: 'Varia' },
];

export const DIAS_SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

export interface Perfil {
  id: string;
  nome: string;
  sexo?: 'M' | 'F';
  nascimento?: string; // "yyyy-MM-dd"
  idade?: number; // calculada a partir do nascimento (mantida para a IA)
  pesoKg?: number;
  pesoMetaKg?: number; // meta de peso, usada no medidor de progresso da Evolução
  alturaCm?: number;
  objetivo: Objetivo;
  restricoes?: string;
  preferencias?: string;
  geladeira?: string;
  suplementos?: string;
  descansoPadraoSeg: number;
  // avaliação do aluno (anamnese de treino)
  nivelExperiencia?: NivelExperiencia;
  frequenciaSemana?: number; // vezes por semana que pretende treinar
  horarioTreino?: HorarioTreino;
  equipamentos?: string; // o que tem disponível / restrições da academia
  restricoesSaude?: string; // lesões, condições médicas ('' = sem restrições)
  diasMusculacao?: string[]; // dias da semana preferidos para musculação
  diasCorrida?: string[]; // dias da semana preferidos para corrida
  objetivosSecundarios?: string;
  preferenciasExercicios?: string; // exercícios que gosta
  exerciciosEvitar?: string; // exercícios que não gosta / não pode fazer
  disponibilidadeCardio?: string; // ex.: "20 min extra 3x/semana", "sem tempo para cardio"
  tema?: 'claro' | 'escuro'; // preferência de tema visual, sincronizada entre aparelhos
}

export type TipoRefeicao =
  | 'cafe'
  | 'lanche_manha'
  | 'almoco'
  | 'lanche_tarde'
  | 'jantar'
  | 'ceia'
  | 'suplemento';

export const TIPOS_REFEICAO: { value: TipoRefeicao; label: string }[] = [
  { value: 'cafe', label: 'Café da manhã' },
  { value: 'lanche_manha', label: 'Lanche da manhã' },
  { value: 'almoco', label: 'Almoço' },
  { value: 'lanche_tarde', label: 'Lanche da tarde' },
  { value: 'jantar', label: 'Jantar' },
  { value: 'ceia', label: 'Ceia' },
  { value: 'suplemento', label: 'Suplemento' },
];

import type { MediaRef } from './media';

export interface Registro {
  id: string;
  tipo: TipoRefeicao;
  descricao: string;
  hora: string; // "HH:mm"
  midias?: MediaRef[];
  // estimativas nutricionais (preenchidas pela IA ou pelas sugestões)
  calorias?: number;
  proteinas_g?: number;
  carboidratos_g?: number;
  gorduras_g?: number;
  fibras_g?: number;
  // comentário da análise nutricional da IA sobre a foto — só existe quando a origem foi uma foto analisada
  analiseIA?: string;
}

export interface DiaAlimentar {
  data: string; // "yyyy-MM-dd"
  registros: Registro[];
}

export interface Exercicio {
  id: string;
  nome: string;
  series: number;
  repeticoes: string; // "8-12", "15", "30s"
  cargaSugerida?: string;
  descansoSeg: number;
  instrucoes?: string;
  midias?: MediaRef[]; // foto/vídeo/áudio de apoio: como executar corretamente
  grupoId?: string; // exercícios com o mesmo grupoId formam um bi-set (2) ou tri-set (3): feitos em sequência, sem descanso entre eles
  cadenciaSeg?: number; // segundos por repetição no ritmo guiado (varia por exercício: composto lento, isolado mais rápido...)
  dicaRapida?: string; // lembrete curtíssimo de execução, falado durante a série guiada (ex.: "Cotovelos fixos")
}

export type LocalTreino = 'academia' | 'casa' | 'rua';

export const LOCAIS: { value: LocalTreino; label: string }[] = [
  { value: 'academia', label: 'Academia' },
  { value: 'casa', label: 'Em casa' },
  { value: 'rua', label: 'Na rua' },
];

export interface Treino {
  id: string;
  nome: string;
  local: LocalTreino;
  aquecimento?: string;
  aquecimentoMin?: number; // minutos de aquecimento/mobilidade — contam dentro da duração total pedida
  dicas?: string;
  exercicios: Exercicio[];
  criadoEm: string;
}

export interface SerieFeita {
  reps?: number;
  cargaKg?: number;
  rir?: number; // repetições em reserva — só coletado na série final de cada exercício
}

export interface ItemSessao {
  nome: string;
  seriesFeitas: SerieFeita[];
}

export interface SessaoTreino {
  id: string;
  treinoId?: string;
  nomeTreino: string;
  local: LocalTreino;
  data: string; // ISO
  duracaoMin?: number;
  itens: ItemSessao[];
  atividadeLivre?: string; // "caminhada 40min", etc.
  corrida?: { distanciaKm: number; duracaoMin: number; ritmoMinKm?: number; velocidadeKmH?: number }; // sessão de corrida com GPS
  rpe?: number; // percepção de esforço, 1 a 10, informada logo após o treino
}

// ---------- Plano de corrida ----------
export interface DiaCorrida {
  id: string;
  semana: number; // 1, 2, 3...
  dia: string; // "Segunda", "Quarta"...
  tipo: string; // "corrida leve", "intervalado", "longão", "descanso", "força"...
  titulo: string;
  detalhes: string;
  distanciaKm?: number;
  duracaoMin?: number;
}

export interface PlanoCorrida {
  id: string;
  nome: string;
  objetivo: string;
  criadoEm: string;
  dias: DiaCorrida[];
  dicas?: string;
  concluidos: string[]; // ids dos dias já feitos
}

// ---------- Plano de musculação (periodização de 4 semanas, dia a dia) ----------
export interface DiaTreinoPlano {
  id: string;
  semana: number; // 1 a 4
  dia: string; // "Segunda", "Quarta"...
  objetivo: string; // objetivo específico do treino do dia
  gruposMusculares: string;
  tempoEstimadoMin: number;
  aquecimento: string;
  aquecimentoMin: number; // minutos de aquecimento — já contados dentro de tempoEstimadoMin
  exercicios: Exercicio[]; // mesmo tipo usado no Treino avulso — dá para jogar direto no player
  cardioRecomendado?: string;
  alongamento?: string;
}

export interface PlanoMusculacao {
  id: string;
  nome: string;
  semanas: number; // duração do plano: 1, 2 ou 4 semanas
  avaliacaoInicial: string;
  estrategiaMes: string; // como o treino evolui ao longo do plano
  dias: DiaTreinoPlano[];
  recomendacoesGerais?: string; // alimentação, sono, recuperação, hidratação, progressão de carga
  local: LocalTreino;
  criadoEm: string;
  concluidos: string[]; // ids dos dias já feitos
}

export interface Avaliacao {
  id: string;
  data: string; // ISO
  texto: string;
}

export interface SugestaoRefeicao {
  nome: string;
  ingredientes: string[];
  preparo: string;
  calorias: number;
  proteinas_g: number;
  carboidratos_g: number;
  gorduras_g: number;
  motivo: string;
}

// ---------- Plano alimentar (semana(s)-modelo geradas por IA, repetidas/alternadas) ----------
// Cópia só dos 4 campos numéricos de MetaDiaria (calc.ts) — não dá pra importar o tipo direto
// daquele arquivo aqui porque calc.ts já importa de types.ts (criaria import circular).
export interface MetaDiaAlimentar {
  kcal: number;
  proteinas_g: number;
  carboidratos_g: number;
  gorduras_g: number;
}

export interface ItemRefeicao {
  id: string;
  nome: string;
  quantidade: number;
  unidade: string; // "g" | "ml" | "unidade" | "colher de sopa" | "fatia" | "xícara"... (texto livre)
  calorias: number;
  proteinas_g: number;
  carboidratos_g: number;
  gorduras_g: number;
  receitaId?: string; // só quando o item exige preparo com passos (referencia ReceitaPlano.id)
}

export interface RefeicaoPlano {
  id: string;
  tipo: TipoRefeicao; // nunca 'suplemento' aqui
  nomeSugerido: string;
  horarioSugerido?: string; // "HH:mm"
  observacao?: string;
  itens: ItemRefeicao[];
}

export interface DiaModeloAlimentar {
  id: string;
  semanaModelo: 'A' | 'B'; // só existe 'B' quando o plano usa 2 semanas-modelo (2-4 semanas)
  diaSemana: string; // um de DIAS_SEMANA
  metaDia: MetaDiaAlimentar | null; // calculada client-side via metaDiaria(), não pela IA
  treinoNesteDia: boolean;
  refeicoes: RefeicaoPlano[];
}

export interface ReceitaPlano {
  id: string;
  nome: string;
  tempoPreparoMin: number;
  ingredientes: { nome: string; quantidade: number; unidade: string }[];
  modoPreparo: string[]; // passos numerados
}

// Preço não entra aqui de propósito: a IA não tem acesso a preços reais de mercado, e uma
// estimativa "aproximada" gerada por ela é confiável demais pra parecer real e errada demais pra
// ser útil. Só quantidade, que é calculada de forma determinística a partir do cardápio.
export interface ItemListaCompras {
  id: string;
  nome: string;
  quantidadeTotal: number;
  unidade: string;
}

export interface PlanoAlimentar {
  id: string;
  nome: string;
  semanas: number; // 1-4, duração real escolhida
  tiposRefeicaoIncluidos: TipoRefeicao[];
  avaliacaoInicial: string; // markdown
  estrategia: string; // markdown
  diasModelo: DiaModeloAlimentar[]; // 7 itens (só template A) ou 14 (A+B)
  receitas: ReceitaPlano[]; // de-duplicadas
  listaCompras: ItemListaCompras[]; // já agregada para TODO o período do plano
  recomendacoesGerais?: string; // markdown
  criadoEm: string;
}

export interface Pesagem {
  data: string; // "yyyy-MM-dd"
  pesoKg: number;
  // dados de bioimpedância (lidos da foto da balança pela IA)
  imc?: number;
  gorduraPct?: number;
  massaMagraKg?: number;
  musculoKg?: number;
  aguaPct?: number;
  gorduraVisceral?: number;
  metabolismoKcal?: number;
  midias?: MediaRef[];
}

// ---------- Atividade e sono (importados do Samsung Health) ----------
export interface AtividadeDiaria {
  data: string; // "yyyy-MM-dd"
  passos?: number;
  calorias?: number;
  sonoHoras?: number;
  sonoQualidade?: string;
  frequenciaCardiacaMedia?: number;
  minutosAtivos?: number;
  fonte: string; // "samsung_health"
}

export interface DadosPerfil {
  dias: Record<string, DiaAlimentar>;
  treinos: Treino[];
  sessoes: SessaoTreino[];
  avaliacoes: Avaliacao[];
  pesagens: Pesagem[];
  planosCorrida: PlanoCorrida[];
  planosMusculacao: PlanoMusculacao[];
  planosAlimentares: PlanoAlimentar[];
  atividadesDiarias: AtividadeDiaria[];
}
