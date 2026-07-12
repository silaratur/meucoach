// Ilustração de grupo muscular via wger.de — base de exercícios aberta (AGPL 3+), dados de
// músculo/imagem sob CC-BY-SA 3.0/4.0 (exige atribuição na UI). Alternativa gratuita ao banco 3D
// proprietário: a cobertura em português é parcial (só uma fração das ~3300 traduções do wger é
// PT), então nem todo exercício gerado pela IA vai ter correspondência — quando não achar, o
// chamador deve cair de volta para a ilustração por IA existente (gerarImagemExercicio).
import { db } from './db.mjs';

const WGER_BASE = 'https://wger.de/api/v2';
const LANG_PT = 7;

const PARADAS_PT = new Set([
  'de', 'da', 'do', 'das', 'dos', 'com', 'em', 'no', 'na', 'nos', 'nas',
  'e', 'a', 'o', 'as', 'os', 'para', 'por', 'um', 'uma', 'ao', 'aos',
]);

function normalizar(nome) {
  return nome
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizar(nome) {
  return normalizar(nome)
    .split(' ')
    .filter((t) => t.length > 2 && !PARADAS_PT.has(t));
}

// Cache em memória de todas as traduções em português — carregada uma vez por processo do
// servidor. A API do wger ignora silenciosamente o filtro "?language=" (testado: retorna sempre
// o total não filtrado), então é preciso paginar tudo e filtrar no cliente.
let traducoesPT = null;

async function carregarTraducoesPT() {
  if (traducoesPT) return traducoesPT;
  const encontradas = [];
  const limit = 500;
  let offset = 0;
  for (;;) {
    const resp = await fetch(`${WGER_BASE}/exercise-translation/?limit=${limit}&offset=${offset}`);
    if (!resp.ok) throw new Error(`wger exercise-translation respondeu ${resp.status}`);
    const pagina = await resp.json();
    for (const item of pagina.results) {
      if (item.language === LANG_PT) {
        encontradas.push({ exercicioId: item.exercise, nome: item.name, tokens: tokenizar(item.name) });
      }
    }
    if (!pagina.next) break;
    offset += limit;
  }
  traducoesPT = encontradas;
  return traducoesPT;
}

// Correspondência por sobreposição de palavras (ignorando preposições/artigos em PT), com um
// limiar mínimo pra evitar falso-positivo entre exercícios parecidos mas distintos.
function melhorCorrespondencia(nomeExercicio, lista) {
  const alvo = tokenizar(nomeExercicio);
  if (!alvo.length) return null;
  let melhor = null;
  let melhorScore = 0;
  for (const cand of lista) {
    const comuns = cand.tokens.filter((t) => alvo.includes(t));
    if (!comuns.some((t) => t.length >= 4)) continue;
    const score = comuns.length / Math.max(alvo.length, cand.tokens.length);
    if (score > melhorScore) {
      melhorScore = score;
      melhor = cand;
    }
  }
  return melhorScore >= 0.4 ? melhor : null;
}

// Retorna { svgUrl, musculoNome } para o principal músculo trabalhado, ou null se não achar
// correspondência confiável. Resultado (positivo ou negativo) é cacheado globalmente por nome —
// exceto quando a falha foi de rede/API, caso em que não cacheia e deixa a próxima chamada tentar
// de novo.
export async function buscarMusculoExercicio(nomeExercicio) {
  const chave = normalizar(nomeExercicio);
  const cache = db.prepare('SELECT svg_url, musculo_nome FROM musculo_exercicio WHERE nome = ?').get(chave);
  if (cache) return cache.svg_url ? { svgUrl: cache.svg_url, musculoNome: cache.musculo_nome } : null;

  let resultado = null;
  let devecachear = true;
  try {
    const lista = await carregarTraducoesPT();
    const match = melhorCorrespondencia(nomeExercicio, lista);
    if (match) {
      const resp = await fetch(`${WGER_BASE}/exerciseinfo/${match.exercicioId}/`);
      if (resp.ok) {
        const info = await resp.json();
        const musculo = info.muscles?.[0] ?? info.muscles_secondary?.[0];
        if (musculo?.image_url_main) {
          resultado = { svgUrl: musculo.image_url_main, musculoNome: musculo.name_en || musculo.name };
        }
      } else {
        devecachear = false;
      }
    }
  } catch {
    devecachear = false;
  }

  if (devecachear) {
    db.prepare(
      'INSERT INTO musculo_exercicio (nome, svg_url, musculo_nome, encontrado_em) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(nome) DO UPDATE SET svg_url = excluded.svg_url, musculo_nome = excluded.musculo_nome, encontrado_em = excluded.encontrado_em',
    ).run(chave, resultado?.svgUrl ?? null, resultado?.musculoNome ?? null, new Date().toISOString());
  }

  return resultado;
}
