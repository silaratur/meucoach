// Assinatura mensal via Mercado Pago (Preapproval avulso — cobrança recorrente), pra custear
// os créditos de IA que o app consome. Sem SDK: chama a API REST direto (mesmo estilo de
// server/wger.mjs).
//
// Tentei rotear por um "Plano" (preapproval_plan) pra liberar Pix além de cartão no checkout,
// mas testado ao vivo em produção o /preapproval passou a exigir card_token_id (ou seja, exige
// tokenizar o cartão no client via Checkout Bricks/MP.js — um form de pagamento próprio dentro
// do app, não mais o redirect simples pro checkout hospedado do Mercado Pago). Isso é uma
// integração bem maior do que "adicionar uma forma de pagamento" — voltei pro preapproval
// avulso (só cartão, redirect simples, já testado e funcionando) até decidirmos investir
// nisso. Ver PENDÊNCIAS no plano salvo em ~/.claude/plans.
import crypto from 'node:crypto';

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

// Cria uma assinatura "avulsa" (sem plano pré-cadastrado) pro perfil informado. Retorna a URL de
// checkout (init_point) pra onde o cliente deve redirecionar o usuário.
export async function criarAssinatura(perfilId, email, backUrl) {
  const resp = await fetch(`${MP_BASE}/preapproval`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: 'Meu Coach — assinatura mensal',
      external_reference: perfilId,
      payer_email: email,
      back_url: backUrl,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: precoReais(),
        currency_id: 'BRL',
        free_trial: { frequency: trialDias(), frequency_type: 'days' },
      },
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
