// Login por nome + PIN. Cada aparelho lembra as contas em que já entrou
// (mc:sessoes), mas os dados de verdade sempre vêm do servidor — por isso
// funcionam de qualquer navegador ou celular.

export interface SessaoLogin {
  id: string;
  nome: string;
  token: string;
}

const KEY_SESSOES = 'mc:sessoes';
const KEY_ATIVO = 'mc:perfilAtivo';

function lerSessoes(): SessaoLogin[] {
  try {
    return JSON.parse(localStorage.getItem(KEY_SESSOES) || '[]');
  } catch {
    return [];
  }
}

function gravarSessoes(sessoes: SessaoLogin[]) {
  localStorage.setItem(KEY_SESSOES, JSON.stringify(sessoes));
}

export function listarSessoes(): SessaoLogin[] {
  return lerSessoes();
}

export function tokenDe(id: string): string | null {
  return lerSessoes().find((s) => s.id === id)?.token ?? null;
}

export function perfilAtivoId(): string | null {
  return localStorage.getItem(KEY_ATIVO);
}

export function definirPerfilAtivo(id: string | null) {
  if (id) localStorage.setItem(KEY_ATIVO, id);
  else localStorage.removeItem(KEY_ATIVO);
}

// "Esquecer" só remove o login deste aparelho — os dados continuam salvos no
// servidor e a pessoa pode entrar de novo com nome + PIN quando quiser.
export function esquecerNesteAparelho(id: string) {
  gravarSessoes(lerSessoes().filter((s) => s.id !== id));
  if (perfilAtivoId() === id) definirPerfilAtivo(null);
}

function salvarSessaoLocal(s: SessaoLogin) {
  gravarSessoes([...lerSessoes().filter((x) => x.id !== s.id), s]);
}

async function chamarAuth(url: string, body: unknown): Promise<{ token: string; perfil: { id: string; nome: string } }> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data as { error?: string }).error || `Erro ${resp.status}`);
  return data as { token: string; perfil: { id: string; nome: string } };
}

export async function criarConta(nome: string, pin: string): Promise<SessaoLogin> {
  const { token, perfil } = await chamarAuth('/api/auth/criar', { nome, pin });
  const s: SessaoLogin = { id: perfil.id, nome: perfil.nome, token };
  salvarSessaoLocal(s);
  return s;
}

export async function entrar(nome: string, pin: string): Promise<SessaoLogin> {
  const { token, perfil } = await chamarAuth('/api/auth/entrar', { nome, pin });
  const s: SessaoLogin = { id: perfil.id, nome: perfil.nome, token };
  salvarSessaoLocal(s);
  return s;
}
