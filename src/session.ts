// Token de autenticação da pessoa ativa neste aparelho, compartilhado entre
// storage.ts, media.ts e api.ts sem precisar passá-lo por todos os componentes.

let tokenAtual: string | null = null;
let aoNaoAutorizadoCb: (() => void) | null = null;

export function definirToken(t: string | null) {
  tokenAtual = t;
}

export function tokenAtivo(): string | null {
  return tokenAtual;
}

// App.tsx registra aqui o que fazer quando o servidor recusa o token (expirado/inválido).
export function aoNaoAutorizado(cb: () => void) {
  aoNaoAutorizadoCb = cb;
}

export function notificarNaoAutorizado() {
  aoNaoAutorizadoCb?.();
}

export function cabecalhos(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...(extra ?? {}) };
  if (tokenAtual) h['Authorization'] = `Bearer ${tokenAtual}`;
  return h;
}
