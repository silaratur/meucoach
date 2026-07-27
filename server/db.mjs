// Banco de dados do Meu Coach (SQLite): perfis, dados de cada pessoa e mídias.
// Um único arquivo em disco, persistente entre reinícios do servidor/container.
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'meucoach.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS perfis (
  id TEXT PRIMARY KEY,
  nome_lower TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  perfil_json TEXT NOT NULL,
  dados_json TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_perfis_nome ON perfis(nome_lower);

CREATE TABLE IF NOT EXISTS midias (
  id TEXT PRIMARY KEY,
  perfil_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  mime TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  dados BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_midias_perfil ON midias(perfil_id);

-- Inscrições de notificação push (lembrete diário) — uma linha por navegador/aparelho inscrito,
-- não por perfil (a mesma pessoa pode ter mais de um aparelho). endpoint é único por natureza
-- (identifica o navegador/aparelho junto ao serviço de push), então serve de chave de upsert.
CREATE TABLE IF NOT EXISTS push_inscricoes (
  id TEXT PRIMARY KEY,
  perfil_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  FOREIGN KEY (perfil_id) REFERENCES perfis(id)
);
CREATE INDEX IF NOT EXISTS idx_push_perfil ON push_inscricoes(perfil_id);

-- Marca a última vez que um TIPO de push periódico (não os disparados por evento, esses já se
-- auto-controlam comparando antes/depois) foi enviado pra um perfil — evita repetir avisos como
-- "reengajamento" todo dia, ou mandar "plano venceu" de novo pro mesmo plano já avisado.
CREATE TABLE IF NOT EXISTS push_marcadores (
  perfil_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  enviado_em TEXT NOT NULL,
  PRIMARY KEY (perfil_id, tipo)
);

-- Controle de força bruta no login: contagem de tentativas erradas de PIN por conta (nome_lower),
-- com bloqueio temporário progressivo. Sem isso, o PIN numérico de 4-6 dígitos (10 mil a 1 milhão
-- de combinações) é varrível por completo via requisições HTTP repetidas.
CREATE TABLE IF NOT EXISTS tentativas_login (
  nome_lower TEXT PRIMARY KEY,
  tentativas INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate TEXT
);

-- Tabela órfã: era o status da assinatura mensal via Mercado Pago (removida — o app voltou a
-- ser gratuito, com doação Pix opcional em vez de cobrança automática). Mantida só porque já
-- tem dado real de teste em produção; não é lida nem escrita por nenhum código atual.
CREATE TABLE IF NOT EXISTS assinaturas (
  perfil_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'inativa',
  valida_ate TEXT,
  mp_preapproval_id TEXT,
  mp_payer_email TEXT,
  atualizado_em TEXT NOT NULL,
  FOREIGN KEY (perfil_id) REFERENCES perfis(id)
);

-- Geração de plano por IA (musculação/corrida/dieta) roda em background no próprio processo —
-- sem fila externa — pra sobreviver a tela bloqueada/app em segundo plano no celular. Só guarda
-- status: o resultado vai direto pra dados_json do perfil quando conclui; o cliente recarrega os
-- dados quando o job termina (via push ou polling em primeiro plano).
CREATE TABLE IF NOT EXISTS jobs_ia (
  id TEXT PRIMARY KEY,
  perfil_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processando',
  erro TEXT,
  criado_em TEXT NOT NULL,
  concluido_em TEXT,
  FOREIGN KEY (perfil_id) REFERENCES perfis(id)
);
CREATE INDEX IF NOT EXISTS idx_jobs_ia_perfil ON jobs_ia(perfil_id);
`);

// Migração: adiciona token_version se ainda não existir — permite invalidar todas as sessões
// emitidas antes de um "sair de todos os aparelhos" (ou suspeita de token vazado), sem precisar
// esperar a expiração do JWT.
const colunasPerfis = db.prepare('PRAGMA table_info(perfis)').all();
if (!colunasPerfis.some((c) => c.name === 'token_version')) {
  db.exec('ALTER TABLE perfis ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
}

// Todo job "processando" ao ligar o processo é órfão por definição — nenhuma promise em memória
// pode corresponder a ele (o container reinicia a cada deploy). Marca como falho de uma vez, com
// aviso, em vez de deixar o cliente esperando pra sempre por um job que nunca vai terminar.
db.prepare(
  "UPDATE jobs_ia SET status = 'falhou', erro = 'Interrompido por reinício do servidor.', concluido_em = ? WHERE status = 'processando'",
).run(new Date().toISOString());

// Segredo para assinar os tokens de sessão: gerado uma vez e persistido em disco
// (assim os logins continuam válidos entre reinícios do servidor).
function obterSegredoJWT() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const arquivo = path.join(dataDir, 'jwt-secret');
  if (fs.existsSync(arquivo)) return fs.readFileSync(arquivo, 'utf8').trim();
  const segredo = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(arquivo, segredo, { mode: 0o600 });
  return segredo;
}

export const JWT_SECRET = obterSegredoJWT();

export function uid() {
  return crypto.randomUUID();
}
