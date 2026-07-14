import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { db, JWT_SECRET, uid } from './db.mjs';
import { dataSaoPauloDe, dataSaoPauloISO, diaSemanaSaoPaulo, horaMinutoSaoPaulo, metaDiaria, resumoAtividade, totaisDoDia } from './calc.mjs';
import { buscarMusculoExercicio } from './wger.mjs';
import {
  assinaturaConfigurada,
  cancelarPreapproval,
  consultarPreapproval,
  criarAssinatura,
  infoPreco,
  statusInterno,
  validarAssinaturaWebhook,
} from './mercadopago.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Atrás do Traefik (proxy reverso que termina o TLS): sem isso, req.protocol sempre volta
// 'http' mesmo em produção (https), quebrando o back_url que mandamos pro Mercado Pago.
app.set('trust proxy', 1);
app.use(express.json({ limit: '15mb' })); // fotos comprimidas em base64 passam por aqui

const PORT = process.env.PORT || 8787;
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 65 * 1024 * 1024 } });

const DADOS_VAZIOS = { dias: {}, treinos: [], sessoes: [], avaliacoes: [], pesagens: [], planosCorrida: [], atividadesDiarias: [], planosMusculacao: [] };

// ---------- Autenticação (nome + PIN) ----------
function validarNomePin(nome, pin) {
  if (typeof nome !== 'string' || !nome.trim()) return 'Informe um nome.';
  if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) return 'O PIN deve ter de 4 a 6 números.';
  return null;
}

function assinarToken(perfilId) {
  return jwt.sign({ pid: perfilId }, JWT_SECRET, { expiresIn: '3650d' });
}

app.post('/api/auth/criar', (req, res) => {
  const { nome, pin } = req.body ?? {};
  const erro = validarNomePin(nome, pin);
  if (erro) return res.status(400).json({ error: erro });

  const nomeLower = nome.trim().toLowerCase();
  const existe = db.prepare('SELECT id FROM perfis WHERE nome_lower = ?').get(nomeLower);
  if (existe) {
    return res.status(409).json({ error: 'Já existe uma conta com esse nome. Se for você, use "Entrar".' });
  }

  const id = uid();
  const agora = new Date().toISOString();
  const perfil = { id, nome: nome.trim(), objetivo: 'saude', descansoPadraoSeg: 90 };
  db.prepare(
    `INSERT INTO perfis (id, nome_lower, pin_hash, perfil_json, dados_json, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, nomeLower, bcrypt.hashSync(pin, 10), JSON.stringify(perfil), JSON.stringify(DADOS_VAZIOS), agora, agora);

  res.json({ token: assinarToken(id), perfil });
});

app.post('/api/auth/entrar', (req, res) => {
  const { nome, pin } = req.body ?? {};
  const erro = validarNomePin(nome, pin);
  if (erro) return res.status(400).json({ error: erro });

  const nomeLower = nome.trim().toLowerCase();
  const row = db.prepare('SELECT id, pin_hash, perfil_json, dados_json FROM perfis WHERE nome_lower = ?').get(nomeLower);
  if (!row) return res.status(404).json({ error: 'Não encontrei ninguém com esse nome. Quer criar uma conta?' });
  if (!bcrypt.compareSync(pin, row.pin_hash)) return res.status(401).json({ error: 'PIN incorreto.' });

  res.json({
    token: assinarToken(row.id),
    perfil: JSON.parse(row.perfil_json),
    dados: { ...DADOS_VAZIOS, ...JSON.parse(row.dados_json) },
  });
});

function autenticar(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return res.status(401).json({ error: 'Não autenticado. Faça login novamente.' });
  try {
    req.perfilId = jwt.verify(m[1], JWT_SECRET).pid;
    next();
  } catch {
    res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }
}

// Bloqueia rotas que custam crédito de IA quando não há assinatura ativa. Se o Mercado Pago não
// estiver configurado neste servidor (dev/local, sem MERCADOPAGO_ACCESS_TOKEN), deixa passar tudo
// — mesmo padrão do GEMINI_API_KEY opcional, pra não travar o desenvolvimento local.
const DIAS_TOLERANCIA_ATRASO = 3;

function exigirAssinaturaAtiva(req, res, next) {
  if (!assinaturaConfigurada()) return next();
  const row = db.prepare('SELECT status, valida_ate FROM assinaturas WHERE perfil_id = ?').get(req.perfilId);
  const status = row?.status ?? 'inativa';
  if (status === 'ativa' || status === 'isenta') return next();
  if (status === 'atrasada' && row.valida_ate) {
    const limite = new Date(row.valida_ate).getTime() + DIAS_TOLERANCIA_ATRASO * 24 * 60 * 60 * 1000;
    if (Date.now() <= limite) return next();
  }
  res.status(402).json({ error: 'Assinatura necessária para usar essa função. Veja em Perfil > Assinatura.' });
}

// ---------- Perfil e dados (protegidos) ----------
app.get('/api/perfil', autenticar, (req, res) => {
  const row = db.prepare('SELECT perfil_json, dados_json FROM perfis WHERE id = ?').get(req.perfilId);
  if (!row) return res.status(404).json({ error: 'Conta não encontrada.' });
  // Mescla com os defaults para contas antigas que ainda não têm campos novos (evita quebrar no cliente).
  res.json({ perfil: JSON.parse(row.perfil_json), dados: { ...DADOS_VAZIOS, ...JSON.parse(row.dados_json) } });
});

app.put('/api/perfil', autenticar, (req, res) => {
  const perfil = { ...req.body, id: req.perfilId };
  if (!perfil.nome || !perfil.nome.trim()) return res.status(400).json({ error: 'Nome não pode ficar vazio.' });
  const agora = new Date().toISOString();
  const info = db
    .prepare('UPDATE perfis SET nome_lower = ?, perfil_json = ?, atualizado_em = ? WHERE id = ?')
    .run(perfil.nome.trim().toLowerCase(), JSON.stringify(perfil), agora, req.perfilId);
  if (info.changes === 0) return res.status(404).json({ error: 'Conta não encontrada.' });
  res.json({ ok: true });
});

app.put('/api/dados', autenticar, (req, res) => {
  const agora = new Date().toISOString();
  const info = db
    .prepare('UPDATE perfis SET dados_json = ?, atualizado_em = ? WHERE id = ?')
    .run(JSON.stringify(req.body ?? {}), agora, req.perfilId);
  if (info.changes === 0) return res.status(404).json({ error: 'Conta não encontrada.' });
  res.json({ ok: true });
});

app.delete('/api/perfil', autenticar, (req, res) => {
  db.prepare('DELETE FROM midias WHERE perfil_id = ?').run(req.perfilId);
  db.prepare('DELETE FROM perfis WHERE id = ?').run(req.perfilId);
  res.json({ ok: true });
});

// ---------- Assinatura (Mercado Pago) ----------
app.get('/api/assinatura', autenticar, (req, res) => {
  const row = db.prepare('SELECT status, valida_ate FROM assinaturas WHERE perfil_id = ?').get(req.perfilId);
  res.json({ status: row?.status ?? 'inativa', validaAte: row?.valida_ate ?? null, ...infoPreco() });
});

app.post('/api/assinatura/iniciar', autenticar, async (req, res) => {
  if (!assinaturaConfigurada()) return res.status(503).json({ error: 'Assinatura não configurada neste servidor.' });
  const row = db.prepare('SELECT perfil_json FROM perfis WHERE id = ?').get(req.perfilId);
  if (!row) return res.status(404).json({ error: 'Conta não encontrada.' });
  const perfil = JSON.parse(row.perfil_json);
  if (!perfil.email) return res.status(400).json({ error: 'Informe seu e-mail no Perfil antes de assinar.' });
  try {
    const backUrl = `${req.protocol}://${req.get('host')}/?assinatura=retorno`;
    const { initPoint, preapprovalId } = await criarAssinatura(req.perfilId, perfil.email, backUrl);
    const agora = new Date().toISOString();
    db.prepare(
      `INSERT INTO assinaturas (perfil_id, status, mp_preapproval_id, mp_payer_email, atualizado_em)
       VALUES (?, 'inativa', ?, ?, ?)
       ON CONFLICT(perfil_id) DO UPDATE SET mp_preapproval_id = excluded.mp_preapproval_id, mp_payer_email = excluded.mp_payer_email, atualizado_em = excluded.atualizado_em`,
    ).run(req.perfilId, preapprovalId, perfil.email, agora);
    res.json({ initPoint });
  } catch (e) {
    res.status(502).json({ error: 'Falha ao criar assinatura: ' + e.message });
  }
});

app.post('/api/assinatura/cancelar', autenticar, async (req, res) => {
  const row = db.prepare('SELECT mp_preapproval_id FROM assinaturas WHERE perfil_id = ?').get(req.perfilId);
  if (!row?.mp_preapproval_id) return res.status(404).json({ error: 'Nenhuma assinatura encontrada.' });
  try {
    await cancelarPreapproval(row.mp_preapproval_id);
    db.prepare("UPDATE assinaturas SET status = 'cancelada', atualizado_em = ? WHERE perfil_id = ?").run(
      new Date().toISOString(),
      req.perfilId,
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: 'Falha ao cancelar assinatura: ' + e.message });
  }
});

// SEM `autenticar`: quem chama é o Mercado Pago, não o usuário — a autenticidade vem da
// validação HMAC do header x-signature (validarAssinaturaWebhook), não de um token de sessão.
app.post('/api/mercadopago/webhook', async (req, res) => {
  if (!validarAssinaturaWebhook(req)) return res.status(401).end();
  const preapprovalId = req.body?.data?.id || req.query['data.id'];
  if (!preapprovalId) return res.status(200).end(); // notificação de outro tipo de evento, ignora
  try {
    const info = await consultarPreapproval(preapprovalId);
    const perfilId = info.external_reference;
    if (perfilId) {
      db.prepare(
        `INSERT INTO assinaturas (perfil_id, status, valida_ate, mp_preapproval_id, mp_payer_email, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(perfil_id) DO UPDATE SET status = excluded.status, valida_ate = excluded.valida_ate,
           mp_preapproval_id = excluded.mp_preapproval_id, atualizado_em = excluded.atualizado_em`,
      ).run(
        perfilId,
        statusInterno(info.status),
        info.next_payment_date ?? null,
        preapprovalId,
        info.payer_email ?? null,
        new Date().toISOString(),
      );
    }
  } catch (e) {
    console.error('Erro ao processar webhook do Mercado Pago:', e);
  }
  res.status(200).end();
});

// ---------- Mídias (fotos, vídeos, áudios) ----------
app.post('/api/midia', autenticar, upload.single('arquivo'), (req, res) => {
  const tipo = req.body?.tipo;
  if (!req.file || !['foto', 'video', 'audio'].includes(tipo)) {
    return res.status(400).json({ error: 'Arquivo ou tipo inválido.' });
  }
  const id = uid();
  db.prepare(
    'INSERT INTO midias (id, perfil_id, tipo, mime, criado_em, dados) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, req.perfilId, tipo, req.file.mimetype || 'application/octet-stream', new Date().toISOString(), req.file.buffer);
  res.json({ id, tipo });
});

app.get('/api/midia/:id', autenticar, (req, res) => {
  const row = db
    .prepare('SELECT mime, dados FROM midias WHERE id = ? AND perfil_id = ?')
    .get(req.params.id, req.perfilId);
  if (!row) return res.status(404).end();
  res.set('Content-Type', row.mime);
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.send(row.dados);
});

app.delete('/api/midia/:id', autenticar, (req, res) => {
  db.prepare('DELETE FROM midias WHERE id = ? AND perfil_id = ?').run(req.params.id, req.perfilId);
  res.json({ ok: true });
});

// ---------- Imagem ilustrativa de exercício (gerada por IA, cacheada por nome) ----------
function normalizarNomeExercicio(nome) {
  return nome
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/\s+/g, ' ');
}

async function gerarImagemExercicio(nomeExercicio) {
  const prompt = `Ilustração simples em estilo flat/vetor mostrando a execução correta do exercício de musculação "${nomeExercicio}": uma pessoa em vista lateral, postura anatomicamente correta, fundo neutro liso, sem texto, sem logotipos, foco didático na técnica.`;
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: '4:3' },
      }),
    },
  );
  if (!resp.ok) throw new Error(`Gemini respondeu ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const previsao = data.predictions?.[0];
  if (!previsao?.bytesBase64Encoded) throw new Error('Gemini não retornou imagem.');
  return { mime: previsao.mimeType || 'image/png', dados: Buffer.from(previsao.bytesBase64Encoded, 'base64') };
}

app.get('/api/exercicio-imagem', autenticar, exigirAssinaturaAtiva, async (req, res) => {
  const nomeOriginal = String(req.query.nome || '').trim();
  if (!nomeOriginal) return res.status(400).json({ error: 'Nome do exercício obrigatório.' });
  const chave = normalizarNomeExercicio(nomeOriginal);

  const cache = db.prepare('SELECT mime, dados FROM imagens_exercicio WHERE nome = ?').get(chave);
  if (cache) {
    res.set('Content-Type', cache.mime);
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    return res.send(cache.dados);
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'Geração de imagem de exercício não configurada (falta GEMINI_API_KEY).' });
  }
  try {
    const { mime, dados } = await gerarImagemExercicio(nomeOriginal);
    db.prepare('INSERT OR REPLACE INTO imagens_exercicio (nome, mime, dados, criado_em) VALUES (?, ?, ?, ?)').run(
      chave,
      mime,
      dados,
      new Date().toISOString(),
    );
    res.set('Content-Type', mime);
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(dados);
  } catch (e) {
    res.status(502).json({ error: 'Falha ao gerar imagem do exercício: ' + e.message });
  }
});

// ---------- Grupo muscular do exercício (wger.de, base aberta — fallback gratuito ao banco 3D) ----------
app.get('/api/exercicio-musculo', autenticar, async (req, res) => {
  const nomeExercicio = String(req.query.nome || '').trim();
  if (!nomeExercicio) return res.status(400).json({ error: 'Nome do exercício obrigatório.' });
  try {
    const resultado = await buscarMusculoExercicio(nomeExercicio);
    res.json(resultado ?? { svgUrl: null, musculoNome: null });
  } catch (e) {
    res.status(502).json({ error: 'Falha ao buscar músculo do exercício: ' + e.message });
  }
});

const SYSTEM = `Você é o "Meu Coach", um personal trainer especialista em musculação e atividade física, e também nutricionista esportivo. Você atende famílias brasileiras pelo aplicativo.

Princípios:
- Fale sempre em português do Brasil, com tom encorajador, direto e prático — como um bom personal que conhece o aluno há anos.
- Adapte TUDO ao objetivo da pessoa (emagrecer, hipertrofia, manter, resistência, saúde geral), às restrições/preferências alimentares e ao que ela tem disponível em casa.
- Seja realista: sugira comida brasileira acessível e treinos executáveis no local indicado (academia, casa ou rua).
- Nunca prescreva medicamentos. Em sinais de risco (dor no peito, lesão, transtorno alimentar), recomende procurar um profissional de saúde.
- Ao avaliar, elogie o que está bom antes de apontar o que melhorar. Termine com no máximo 3 ações práticas para amanhã.`;

function requireAI(res) {
  if (!client) {
    res.status(503).json({
      error:
        'IA não configurada. Crie o arquivo .env na pasta do projeto com ANTHROPIC_API_KEY=sua-chave e reinicie o servidor.',
    });
    return false;
  }
  return true;
}

const NIVEIS = {
  nunca: 'nunca treinou musculação',
  iniciante: 'iniciante (menos de 6 meses de treino)',
  intermediario: 'intermediário (6 meses a 2 anos de treino)',
  avancado: 'avançado (mais de 2 anos de treino)',
};

const HORARIOS = {
  manha: 'de manhã (antes do trabalho)',
  almoco: 'na hora do almoço',
  tarde: 'à tarde',
  noite: 'à noite',
  varia: 'em horários variados',
};

function perfilTexto(p) {
  if (!p) return 'Perfil não informado.';
  return [
    `Nome: ${p.nome}`,
    p.sexo ? `Sexo: ${p.sexo}` : null,
    p.idade ? `Idade: ${p.idade} anos` : null,
    p.pesoKg ? `Peso: ${p.pesoKg} kg` : null,
    p.alturaCm ? `Altura: ${p.alturaCm} cm` : null,
    `Objetivo: ${p.objetivo}`,
    p.nivelExperiencia ? `Nível de experiência: ${NIVEIS[p.nivelExperiencia] ?? p.nivelExperiencia}` : null,
    p.frequenciaSemana ? `Frequência pretendida: ${p.frequenciaSemana}x por semana` : null,
    p.horarioTreino ? `Horário em que treina: ${HORARIOS[p.horarioTreino] ?? p.horarioTreino} — considere isso ao sugerir refeições e suplementos (pré/pós-treino)` : null,
    p.equipamentos ? `Equipamentos disponíveis / restrições da academia: ${p.equipamentos}` : null,
    p.diasMusculacao?.length ? `Dias preferidos para musculação: ${p.diasMusculacao.join(', ')}` : null,
    p.diasCorrida?.length ? `Dias preferidos para corrida: ${p.diasCorrida.join(', ')}` : null,
    p.restricoesSaude
      ? `⚠️ RESTRIÇÕES DE SAÚDE (respeite sempre, adapte os exercícios): ${p.restricoesSaude}`
      : p.restricoesSaude === ''
        ? 'Sem restrições de saúde informadas'
        : null,
    p.restricoes ? `Restrições/alergias alimentares: ${p.restricoes}` : null,
    p.preferencias ? `Preferências alimentares: ${p.preferencias}` : null,
    p.geladeira ? `Tem em casa (geladeira/despensa): ${p.geladeira}` : null,
    p.suplementos ? `Suplementos habituais: ${p.suplementos}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

// Texto da avaliação de desempenho no ciclo/plano anterior, usado para orientar ajustes no novo plano.
function textoPlanoAnterior(resumo) {
  if (!resumo) return 'Não há plano anterior — este é o primeiro plano do aluno, calibre com cautela (cargas conservadoras).';
  const partes = [
    `Nome do plano anterior: "${resumo.nome}" (${resumo.semanas} semana(s), criado em ${String(resumo.criadoEm).slice(0, 10)})`,
    `Estratégia que foi usada: ${resumo.estrategiaAnterior || 'não registrada'}`,
    `Aderência: ${resumo.diasConcluidos}/${resumo.totalDias} treinos concluídos (${resumo.percentualAdesao}%)`,
    resumo.rpeMedioRegistrado != null ? `RPE médio percebido pelo aluno nas sessões: ${resumo.rpeMedioRegistrado}/10` : 'Aluno não registrou RPE nas sessões deste ciclo.',
    resumo.progressaoCargas?.length
      ? `Progressão de carga observada (primeira carga registrada → última): ${resumo.progressaoCargas.map((p) => `${p.nome}: ${p.primeira}kg → ${p.ultima}kg`).join('; ')}`
      : 'Sem registros de carga suficientes para medir progressão.',
    resumo.diasNaoFeitos?.length ? `Dias planejados que NÃO foram feitos: ${resumo.diasNaoFeitos.join('; ')}` : 'Todos os dias planejados foram concluídos.',
  ];
  return partes.join('\n');
}

function textoDaResposta(response) {
  const block = response.content.find((b) => b.type === 'text');
  return block ? block.text : '';
}

async function chamarIA(userContent, { schema, maxTokens = 8000 } = {}) {
  const req = {
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  };
  if (schema) {
    req.output_config = { format: { type: 'json_schema', schema } };
  }
  // Respostas grandes (planos de várias semanas) arriscam timeout sem streaming.
  if (maxTokens > 12000) {
    const stream = client.messages.stream(req);
    return stream.finalMessage();
  }
  return client.messages.create(req);
}

// ---------- Avaliação do dia (texto/markdown) ----------
// Compartilhada entre o endpoint sob demanda e o job automático das 22:30 (mesma lógica dos dois lados).
function montarPromptAvaliacao({ perfil, dia, sessoesRecentes, totais, meta, atividadeRecente, avaliacaoAnteriorHoje }) {
  return `Avalie o dia deste aluno como personal trainer + nutricionista.

## Perfil
${perfilTexto(perfil)}

## Alimentação e suplementos registrados hoje (${dia?.data ?? 'hoje'})
${JSON.stringify(dia?.registros ?? [], null, 2)}

## Totais estimados do dia vs. meta
${JSON.stringify({ totais: totais ?? null, meta: meta ?? null }, null, 2)}

## Treinos/atividades recentes (mais recente primeiro)
${JSON.stringify(sessoesRecentes ?? [], null, 2)}

## Atividade e sono (últimos dias)
${JSON.stringify(atividadeRecente ?? { info: 'sem dados de sono/atividade registrados' }, null, 2)}
${
  avaliacaoAnteriorHoje
    ? `\n## Avaliação anterior de HOJE (feita mais cedo no mesmo dia)\n${avaliacaoAnteriorHoje}\n\nEssa avaliação já existe, mas o dia avançou desde então (mais refeições, treino, etc. podem ter sido registrados). Esta é uma REAVALIAÇÃO: não repita a anterior, gere uma nova avaliação considerando TUDO que aconteceu no dia até agora — ela vai SUBSTITUIR a anterior. Seja mais real e completo que a versão de mais cedo.\n`
    : ''
}
Estruture a resposta em Markdown com as seções: **Resumo do dia**, **Alimentação** (o que foi bem, o que faltou considerando o objetivo), **Treino/Atividade**, e **3 ações para amanhã**. Seja específico com o que a pessoa registrou — cite os alimentos e exercícios pelo nome. Se houver dados de sono/passos, considere-os: pouco sono pede volume de treino mais leve e reforça a importância de recuperação; poucos passos no dia pode sugerir incluir uma caminhada. Se houver déficit ou excesso calórico relevante, ou falta/excesso de atividade, deixe isso explícito e quantificado no resumo — esse texto pode ser reaproveitado como entrada para o planejamento do dia seguinte.`;
}

app.post('/api/ai/avaliar', autenticar, exigirAssinaturaAtiva, async (req, res) => {
  if (!requireAI(res)) return;
  try {
    const user = montarPromptAvaliacao(req.body ?? {});
    const response = await chamarIA(user);
    res.json({ texto: textoDaResposta(response) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: mensagemErro(err) });
  }
});

// ---------- Sugestões de refeição (JSON estruturado) ----------
const SCHEMA_REFEICOES = {
  type: 'object',
  properties: {
    sugestoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nome: { type: 'string' },
          ingredientes: { type: 'array', items: { type: 'string' } },
          preparo: { type: 'string' },
          calorias: { type: 'number' },
          proteinas_g: { type: 'number' },
          carboidratos_g: { type: 'number' },
          gorduras_g: { type: 'number' },
          motivo: { type: 'string', description: 'Por que essa refeição serve ao objetivo da pessoa' },
        },
        required: ['nome', 'ingredientes', 'preparo', 'calorias', 'proteinas_g', 'carboidratos_g', 'gorduras_g', 'motivo'],
        additionalProperties: false,
      },
    },
  },
  required: ['sugestoes'],
  additionalProperties: false,
};

// Resumo de sono/atividade recentes (foto/vídeo analisados na Evolução) — usado em refeições, treino
// e plano, pra tudo ficar integrado: sono ruim ou atividade muito alta/baixa influencia a recomendação.
function textoAtividadeRecente(atividadeRecente) {
  if (!atividadeRecente || !atividadeRecente.length) return 'Sem dados recentes de sono/atividade registrados.';
  return JSON.stringify(atividadeRecente, null, 2);
}

app.post('/api/ai/refeicoes', autenticar, exigirAssinaturaAtiva, async (req, res) => {
  if (!requireAI(res)) return;
  try {
    const { perfil, tipoRefeicao, registrosDoDia, atividadeRecente } = req.body;
    const user = `Sugira 3 opções de ${tipoRefeicao} para este aluno, priorizando ingredientes que ele já tem em casa. Se precisar de algo que ele não listou, use itens baratos e comuns no Brasil.

## Perfil
${perfilTexto(perfil)}

## O que ele já comeu hoje
${JSON.stringify(registrosDoDia ?? [], null, 2)}

## Sono e atividade recentes
${textoAtividadeRecente(atividadeRecente)}
Use isso: sono ruim recente pede refeições que ajudem recuperação (nada de exagerar em açúcar/ultraprocessado, priorize saciedade e nutrientes); atividade muito alta recente pede mais reposição (carboidrato/proteína); atividade muito baixa pede porções mais moderadas.

As sugestões devem equilibrar o dia considerando o que já foi consumido e o objetivo. Modo de preparo curto e direto (até 5 passos). Macros aproximados por porção.`;
    const response = await chamarIA(user, { schema: SCHEMA_REFEICOES });
    res.json(JSON.parse(textoDaResposta(response)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: mensagemErro(err) });
  }
});

// ---------- Geração de treino (JSON estruturado) ----------
const SCHEMA_TREINO = {
  type: 'object',
  properties: {
    nome: { type: 'string' },
    local: { type: 'string', enum: ['academia', 'casa', 'rua'] },
    aquecimento: { type: 'string', description: 'Descrição do aquecimento/mobilidade específico para este treino' },
    aquecimentoMin: { type: 'integer', description: 'Minutos de aquecimento/mobilidade — já incluídos dentro da duração total pedida, não somados a ela' },
    exercicios: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nome: { type: 'string' },
          series: { type: 'integer' },
          repeticoes: { type: 'string', description: 'Ex.: "8-12", "15", "30s"' },
          cargaSugerida: { type: 'string', description: 'Ex.: "moderada", "12 kg", "peso corporal"' },
          descansoSeg: { type: 'integer', description: 'Se fizer parte de um bi-set/tri-set (grupoId preenchido), é o descanso após completar a RODADA inteira (todos os exercícios do grupo), não entre eles' },
          instrucoes: { type: 'string', description: 'Execução correta em 1-2 frases: posição inicial, movimento, respiração, erro comum a evitar' },
          dicaRapida: { type: 'string', description: 'Lembrete de execução curtíssimo (máx. 5 palavras) para o personal falar EM VOZ ALTA no meio da série, ex.: "Cotovelos colados ao corpo"' },
          cadenciaSeg: { type: 'integer', description: 'Segundos por repetição no ritmo guiado por voz. Você é o especialista: movimentos compostos pesados ~3-4s, isolados ~2-3s, explosivos/potência ~1-2s. Para exercícios em "repeticoes" com segundos (ex.: prancha), repita esse valor igual à duração total do hold dividido pela contagem.' },
          grupoId: { type: 'string', description: 'EXCEÇÃO rara: preencha com o MESMO texto (ex.: "A") APENAS quando 2 exercícios (nunca mais que isso, salvo caso muito específico) devem virar um bi-set. Na imensa maioria dos exercícios, deixe "" (vazio) — um treino não deve ter todos os exercícios agrupados.' },
        },
        required: ['nome', 'series', 'repeticoes', 'cargaSugerida', 'descansoSeg', 'instrucoes', 'dicaRapida', 'cadenciaSeg', 'grupoId'],
        additionalProperties: false,
      },
    },
    dicas: { type: 'string' },
  },
  required: ['nome', 'local', 'aquecimento', 'aquecimentoMin', 'exercicios', 'dicas'],
  additionalProperties: false,
};

app.post('/api/ai/treino', autenticar, exigirAssinaturaAtiva, async (req, res) => {
  if (!requireAI(res)) return;
  try {
    const { perfil, local, foco, duracaoMin, historico, sessoesRecentes, planoCorridaResumo, planoAnteriorResumo, avaliacaoRecente, atividadeRecente } = req.body;
    const focoTexto =
      !foco || foco === 'coach'
        ? 'Você decide o foco e a divisão ideais: analise o histórico recente (evite repetir os mesmos grupamentos de dias seguidos), o objetivo e a frequência do aluno.'
        : `Foco pedido pelo aluno: ${foco}.`;
    const user = `Você é um treinador de elite dentro de um PLANO INTEGRADO DE SAÚDE (musculação + corrida + alimentação no mesmo app). Monte o MELHOR treino possível para ${local}, com duração aproximada de ${duracaoMin || 45} minutos. Use todo o seu conhecimento de periodização, seleção de exercícios e técnica — sem se prender a divisões clássicas: escolha livremente o split (full body, push/pull/legs, upper/lower, circuito, ou o que for ideal para ESTE aluno).

${focoTexto}

## Plano de corrida ativo do aluno (INTEGRE com ele!)
${JSON.stringify(planoCorridaResumo ?? { info: 'não tem plano de corrida' }, null, 2)}
Se o aluno tem plano de corrida: module o volume de pernas para não comprometer as corridas da semana (nada de fritar as pernas na véspera de treino intenso ou longão), e use os dias de musculação declarados no perfil para posicionar o estímulo certo.

## Sono e atividade recentes
${textoAtividadeRecente(atividadeRecente)}
Sono ruim recente (poucas horas ou qualidade baixa) pede volume/intensidade mais conservadores hoje, priorizando técnica; atividade física muito alta nos últimos dias pede mais cuidado com recuperação (menos volume ou mais descanso); atividade muito baixa não exige ajuste especial.

## Perfil
${perfilTexto(perfil)}

## Última carga usada por exercício
${JSON.stringify(historico ?? [], null, 2)}

## Treinos dos últimos dias (para variar os estímulos)
${JSON.stringify(sessoesRecentes ?? [], null, 2)}

## Avaliação do ciclo/plano anterior do aluno
${textoPlanoAnterior(planoAnteriorResumo)}
Use essa avaliação para calibrar este treino: se a aderência foi baixa, considere algo mais curto/simples de encaixar na rotina; se o RPE médio foi muito alto, não intensifique tanto; se as cargas evoluíram bem e o RPE estava confortável, pode progredir com mais confiança.
${
  avaliacaoRecente
    ? `\n## Relatório do dia mais recente (ontem/hoje) — parte do programa, não é só um resumo\n${avaliacaoRecente}\n\nSe esse relatório indicar déficit ou excesso calórico relevante, ou falta/excesso de atividade física, isso é ENTRADA para hoje: ajuste o treino para favorecer recuperação gradual (ex.: déficit calórico grande recente → volume/intensidade um pouco mais conservadores; pouca atividade recente → pode retomar normalmente; excesso de treino/pouca recuperação relatado → priorize técnica e não force a progressão hoje).\n`
    : ''
}
Diretrizes:
- Ordene do mais exigente (compostos) para o mais isolado; inclua aquecimento específico.
- **Ordem FUNCIONAL, sem alternar subgrupos/padrões de movimento:** organize os exercícios em blocos contíguos por subgrupo muscular ou padrão de movimento — termine tudo de um subgrupo antes de passar para o próximo. Exemplo de treino de pernas RUIM (nunca faça isso): quadríceps → posterior de coxa → quadríceps de novo → posterior de novo (alternando). O certo é agrupar: primeiro todos os exercícios de quadríceps/agachamento em sequência, depois todos os de posterior/glúteo em sequência (ou a ordem inversa, tanto faz — o que importa é não intercalar). Mesma lógica pra outros dias: todo peito antes de todo tríceps (ou vice-versa), nunca indo e voltando entre grupos.
- **Orçamento de tempo:** "aquecimentoMin" + o tempo estimado de todos os exercícios (séries × (execução + descanso)) deve caber dentro dos ${duracaoMin || 45} minutos totais pedidos — o aquecimento NÃO é extra, é parte do tempo disponível. Dimensione o número de exercícios de acordo.
- "instrucoes" de cada exercício deve ensinar a execução de forma completa: posição inicial, movimento, respiração e o erro mais comum a evitar (2-3 frases). "dicaRapida" é um lembrete separado, curtíssimo, para falar durante a execução.
- **Bi-sets e tri-sets (grupoId) são EXCEÇÃO, não regra.** Na grande maioria dos treinos, TODOS os exercícios devem ser individuais (grupoId ""). Só agrupe 2 (bi-set) quando houver um motivo real e específico (ex.: par antagonista bíceps/tríceps para economizar tempo num treino curto, ou um finalizador de circuito no fim). NUNCA agrupe mais de 2 exercícios juntos (tri-set é raríssimo, reserve para casos muito específicos de finalização/circuito) e NUNCA agrupe todos os exercícios do treino — isso não é como um treino de musculação de verdade funciona. Se não houver um motivo claro, deixe grupoId vazio em TODOS os exercícios.
- **Variação em treinos full body:** se o histórico recente (sessões/treinos anteriores) mostrar que o aluno já vem fazendo full body repetidamente, NÃO repita a mesma seleção de exercícios de sessão para sessão — troque por variações que treinem os mesmos padrões de movimento (empurrar, puxar, agachar, dobradiça de quadril) com exercícios diferentes, para variar o estímulo e evitar monotonia. Só repita exercícios idênticos se o aluno estiver claramente em progressão linear intencional em um exercício específico (ex.: buscando um recorde pessoal).
- Se o local for "casa", use peso corporal e itens domésticos (mochila com livros, garrafas), a menos que o histórico mostre equipamentos.
- Se for "rua", monte treino de caminhada/corrida/calistenia em praça (barras, bancos, escadas).
- Se for "academia", use máquinas e pesos livres comuns no Brasil.
- Progrida a carga com base no histórico (2-5% quando o aluno completou tudo). Quando sugerir um valor numérico de carga em "cargaSugerida", pense em incrementos realistas de anilha — o padrão de academia é múltiplos de 2,5 kg (ex.: 20kg, 22,5kg, 25kg), não valores quebrados como 20,6kg.
- Descanso coerente com o objetivo (hipertrofia 60-90s, força 120-180s, emagrecimento/resistência 30-60s).
- Em "dicas", inclua orientação de intensidade (RPE ou "deixe 2 repetições na reserva") e quando este treino deve evoluir.`;
    const response = await chamarIA(user, { schema: SCHEMA_TREINO });
    res.json(JSON.parse(textoDaResposta(response)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: mensagemErro(err) });
  }
});

// ---------- Substituir 1 exercício no meio do treino (aparelho ocupado/indisponível) ----------
const SCHEMA_SUBSTITUTO = {
  type: 'object',
  properties: {
    nome: { type: 'string' },
    series: { type: 'integer' },
    repeticoes: { type: 'string', description: 'Ex.: "8-12", "15", "30s"' },
    cargaSugerida: { type: 'string' },
    descansoSeg: { type: 'integer' },
    instrucoes: { type: 'string', description: 'Execução correta: posição inicial, movimento, respiração, erro comum a evitar' },
    dicaRapida: { type: 'string' },
    cadenciaSeg: { type: 'integer' },
  },
  required: ['nome', 'series', 'repeticoes', 'cargaSugerida', 'descansoSeg', 'instrucoes', 'dicaRapida', 'cadenciaSeg'],
  additionalProperties: false,
};

app.post('/api/ai/trocar-exercicio', autenticar, exigirAssinaturaAtiva, async (req, res) => {
  if (!requireAI(res)) return;
  try {
    const { perfil, exercicio, local } = req.body;
    const user = `O aluno está NO MEIO do treino agora e não consegue fazer o exercício "${exercicio?.nome}" (aparelho ocupado ou indisponível em "${local}"). Sugira RAPIDAMENTE 1 substituto que treine o(s) mesmo(s) grupo(s) muscular(es) e padrão de movimento, adequado ao local e ao perfil do aluno.

## Exercício original (o que precisa ser substituído)
${JSON.stringify(exercicio ?? {}, null, 2)}

## Perfil
${perfilTexto(perfil)}

Mantenha séries/repetições/descanso parecidos com o original, a menos que o novo exercício exija algo diferente. Dê instruções completas de execução (posição inicial, movimento, respiração, erro comum a evitar) e uma dica rápida curtíssima, como em qualquer outro exercício do treino.`;
    const response = await chamarIA(user, { schema: SCHEMA_SUBSTITUTO, maxTokens: 4000 });
    res.json(JSON.parse(textoDaResposta(response)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: mensagemErro(err) });
  }
});

// ---------- Plano de musculação: periodização de N semanas, dia a dia ----------
const SCHEMA_EXERCICIO_PLANO = {
  type: 'object',
  properties: {
    nome: { type: 'string' },
    series: { type: 'integer' },
    repeticoes: { type: 'string', description: 'Ex.: "8-12", "15", "30s"' },
    cargaSugerida: { type: 'string', description: 'Ex.: "moderada", "12 kg", "peso corporal"' },
    descansoSeg: { type: 'integer' },
    instrucoes: { type: 'string', description: 'Execução correta: posição inicial, movimento, respiração, erro comum a evitar' },
    dicaRapida: { type: 'string', description: 'Lembrete curtíssimo (máx. 5 palavras) para falar durante a série' },
    cadenciaSeg: { type: 'integer', description: 'Segundos por repetição no ritmo guiado (composto pesado ~3-4s, isolado ~2-3s, explosivo ~1-2s)' },
    grupoId: { type: 'string', description: 'EXCEÇÃO rara: preencha igual em 2 exercícios para formar um bi-set pontual. Na imensa maioria, deixe "" — não agrupe o treino inteiro.' },
  },
  required: ['nome', 'series', 'repeticoes', 'cargaSugerida', 'descansoSeg', 'instrucoes', 'dicaRapida', 'cadenciaSeg', 'grupoId'],
  additionalProperties: false,
};

const SCHEMA_PLANO_MENSAL = {
  type: 'object',
  properties: {
    nome: { type: 'string' },
    avaliacaoInicial: { type: 'string', description: 'Resumo do perfil do aluno e do que foi levado em conta (2-4 frases). Se houver plano anterior, mencione a avaliação de desempenho dele aqui.' },
    estrategiaMes: { type: 'string', description: 'Como o treino evolui ao longo das semanas do plano: o que muda de uma semana para outra e por quê' },
    dias: {
      type: 'array',
      description: 'UM item por dia de treino de CADA semana do plano. Se o aluno treina 3x/semana e o plano tem N semanas, gere 3 dias por semana, total 3×N.',
      items: {
        type: 'object',
        properties: {
          semana: { type: 'integer', description: 'Número da semana dentro do plano, começando em 1' },
          dia: { type: 'string', description: 'Dia da semana, ex.: "Segunda" — deve ser um dos dias de musculação informados pelo aluno' },
          objetivo: { type: 'string', description: 'Objetivo específico deste treino, ex.: "Força — membros inferiores"' },
          gruposMusculares: { type: 'string' },
          tempoEstimadoMin: { type: 'integer', description: 'Tempo TOTAL do treino, incluindo aquecimento' },
          aquecimento: { type: 'string', description: 'Descrição do aquecimento/mobilidade específico para os grupos musculares do dia' },
          aquecimentoMin: { type: 'integer', description: 'Minutos de aquecimento — já incluídos dentro de tempoEstimadoMin, não somados' },
          exercicios: { type: 'array', items: SCHEMA_EXERCICIO_PLANO },
          cardioRecomendado: { type: 'string', description: 'Vazio "" se não fizer sentido no objetivo/dia' },
          alongamento: { type: 'string' },
        },
        required: ['semana', 'dia', 'objetivo', 'gruposMusculares', 'tempoEstimadoMin', 'aquecimento', 'aquecimentoMin', 'exercicios', 'cardioRecomendado', 'alongamento'],
        additionalProperties: false,
      },
    },
    recomendacoesGerais: { type: 'string', description: 'Alimentação, sono, recuperação, hidratação e como progredir a carga — texto corrido, direto' },
  },
  required: ['nome', 'avaliacaoInicial', 'estrategiaMes', 'dias', 'recomendacoesGerais'],
  additionalProperties: false,
};

app.post('/api/ai/plano', autenticar, exigirAssinaturaAtiva, async (req, res) => {
  if (!requireAI(res)) return;
  try {
    const { perfil, local, duracaoMin, historico, sessoesRecentes, planoCorridaResumo, planoAnteriorResumo, foco, avaliacaoRecente, atividadeRecente } = req.body;
    const semanas = [1, 2, 4].includes(+req.body.semanas) ? +req.body.semanas : 4;
    const periodo = semanas === 1 ? '1 semana' : `${semanas} semanas`;
    const focoTexto =
      !foco || foco === 'coach'
        ? 'O aluno deixou a critério do coach: monte a divisão de treino (split) que fizer mais sentido para o objetivo, frequência e nível dele.'
        : `O aluno indicou uma ênfase geral para este ciclo: "${foco}". Se for um foco amplo (ex.: "inferiores", "corpo inteiro") e o plano tiver mais de um dia, use isso como ÊNFASE (mais volume/frequência para esse grupo) mas ainda monte uma divisão de treino coerente e balanceada ao longo dos dias — NÃO repita o mesmo foco estreito (ex.: "peito e tríceps") em todos os dias do plano, isso não é uma divisão de treino real.`;
    const user = `# PERSONA

Você é um Personal Trainer de elite, com mais de 20 anos de experiência em treinamento de musculação, biomecânica, fisiologia do exercício e prescrição de treinos para hipertrofia, emagrecimento, força, condicionamento físico e qualidade de vida.

Sua missão é criar treinos inteligentes, eficientes e sustentáveis, focados exclusivamente no objetivo do aluno. Você acredita que resultados vêm de consistência, progressão adequada, boa execução e recuperação — nunca de excesso de exercícios. Você evita treinos "encheção de linguiça": cada exercício tem um propósito.

# OBJETIVO

Montar uma PERIODIZAÇÃO COMPLETA para ${periodo} — não um treino único. Todos os dias de treino do período, cada um com seu próprio treino, evoluindo naturalmente ao longo do ciclo.

${focoTexto}

# REGRAS DE CONSTRUÇÃO

Treinos eficientes, objetivos, sem excesso de volume, sem repetir exercícios desnecessariamente, respeitando recuperação muscular, progressivos ao longo do ciclo. Priorize exercícios compostos; use isoladores quando fizer sentido. Varie estímulos ao longo do ciclo em vez de repetir exatamente os mesmos exercícios todo dia — a menos que a progressão linear intencional justifique manter (explique quando for o caso). Bi-sets/tri-sets são EXCEÇÃO pontual (ex.: par antagonista para economizar tempo), nunca a regra — a maioria dos exercícios de cada dia deve ser individual (grupoId vazio).

**Ordem FUNCIONAL dentro de cada dia, sem alternar subgrupos/padrões de movimento:** dentro de "exercicios", agrupe em blocos contíguos por subgrupo muscular ou padrão de movimento — termine tudo de um subgrupo antes de passar para o próximo, nunca intercale. Exemplo RUIM num dia de pernas (nunca faça): quadríceps → posterior de coxa → quadríceps de novo → posterior de novo. O certo: todos os exercícios de quadríceps/agachamento em sequência, depois todos os de posterior/glúteo em sequência (a ordem entre os blocos pode variar, o que importa é não ir e voltar entre grupos).

# PERIODIZAÇÃO${semanas === 1 ? ' (plano de 1 semana)' : ''}

${
  semanas === 1
    ? 'Como o plano é de apenas 1 semana, não há progressão semana a semana para explicar — foque em montar a melhor divisão possível para esse curto período e explique em "estrategiaMes" a lógica da divisão escolhida e o que o aluno deve buscar evoluir na próxima vez que treinar cada exercício.'
    : 'Pequena evolução a cada semana: aumento de carga, aumento de repetições, redução do descanso, alteração de intensidade/cadência, ou (só para intermediário/avançado) técnicas avançadas pontuais. Nunca mudanças radicais de uma semana para outra. Ao sugerir cargas numéricas, use incrementos realistas de anilha (múltiplos de 2,5 kg — o padrão de academia). Explique a lógica em "estrategiaMes".'
}

# AVALIAÇÃO DO CICLO ANTERIOR

${textoPlanoAnterior(planoAnteriorResumo)}

Antes de montar o novo plano, avalie honestamente esse desempenho e mencione essa avaliação em "avaliacaoInicial" (1-2 frases). Use-a para ajustar o novo plano:
- Aderência baixa (<60%): investigue possíveis causas prováveis (duração longa demais? dias mal escolhidos? intensidade alta demais?) e proponha algo mais fácil de encaixar na rotina — sessões mais curtas, menos exercícios, ou dias diferentes.
- RPE médio muito alto (>8): não acelere a progressão de carga/volume tão rápido, priorize técnica e recuperação.
- RPE médio baixo (<5) e cargas evoluíram bem: pode progredir com mais confiança e intensidade.
- Cargas estagnadas em algum exercício: varie o exercício ou a técnica em vez de insistir na mesma progressão que não funcionou.
- Se um dia específico da semana aparece systematicamente entre os "não feitos", considere não repeti-lo ou avisar o aluno sobre isso nas recomendações gerais.
${
  avaliacaoRecente
    ? `\nAlém disso, considere o relatório do dia mais recente do aluno (parte do programa, não é só um resumo):\n${avaliacaoRecente}\n\nSe indicar déficit ou excesso calórico relevante, ou falta/excesso de atividade física, use como entrada: ajuste o início deste plano para favorecer recuperação gradual (ex.: déficit grande recente → semana 1 um pouco mais conservadora; excesso de treino/pouca recuperação → priorize técnica antes de intensidade).\n`
    : ''
}
## Sono e atividade recentes
${textoAtividadeRecente(atividadeRecente)}
Sono ruim recente pede semana 1 um pouco mais conservadora (técnica antes de intensidade); atividade física muito alta recente pede mais atenção à recuperação no início do ciclo.

# CARDIO

Se o objetivo for emagrecimento, recomende cardio (frequência/duração/intensidade) em "cardioRecomendado" nos dias que fizer sentido. Se for hipertrofia, cardio moderado ou nenhum. Respeite "${perfil?.disponibilidadeCardio || 'não informado'}" (disponibilidade real do aluno para cardio extra).

# ADAPTAÇÕES

Se houver restrição de saúde/lesão, substitua exercícios incompatíveis e isso deve ficar implícito na escolha (não inclua exercícios que agridam a limitação informada). Respeite também o que o aluno gosta e não gosta de fazer.

## Perfil completo do aluno
${perfilTexto(perfil)}
Objetivos secundários: ${perfil?.objetivosSecundarios || 'nenhum informado'}
Exercícios que gosta: ${perfil?.preferenciasExercicios || 'não informado'}
Exercícios que evita/não gosta: ${perfil?.exerciciosEvitar || 'não informado'}
Local de treino: ${local}
Tempo disponível por sessão: ${duracaoMin || 45} minutos (aquecimento incluído dentro desse tempo, não somado)

## Última carga usada por exercício (para calibrar o ponto de partida)
${JSON.stringify(historico ?? [], null, 2)}

## Treinos recentes registrados (para não repetir o que já vem sendo feito)
${JSON.stringify(sessoesRecentes ?? [], null, 2)}

## Plano de corrida ativo do aluno (INTEGRE — não sobrecarregue pernas na véspera de treino intenso de corrida)
${JSON.stringify(planoCorridaResumo ?? { info: 'não tem plano de corrida' }, null, 2)}

Gere os dias de treino para ${periodo} completa(s), APENAS nos dias da semana que o aluno marcou para musculação (ver "Dias preferidos para musculação" no perfil). Se ele não marcou dias, use uma frequência de 3x/semana em dias alternados (Segunda/Quarta/Sexta). Cada exercício deve ter "instrucoes" ensinando a execução correta (postura, amplitude completa, respiração, velocidade) e "dicaRapida" para reforço durante a série.`;
    const maxTokens = semanas <= 1 ? 16000 : semanas === 2 ? 28000 : 48000;
    const response = await chamarIA(user, { schema: SCHEMA_PLANO_MENSAL, maxTokens });
    res.json({ ...JSON.parse(textoDaResposta(response)), semanas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: mensagemErro(err) });
  }
});

// ---------- Plano de corrida (dia a dia) ----------
const SCHEMA_CORRIDA = {
  type: 'object',
  properties: {
    nome: { type: 'string' },
    objetivo: { type: 'string' },
    dias: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          semana: { type: 'integer' },
          dia: { type: 'string', description: 'Dia da semana, ex.: "Segunda"' },
          tipo: {
            type: 'string',
            description: 'Ex.: "corrida leve", "intervalado", "longão", "regenerativo", "fortalecimento", "descanso"',
          },
          titulo: { type: 'string' },
          detalhes: { type: 'string', description: 'Instruções completas: aquecimento, ritmo/percepção de esforço, séries, volta à calma' },
          distanciaKm: { type: 'number' },
          duracaoMin: { type: 'integer' },
        },
        required: ['semana', 'dia', 'tipo', 'titulo', 'detalhes'],
        additionalProperties: false,
      },
    },
    dicas: { type: 'string' },
  },
  required: ['nome', 'objetivo', 'dias', 'dicas'],
  additionalProperties: false,
};

app.post('/api/ai/corrida', autenticar, exigirAssinaturaAtiva, async (req, res) => {
  if (!requireAI(res)) return;
  try {
    const { perfil, nivelCorrida, objetivoCorrida, diasCorrida, capacidadeAtual, observacoes, corridasRecentes, musculacao } = req.body;
    const user = `Você é um treinador de corrida de elite (preparador de provas de rua) trabalhando dentro de um PLANO INTEGRADO DE SAÚDE: este aluno também faz musculação e acompanha a alimentação no mesmo app. O plano de corrida deve se ENCAIXAR na rotina dele, nunca competir com ela.

## Avaliação do corredor
- Nível na corrida: ${nivelCorrida || 'não informado'}
- Objetivo: ${objetivoCorrida || 'melhorar o condicionamento'}
- Dias escolhidos pelo aluno para CORRER: ${Array.isArray(diasCorrida) && diasCorrida.length ? diasCorrida.join(', ') : 'não informados (escolha os melhores)'}
- O que consegue correr hoje: ${capacidadeAtual || 'não informado'}
- Observações: ${observacoes || 'nenhuma'}

## Rotina de musculação do aluno (INTEGRE com ela!)
${JSON.stringify(musculacao ?? { info: 'não faz musculação' }, null, 2)}

## Perfil geral
${perfilTexto(perfil)}

## Corridas recentes registradas no app
${JSON.stringify(corridasRecentes ?? [], null, 2)}

Diretrizes de INTEGRAÇÃO (as mais importantes):
- Agende as corridas SOMENTE nos dias que o aluno escolheu para correr.
- Se o aluno já faz musculação, NÃO prescreva dias de fortalecimento de pernas — a musculação dele já cobre isso; no máximo, sugira ajustes pontuais na semana ("nesta semana, pegue mais leve no treino de pernas da academia").
- Sequencie com inteligência: evite corrida intensa (intervalado/longão) no dia seguinte a treino pesado de pernas, e vice-versa; observe os dias de musculação declarados no perfil.
- Considere o volume TOTAL da semana (corrida + musculação) para não sobrecarregar o aluno.

Demais diretrizes:
- Escolha a duração ideal do plano (4 a 8 semanas) conforme objetivo e nível — progressão segura (regra dos 10%), com semana de recuperação quando fizer sentido.
- Crie entradas apenas para os dias de corrida (mais orientações de descanso estratégico quando merecerem).
- Cada treino: aquecimento, trabalho principal com ritmos por percepção de esforço (leve/moderado/forte) ou ritmo-alvo, e volta à calma.
- Respeite as restrições de saúde do perfil.
- Em "dicas": como conciliar a semana corrida+musculação, hidratação, tênis, alimentação pré/pós considerando o horário de treino, e sinais de alerta para parar.`;
    const response = await chamarIA(user, { schema: SCHEMA_CORRIDA, maxTokens: 16000 });
    res.json(JSON.parse(textoDaResposta(response)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: mensagemErro(err) });
  }
});

// ---------- Estimativa de calorias dos registros do dia ----------
const SCHEMA_CALORIAS = {
  type: 'object',
  properties: {
    estimativas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'O mesmo id do registro recebido' },
          calorias: { type: 'number' },
          proteinas_g: { type: 'number' },
          carboidratos_g: { type: 'number' },
          gorduras_g: { type: 'number' },
        },
        required: ['id', 'calorias', 'proteinas_g', 'carboidratos_g', 'gorduras_g'],
        additionalProperties: false,
      },
    },
  },
  required: ['estimativas'],
  additionalProperties: false,
};

app.post('/api/ai/calorias', autenticar, exigirAssinaturaAtiva, async (req, res) => {
  if (!requireAI(res)) return;
  try {
    const { perfil, registros } = req.body;
    if (!registros?.length) {
      res.json({ estimativas: [] });
      return;
    }
    const user = `Estime calorias e macros de cada registro alimentar abaixo (porções brasileiras típicas quando a quantidade não for informada). Devolva uma estimativa para CADA id recebido.

## Perfil
${perfilTexto(perfil)}

## Registros
${JSON.stringify(registros, null, 2)}`;
    const response = await chamarIA(user, { schema: SCHEMA_CALORIAS });
    res.json(JSON.parse(textoDaResposta(response)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: mensagemErro(err) });
  }
});

// ---------- Leitura de foto de balança de bioimpedância ----------
const SCHEMA_BALANCA = {
  type: 'object',
  properties: {
    ehBalanca: { type: 'boolean', description: 'false se a imagem não mostra uma balança/app de pesagem legível' },
    pesoKg: { type: 'number', description: '0 se não conseguir ler' },
    imc: { type: 'number' },
    gorduraPct: { type: 'number' },
    massaMagraKg: { type: 'number' },
    musculoKg: { type: 'number' },
    aguaPct: { type: 'number' },
    gorduraVisceral: { type: 'number' },
    metabolismoKcal: { type: 'number' },
    observacao: { type: 'string', description: 'O que foi lido e comentário curto sobre a evolução em relação ao objetivo' },
  },
  required: ['ehBalanca', 'pesoKg', 'observacao'],
  additionalProperties: false,
};

app.post('/api/ai/balanca', autenticar, exigirAssinaturaAtiva, async (req, res) => {
  if (!requireAI(res)) return;
  try {
    const { perfil, imagemBase64, mediaType } = req.body;
    if (!imagemBase64) {
      res.status(400).json({ error: 'Nenhuma imagem recebida.' });
      return;
    }
    const response = await chamarIA(
      [
        { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imagemBase64 } },
        {
          type: 'text',
          text: `Esta é a foto do visor de uma balança (ou do app de bioimpedância) do aluno. Leia os números visíveis e extraia: peso (kg), IMC, gordura corporal (%), massa magra (kg), massa muscular (kg), água (%), gordura visceral e metabolismo basal (kcal) — apenas os que estiverem visíveis; omita os demais campos. Atenção às unidades (kg vs %). Se a imagem não for de balança ou estiver ilegível, marque ehBalanca=false e explique em "observacao".

## Perfil do aluno
${perfilTexto(perfil)}`,
        },
      ],
      { schema: SCHEMA_BALANCA },
    );
    res.json(JSON.parse(textoDaResposta(response)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: mensagemErro(err) });
  }
});

// ---------- Análise de foto de refeição (visão + JSON estruturado) ----------
const SCHEMA_FOTO = {
  type: 'object',
  properties: {
    descricao: { type: 'string', description: 'Cada alimento/bebida identificado, com a quantidade/porção estimada' },
    calorias: { type: 'number' },
    proteinas_g: { type: 'number' },
    carboidratos_g: { type: 'number' },
    gorduras_g: { type: 'number' },
    fibras_g: { type: 'number' },
    comentario: { type: 'string', description: 'Análise nutricional da refeição: pontos de atenção, o que está bom, relação com o objetivo da pessoa — e qualquer incerteza na estimativa' },
    ehComida: { type: 'boolean', description: 'false se a imagem não parece ser de comida' },
  },
  required: ['descricao', 'calorias', 'proteinas_g', 'carboidratos_g', 'gorduras_g', 'fibras_g', 'comentario', 'ehComida'],
  additionalProperties: false,
};

app.post('/api/ai/foto', autenticar, exigirAssinaturaAtiva, async (req, res) => {
  if (!requireAI(res)) return;
  try {
    const { perfil, imagemBase64, mediaType, tipoRefeicao } = req.body;
    if (!imagemBase64) {
      res.status(400).json({ error: 'Nenhuma imagem recebida.' });
      return;
    }
    const response = await chamarIA(
      [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imagemBase64 },
        },
        {
          type: 'text',
          text: `Você é um nutricionista clínico extremamente detalhista, especialista em análise visual de refeições — nunca chuta valores genéricos. Esta é a foto do(a) ${tipoRefeicao || 'refeição'} do aluno.

Analise com atenção aos detalhes:
1. Identifique CADA alimento e bebida visível no prato, com a porção/quantidade aproximada mais realista possível (não arredonde para números "redondos" sem necessidade).
2. A partir dos alimentos identificados, calcule a composição nutricional REAL da porção visível: calorias totais, proteína (g), carboidrato (g), gordura (g) e fibras (g). Baseie-se em valores nutricionais reais de cada alimento — some item por item, não invente um total genérico.
3. Se algum alimento não estiver claramente identificável, diga isso explicitamente no comentário em vez de estimar às cegas.
4. No comentário, dê uma análise nutricional objetiva da refeição (pontos fortes, pontos de atenção, relação com o objetivo do aluno).

Se a imagem não for de comida, diga isso em "descricao" e marque ehComida=false.

## Perfil do aluno
${perfilTexto(perfil)}`,
        },
      ],
      { schema: SCHEMA_FOTO },
    );
    res.json(JSON.parse(textoDaResposta(response)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: mensagemErro(err) });
  }
});

// ---------- Sono: foto ou frame de vídeo do wearable (extraído no cliente) ----------
const SCHEMA_SONO = {
  type: 'object',
  properties: {
    ehSono: { type: 'boolean', description: 'false se a imagem não mostra dados de sono legíveis' },
    data: { type: 'string', description: 'Data (yyyy-MM-dd) lida da imagem, se visível; senão, deixe ""' },
    sonoHoras: { type: 'number', description: 'Duração do sono em horas, lida da imagem' },
    sonoQualidade: { type: 'string', description: 'Ex.: "boa", "regular", "ruim"' },
    frequenciaCardiacaMedia: { type: 'integer', description: '0 se não souber' },
    comentario: {
      type: 'string',
      description:
        'Análise de coach (2-3 frases, não só leitura de números): o que essa noite significa pra recuperação e pro objetivo do aluno, e uma recomendação prática pro treino e/ou alimentação de hoje.',
    },
  },
  required: ['ehSono', 'data', 'sonoHoras', 'sonoQualidade', 'frequenciaCardiacaMedia', 'comentario'],
  additionalProperties: false,
};

app.post('/api/ai/sono', autenticar, exigirAssinaturaAtiva, async (req, res) => {
  if (!requireAI(res)) return;
  try {
    const { perfil, imagemBase64, mediaType } = req.body;
    if (!imagemBase64) {
      res.status(400).json({ error: 'Nenhuma imagem recebida.' });
      return;
    }
    const response = await chamarIA(
      [
        { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imagemBase64 } },
        {
          type: 'text',
          text: `Você é o personal trainer + nutricionista deste aluno (não um app de leitura de dados) analisando uma foto/frame de vídeo do wearable dele com dados de sono (Samsung Health ou similar). Leia a duração, qualidade e frequência cardíaca visíveis, e a data se estiver na tela. Se a imagem não mostrar dados de sono legíveis, marque ehSono=false e explique em "comentario".

Duração ideal de referência: 7-9h para adultos. Sua análise em "comentario" deve ser de PERSONAL/NUTRICIONISTA (não de app de saúde): o que essa noite significa pra recuperação e pro objetivo do aluno, e o que fazer hoje por causa disso (treino mais leve, mais proteína/hidratação, etc.) — essa informação é parte integrada do programa, vai influenciar a recomendação do dia.

## Perfil do aluno
${perfilTexto(perfil)}`,
        },
      ],
      { schema: SCHEMA_SONO },
    );
    res.json(JSON.parse(textoDaResposta(response)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: mensagemErro(err) });
  }
});

// ---------- Atividade: foto ou frame de vídeo do indicador (passos, tempo ativo, calorias) ----------
const SCHEMA_ATIVIDADE_FOTO = {
  type: 'object',
  properties: {
    ehIndicadorAtividade: { type: 'boolean', description: 'false se a imagem não mostra um indicador de atividade legível' },
    data: { type: 'string', description: 'Data (yyyy-MM-dd) lida da foto, se visível; senão, deixe ""' },
    passos: { type: 'integer' },
    calorias: { type: 'integer', description: 'Calorias ativas/de exercício' },
    minutosAtivos: { type: 'integer' },
    comentario: {
      type: 'string',
      description:
        'Análise de coach (2-3 frases, não só leitura de números): o que esse nível de atividade significa pro objetivo do aluno, e uma recomendação prática pro treino e/ou alimentação de hoje.',
    },
  },
  required: ['ehIndicadorAtividade', 'data', 'passos', 'calorias', 'minutosAtivos', 'comentario'],
  additionalProperties: false,
};

app.post('/api/ai/atividade-foto', autenticar, exigirAssinaturaAtiva, async (req, res) => {
  if (!requireAI(res)) return;
  try {
    const { perfil, imagemBase64, mediaType } = req.body;
    if (!imagemBase64) {
      res.status(400).json({ error: 'Nenhuma imagem recebida.' });
      return;
    }
    const response = await chamarIA(
      [
        { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imagemBase64 } },
        {
          type: 'text',
          text: `Você é o personal trainer + nutricionista deste aluno (não um app de leitura de dados) analisando uma foto/frame de vídeo do indicador de atividade dele (passos, tempo ativo, calorias de exercício — tipo Samsung Health). Leia os números visíveis e a data se estiver na tela. Se a imagem não for desse tipo de indicador ou estiver ilegível, marque ehIndicadorAtividade=false e explique em "comentario".

Sua análise em "comentario" deve ser de PERSONAL/NUTRICIONISTA: o que esse nível de atividade significa pro objetivo do aluno (muito alto → atenção à recuperação e reposição; muito baixo → pode compensar com mais movimento ou ajustar calorias), e o que fazer hoje por causa disso — essa informação é parte integrada do programa, vai influenciar a recomendação do dia.

## Perfil do aluno
${perfilTexto(perfil)}`,
        },
      ],
      { schema: SCHEMA_ATIVIDADE_FOTO },
    );
    res.json(JSON.parse(textoDaResposta(response)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: mensagemErro(err) });
  }
});

function mensagemErro(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Chave da API inválida. Verifique o .env.';
  if (err instanceof Anthropic.RateLimitError) return 'Limite de uso atingido. Tente de novo em instantes.';
  if (err instanceof Anthropic.APIConnectionError) return 'Sem conexão com a IA. Verifique a internet.';
  if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err?.message || '')) {
    return 'Créditos da conta Anthropic esgotados. Para o Coach voltar a funcionar, adicione créditos em console.anthropic.com → Plans & Billing.';
  }
  return 'Erro ao consultar a IA: ' + (err?.message || 'desconhecido');
}

// ---------- Relatório automático das 22:30 (fuso de São Paulo) ----------
// Garante um relatório consolidado do dia mesmo se o aluno nunca pedir avaliação manual — vira
// insumo pro planejamento do dia seguinte (déficit/excesso de calorias ou atividade).
async function gerarRelatorioAutomatico(row) {
  const perfil = JSON.parse(row.perfil_json);
  const dadosAtual = { ...DADOS_VAZIOS, ...JSON.parse(row.dados_json) };
  const hoje = dataSaoPauloISO();
  const dia = dadosAtual.dias[hoje] ?? { data: hoje, registros: [] };

  const nomeDiaHoje = diaSemanaSaoPaulo();
  const treinosHoje = dadosAtual.sessoes.filter((s) => dataSaoPauloDe(s.data) === hoje).length;
  const treinoPrevistoHoje = (perfil.diasMusculacao?.includes(nomeDiaHoje) ?? false) || (perfil.diasCorrida?.includes(nomeDiaHoje) ?? false);
  const treinoHoje = treinoPrevistoHoje || treinosHoje > 0;

  const sessoesRecentes = [...dadosAtual.sessoes]
    .sort((a, b) => b.data.localeCompare(a.data))
    .slice(0, 7)
    .map((s) => ({
      data: s.data.slice(0, 10),
      nome: s.nomeTreino,
      local: s.local,
      duracaoMin: s.duracaoMin,
      exercicios: s.itens.map((i) => ({
        nome: i.nome,
        series: i.seriesFeitas.length,
        cargaMaxKg: Math.max(0, ...i.seriesFeitas.map((x) => x.cargaKg ?? 0)) || undefined,
      })),
      atividadeLivre: s.atividadeLivre,
    }));

  const atividadeRecente = [...dadosAtual.atividadesDiarias].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 7);
  const avaliacaoHojeExistente = dadosAtual.avaliacoes.find((a) => dataSaoPauloDe(a.data) === hoje);

  const user = montarPromptAvaliacao({
    perfil,
    dia,
    sessoesRecentes,
    totais: totaisDoDia(dia.registros),
    meta: metaDiaria(perfil, dadosAtual.sessoes, dadosAtual.atividadesDiarias, treinoHoje),
    atividadeRecente,
    avaliacaoAnteriorHoje: avaliacaoHojeExistente?.texto,
  });

  const response = await chamarIA(user);
  const novaAvaliacao = { id: avaliacaoHojeExistente?.id ?? uid(), data: new Date().toISOString(), texto: textoDaResposta(response) };
  const avaliacoes = [novaAvaliacao, ...dadosAtual.avaliacoes.filter((a) => a.id !== novaAvaliacao.id)].slice(0, 30);
  db.prepare('UPDATE perfis SET dados_json = ?, atualizado_em = ? WHERE id = ?').run(
    JSON.stringify({ ...dadosAtual, avaliacoes }),
    new Date().toISOString(),
    row.id,
  );
}

let ultimoDisparoRelatorio22h30 = null; // data (yyyy-MM-dd) do último disparo — evita repetir no mesmo minuto/dia

async function verificarRelatorioAutomatico() {
  if (!client) return; // IA não configurada
  const hoje = dataSaoPauloISO();
  if (horaMinutoSaoPaulo() !== '22:30' || ultimoDisparoRelatorio22h30 === hoje) return;
  ultimoDisparoRelatorio22h30 = hoje;
  const linhas = db.prepare('SELECT id, perfil_json, dados_json FROM perfis').all();
  for (const row of linhas) {
    try {
      await gerarRelatorioAutomatico(row);
    } catch (err) {
      console.error(`Falha ao gerar relatório automático das 22:30 para o perfil ${row.id}:`, err?.message || err);
    }
  }
  console.log(`Relatórios automáticos das 22:30 gerados para ${linhas.length} perfil(is) em ${hoje}.`);
}

setInterval(verificarRelatorioAutomatico, 60 * 1000);

// ---------- Arquivos estáticos (produção) ----------
const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`API Meu Coach na porta ${PORT} | modelo: ${MODEL} | IA: ${client ? 'ativa' : 'SEM CHAVE (.env)'}`);
});
