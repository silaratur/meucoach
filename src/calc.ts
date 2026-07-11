// Cálculos de saúde: idade, gasto calórico e metas diárias.
import type { AtividadeDiaria, Perfil, Registro, SerieFeita, SessaoTreino } from './types';
import { DIAS_SEMANA } from './types';

// Nome do dia da semana de hoje, no mesmo formato de DIAS_SEMANA (ex.: "Segunda").
export function diaSemanaHoje(): string {
  const idx = new Date().getDay(); // 0=domingo..6=sábado
  return DIAS_SEMANA[(idx + 6) % 7];
}

// Data LOCAL (yyyy-MM-dd) de um instante ISO — NUNCA use isoString.slice(0,10) para saber
// "que dia local é esse instante": toISOString() é UTC, e no Brasil (UTC-3) qualquer horário
// entre ~21h e 23h59 local já virou o dia seguinte em UTC, quebrando comparações de "mesmo dia".
export function dataLocalDe(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function idadeDe(nascimento?: string): number | undefined {
  if (!nascimento) return undefined;
  const n = new Date(nascimento + 'T00:00:00');
  if (isNaN(n.getTime())) return undefined;
  const hoje = new Date();
  let idade = hoje.getFullYear() - n.getFullYear();
  const aniversarioPassou =
    hoje.getMonth() > n.getMonth() || (hoje.getMonth() === n.getMonth() && hoje.getDate() >= n.getDate());
  if (!aniversarioPassou) idade--;
  return idade >= 5 && idade <= 120 ? idade : undefined;
}

export interface MetaDiaria {
  kcal: number;
  proteinas_g: number;
  descricao: string;
}

// Resumo dos últimos N dias de atividade/sono importados do Samsung Health.
export function resumoAtividade(atividades: AtividadeDiaria[], dias = 7): { passosMedia?: number; sonoMedia?: number; dias: number } {
  const corte = Date.now() - dias * 24 * 60 * 60 * 1000;
  const recentes = atividades.filter((a) => new Date(a.data + 'T12:00:00').getTime() >= corte);
  const passos = recentes.map((a) => a.passos).filter((v): v is number => typeof v === 'number');
  const sono = recentes.map((a) => a.sonoHoras).filter((v): v is number => typeof v === 'number');
  return {
    passosMedia: passos.length ? Math.round(passos.reduce((a, b) => a + b, 0) / passos.length) : undefined,
    sonoMedia: sono.length ? Math.round((sono.reduce((a, b) => a + b, 0) / sono.length) * 10) / 10 : undefined,
    dias: recentes.length,
  };
}

// Mifflin-St Jeor + fator de atividade (pela frequência real de treinos + passos do wearable) + ajuste do objetivo.
// treinoHoje: true = hoje tem musculação/corrida planejada ou já registrada (meta sobe, alinhada ao gasto do dia);
// false = hoje é dia de descanso (meta um pouco mais enxuta); undefined = não considera o dia específico.
export function metaDiaria(
  perfil: Perfil,
  sessoes: SessaoTreino[],
  atividades: AtividadeDiaria[] = [],
  treinoHoje?: boolean,
): MetaDiaria | null {
  const idade = perfil.idade ?? idadeDe(perfil.nascimento);
  if (!perfil.pesoKg || !perfil.alturaCm || !idade || !perfil.sexo) return null;

  const base =
    10 * perfil.pesoKg + 6.25 * perfil.alturaCm - 5 * idade + (perfil.sexo === 'M' ? 5 : -161);

  const seteDias = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const treinosSemana = sessoes.filter((s) => new Date(s.data).getTime() >= seteDias).length;
  let fator = treinosSemana >= 5 ? 1.7 : treinosSemana >= 3 ? 1.55 : treinosSemana >= 1 ? 1.42 : 1.3;

  // Passos diários do wearable refinam o fator de atividade (NEAT) além da frequência de treino.
  const { passosMedia } = resumoAtividade(atividades, 7);
  if (passosMedia != null) {
    if (passosMedia >= 10000) fator += 0.1;
    else if (passosMedia >= 7000) fator += 0.05;
    else if (passosMedia < 3000) fator -= 0.05;
  }

  // Alinha a meta calórica de HOJE especificamente ao que está previsto/feito hoje, não só à média semanal.
  let notaDia = '';
  if (treinoHoje === true) {
    fator += 0.1;
    notaDia = ' · hoje é dia de treino, meta ajustada para cima';
  } else if (treinoHoje === false) {
    fator -= 0.05;
    notaDia = ' · hoje é dia de descanso, meta um pouco mais enxuta';
  }

  const ajuste: Record<Perfil['objetivo'], number> = {
    emagrecer: 0.8,
    definicao: 0.85,
    recomposicao: 0.92,
    manter: 1,
    saude: 1,
    resistencia: 1.05,
    desempenho: 1.05,
    hipertrofia: 1.1,
    forca: 1.1,
  };

  const kcal = Math.round((base * fator * ajuste[perfil.objetivo]) / 10) * 10;
  const gPorKg =
    perfil.objetivo === 'emagrecer' || perfil.objetivo === 'definicao' || perfil.objetivo === 'recomposicao'
      ? 2.0
      : perfil.objetivo === 'hipertrofia' || perfil.objetivo === 'forca'
        ? 1.8
        : 1.5;
  return {
    kcal,
    proteinas_g: Math.round(perfil.pesoKg * gPorKg),
    descricao: `${treinosSemana} treino(s) nos últimos 7 dias${notaDia}`,
  };
}

export interface TotaisDia {
  calorias: number;
  proteinas_g: number;
  carboidratos_g: number;
  gorduras_g: number;
  itensComEstimativa: number;
  itensSemEstimativa: number;
}

export function totaisDoDia(registros: Registro[]): TotaisDia {
  const t: TotaisDia = { calorias: 0, proteinas_g: 0, carboidratos_g: 0, gorduras_g: 0, itensComEstimativa: 0, itensSemEstimativa: 0 };
  for (const r of registros) {
    if (typeof r.calorias === 'number') {
      t.calorias += r.calorias;
      t.proteinas_g += r.proteinas_g ?? 0;
      t.carboidratos_g += r.carboidratos_g ?? 0;
      t.gorduras_g += r.gorduras_g ?? 0;
      t.itensComEstimativa++;
    } else {
      t.itensSemEstimativa++;
    }
  }
  return t;
}

// Link de demonstração em vídeo para um exercício (busca no YouTube).
export function linkVideoExercicio(nome: string): string {
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(`como fazer ${nome} execução correta forma`);
}

// Ícone de equipamento inferido pelo nome do exercício — não há campo estruturado de
// equipamento hoje, então isso é uma heurística client-side (sem mudar schema/prompt).
export function iconeEquipamento(nomeExercicio: string): string {
  const n = nomeExercicio.toLowerCase();
  if (/(cabo|polia|puxada|pulley)/.test(n)) return '🔗';
  if (/(m[aá]quina|leg press|hack|smith|peck deck)/.test(n)) return '⚙️';
  if (/(halter|dumbbell)/.test(n)) return '🏋️';
  if (/(barra fixa|paralelas|argolas|suspens[aã]o|trx)/.test(n)) return '🤸';
  if (/(barra|barbell)/.test(n)) return '🏋️‍♂️';
  if (/(corrida|esteira|bike|el[íi]ptico|remo(?!ada))/.test(n)) return '🏃';
  return '💪';
}

// Últimas séries feitas de um exercício (para o "Histórico" durante a execução).
export function ultimasSeriesDoExercicio(
  sessoes: SessaoTreino[],
  nomeExercicio: string,
  limite = 3,
): { data: string; seriesFeitas: SerieFeita[] }[] {
  const nome = nomeExercicio.trim().toLowerCase();
  const resultado: { data: string; seriesFeitas: SerieFeita[] }[] = [];
  for (const s of sessoes) {
    if (resultado.length >= limite) break;
    const item = s.itens.find((i) => i.nome.trim().toLowerCase() === nome);
    if (item && item.seriesFeitas.length) resultado.push({ data: s.data, seriesFeitas: item.seriesFeitas });
  }
  return resultado;
}

// ---------- Recordes pessoais (PRs) ----------
// Maior carga já registrada para um exercício (varrendo todas as sessões salvas).
export function maiorCargaHistorica(sessoes: SessaoTreino[], nomeExercicio: string): number {
  const nome = nomeExercicio.trim().toLowerCase();
  let maior = 0;
  for (const s of sessoes) {
    for (const item of s.itens) {
      if (item.nome.trim().toLowerCase() !== nome) continue;
      for (const serie of item.seriesFeitas) {
        if (serie.cargaKg && serie.cargaKg > maior) maior = serie.cargaKg;
      }
    }
  }
  return maior;
}

export interface RecordePessoal {
  nome: string;
  cargaKg: number;
  data: string;
}

// Lista o melhor (maior carga) já feito em cada exercício, para exibir na Evolução.
export function recordesPessoais(sessoes: SessaoTreino[]): RecordePessoal[] {
  const melhores = new Map<string, RecordePessoal>();
  for (const s of [...sessoes].sort((a, b) => a.data.localeCompare(b.data))) {
    for (const item of s.itens) {
      const cargas = item.seriesFeitas.map((x) => x.cargaKg).filter((c): c is number => !!c && c > 0);
      if (!cargas.length) continue;
      const maiorDaSessao = Math.max(...cargas);
      const chave = item.nome.trim().toLowerCase();
      const atual = melhores.get(chave);
      if (!atual || maiorDaSessao >= atual.cargaKg) {
        melhores.set(chave, { nome: item.nome.trim(), cargaKg: maiorDaSessao, data: s.data.slice(0, 10) });
      }
    }
  }
  return [...melhores.values()].sort((a, b) => b.data.localeCompare(a.data));
}

// ---------- Sequência (streak) de dias ativos ----------
function paraChaveData(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function streakDias(sessoes: SessaoTreino[]): number {
  const diasComSessao = new Set(sessoes.map((s) => dataLocalDe(s.data)));
  const cursor = new Date();
  // se ainda não treinou hoje, a sequência conta até ontem (não quebra só por ainda ser cedo)
  if (!diasComSessao.has(paraChaveData(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (diasComSessao.has(paraChaveData(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
