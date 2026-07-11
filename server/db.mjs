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

-- Imagens ilustrativas de exercício geradas por IA — cache GLOBAL por nome normalizado
-- (não por perfil): o mesmo exercício não precisa ser gerado de novo para outra pessoa.
CREATE TABLE IF NOT EXISTS imagens_exercicio (
  nome TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  dados BLOB NOT NULL,
  criado_em TEXT NOT NULL
);
`);

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
