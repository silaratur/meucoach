// Assinatura mensal via Mercado Pago, pra custear os créditos de IA que o app consome. Sem
// SDK: chama a API REST direto (mesmo estilo de server/wger.mjs).
//
// Usa um "Plano" (preapproval_plan) em vez do preapproval 100% avulso da versão anterior —
// só um Plano permite `payment_methods_allowed` pra liberar Pix além de cartão no checkout
// (o preapproval avulso só aceita cartão). O plano é criado uma vez via API e cacheado em
// disco (data/mercadopago-plano.json, mesmo padrão do data/jwt-secret em server/db.mjs); se
// o preço ou o trial mudarem no .env, um plano novo é criado automaticamente na próxima
// assinatura — quem já assinou pelo plano antigo continua com as condições de antes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const ARQUIVO_PLANO = path.join(dataDir, 'mercadopago-plano.json');

const MP_BASE = 'https://api.mercadopago.com';

function precoReais() {
  return Number(process.env.ASSINATURA_PRECO_REAIS || '19.90');
}

function trialDias() {
  return Number(process.env.ASSINATURA_TRIAL_DIAS || '7');
}

export function assinaturaConfigurada() {
  return !!process.env.MERCADOPAGO_ACCESS_TOKEN;
}

export function infoPreco() {
  return { precoReais: precoReais(), trialDias: trialDias() };
}

async function obterOuCriarPlano() {
  const configAtual = { precoReais: precoReais(), trialDias: trialDias() };
  if (fs.existsSync(ARQUIVO_PLANO)) {
    const salvo = JSON.parse(fs.readFileSync(ARQUIVO_PLANO, 'utf8'));
    if (salvo.precoReais === configAtual.precoReais && salvo.trialDias === configAtual.trialDias) {
      return salvo.planoId;
    }
  }
  const resp = await fetch(`${MP_BASE}/preapproval_plan`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: 'Meu Coach — assinatura mensal',
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: configAtual.precoReais,
        currency_id: 'BRL',
        free_trial: { frequency: configAtual.trialDias, frequency_type: 'days' },
      },
      // credit_card/debit_card = cartão (fluxo já testado); bank_transfer = Pix. Deixar os três
      // habilitados dá opção de escolha no checkout em vez de forçar só Pix.
      payment_methods_allowed: {
        payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }, { id: 'bank_transfer' }],
      },
    }),
  });
  if (!resp.ok) throw new Error(`Mercado Pago respondeu ${resp.status} ao criar o plano: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(ARQUIVO_PLANO, JSON.stringify({ planoId: data.id, ...configAtual }), 'utf8');
  return data.id;
}

// Cria a assinatura do perfil informado, vinculada ao plano (criando o plano se ainda não
// existir). Retorna a URL de checkout (init_point) pra onde o cliente deve redirecionar o
// usuário — lá ele escolhe cartão ou Pix.
export async function criarAssinatura(perfilId, email, backUrl) {
  const planoId = await obterOuCriarPlano();
  const resp = await fetch(`${MP_BASE}/preapproval`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      preapproval_plan_id: planoId,
      external_reference: perfilId,
      payer_email: email,
      back_url: backUrl,
    }),
  });
  if (!resp.ok) throw new Error(`Mercado Pago respondeu ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  return { initPoint: data.init_point, preapprovalId: data.id };
}

// Busca o status REAL da assinatura direto na fonte — nunca confia só no payload do webhook
// (o webhook só avisa "algo mudou", quem manda é sempre essa consulta).
export async function consultarPreapproval(preapprovalId) {
  const resp = await fetch(`${MP_BASE}/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` },
  });
  if (!resp.ok) throw new Error(`Mercado Pago respondeu ${resp.status} ao consultar preapproval ${preapprovalId}`);
  return resp.json();
}

export async function cancelarPreapproval(preapprovalId) {
  const resp = await fetch(`${MP_BASE}/preapproval/${preapprovalId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  if (!resp.ok) throw new Error(`Mercado Pago respondeu ${resp.status} ao cancelar preapproval ${preapprovalId}`);
}

// status do Mercado Pago → status interno da tabela `assinaturas`.
export function statusInterno(statusMp) {
  if (statusMp === 'authorized') return 'ativa';
  if (statusMp === 'paused') return 'atrasada';
  if (statusMp === 'cancelled') return 'cancelada';
  return 'inativa'; // 'pending' — ainda não autorizou o pagamento
}

// Valida o header x-signature do webhook (HMAC-SHA256), conforme a documentação do Mercado
// Pago: https://www.mercadopago.com.br/developers/pt/docs/checkout-api/additional-content/security/signature
export function validarAssinaturaWebhook(req) {
  const segredo = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!segredo) return false;
  const assinatura = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  if (!assinatura || !requestId) return false;

  const partes = Object.fromEntries(
    assinatura.split(',').map((p) => {
      const [k, v] = p.split('=');
      return [k?.trim(), v?.trim()];
    }),
  );
  const ts = partes.ts;
  const hash = partes.v1;
  if (!ts || !hash) return false;

  const dataId = req.query['data.id'] || '';
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;

  const hmac = crypto.createHmac('sha256', segredo).update(manifest).digest('hex');
  return hmac === hash;
}
