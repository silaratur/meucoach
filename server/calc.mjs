// Versão server-side (JS puro) das funções de cálculo de src/calc.ts — necessária para o job
// automático (relatório das 22:30), que roda sem um cliente/navegador disparando a requisição.
// Mantenha em sincronia com src/calc.ts se a lógica de meta calórica mudar de um lado.

const FUSO = 'America/Sao_Paulo'; // app é só para o Brasil; sem timezone por perfil ainda

export function dataSaoPauloISO(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function dataSaoPauloDe(iso) {
  return dataSaoPauloISO(new Date(iso));
}

export function horaMinutoSaoPaulo(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

const DIAS_SEMANA_PT = {
  monday: 'Segunda',
  tuesday: 'Terça',
  wednesday: 'Quarta',
  thursday: 'Quinta',
  friday: 'Sexta',
  saturday: 'Sábado',
  sunday: 'Domingo',
};

export function diaSemanaSaoPaulo(date = new Date()) {
  const nome = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'long' }).format(date).toLowerCase();
  return DIAS_SEMANA_PT[nome] ?? nome;
}

export function idadeDe(nascimento) {
  if (!nascimento) return undefined;
  const n = new Date(nascimento + 'T00:00:00');
  if (isNaN(n.getTime())) return undefined;
  const hoje = new Date();
  let idade = hoje.getFullYear() - n.getFullYear();
  const aniversarioPassou = hoje.getMonth() > n.getMonth() || (hoje.getMonth() === n.getMonth() && hoje.getDate() >= n.getDate());
  if (!aniversarioPassou) idade--;
  return idade >= 5 && idade <= 120 ? idade : undefined;
}

export function resumoAtividade(atividades, dias = 7) {
  const corte = Date.now() - dias * 24 * 60 * 60 * 1000;
  const recentes = (atividades ?? []).filter((a) => new Date(a.data + 'T12:00:00').getTime() >= corte);
  const passos = recentes.map((a) => a.passos).filter((v) => typeof v === 'number');
  const sono = recentes.map((a) => a.sonoHoras).filter((v) => typeof v === 'number');
  return {
    passosMedia: passos.length ? Math.round(passos.reduce((a, b) => a + b, 0) / passos.length) : undefined,
    sonoMedia: sono.length ? Math.round((sono.reduce((a, b) => a + b, 0) / sono.length) * 10) / 10 : undefined,
    dias: recentes.length,
  };
}

export function metaDiaria(perfil, sessoes, atividades = [], treinoHoje) {
  const idade = perfil?.idade ?? idadeDe(perfil?.nascimento);
  if (!perfil?.pesoKg || !perfil?.alturaCm || !idade || !perfil?.sexo) return null;

  const base = 10 * perfil.pesoKg + 6.25 * perfil.alturaCm - 5 * idade + (perfil.sexo === 'M' ? 5 : -161);

  const seteDias = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const treinosSemana = (sessoes ?? []).filter((s) => new Date(s.data).getTime() >= seteDias).length;
  let fator = treinosSemana >= 5 ? 1.7 : treinosSemana >= 3 ? 1.55 : treinosSemana >= 1 ? 1.42 : 1.3;

  const { passosMedia } = resumoAtividade(atividades, 7);
  if (passosMedia != null) {
    if (passosMedia >= 10000) fator += 0.1;
    else if (passosMedia >= 7000) fator += 0.05;
    else if (passosMedia < 3000) fator -= 0.05;
  }

  let notaDia = '';
  if (treinoHoje === true) {
    fator += 0.1;
    notaDia = ' · hoje é dia de treino, meta ajustada para cima';
  } else if (treinoHoje === false) {
    fator -= 0.05;
    notaDia = ' · hoje é dia de descanso, meta um pouco mais enxuta';
  }

  const ajuste = {
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

  const kcal = Math.round((base * fator * (ajuste[perfil.objetivo] ?? 1)) / 10) * 10;
  const gPorKg =
    perfil.objetivo === 'emagrecer' || perfil.objetivo === 'definicao' || perfil.objetivo === 'recomposicao'
      ? 2.0
      : perfil.objetivo === 'hipertrofia' || perfil.objetivo === 'forca'
        ? 1.8
        : 1.5;
  const proteinas_g = Math.round(perfil.pesoKg * gPorKg);
  // Gordura como 25% do total (dentro da faixa 20-35% recomendada) e carboidrato absorve o
  // resto — assim os três macros sempre somam de volta ao total de calorias da meta.
  const gorduras_g = Math.round((kcal * 0.25) / 9);
  const carboidratos_g = Math.max(0, Math.round((kcal - proteinas_g * 4 - gorduras_g * 9) / 4));
  return {
    kcal,
    proteinas_g,
    carboidratos_g,
    gorduras_g,
    descricao: `${treinosSemana} treino(s) nos últimos 7 dias${notaDia}`,
  };
}

export function totaisDoDia(registros) {
  const t = { calorias: 0, proteinas_g: 0, carboidratos_g: 0, gorduras_g: 0, itensComEstimativa: 0, itensSemEstimativa: 0 };
  for (const r of registros ?? []) {
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
