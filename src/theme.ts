// Preferência de tema (claro/escuro) — cacheada neste aparelho (aplicação instantânea, sem
// esperar o perfil carregar do servidor) e sincronizada via Perfil.tema entre aparelhos.
export type Tema = 'claro' | 'escuro';

const CHAVE_LOCAL = 'mc:tema';

export function temaSalvoNesteAparelho(): Tema {
  return localStorage.getItem(CHAVE_LOCAL) === 'claro' ? 'claro' : 'escuro';
}

export function aplicarTema(tema: Tema) {
  document.documentElement.setAttribute('data-theme', tema === 'claro' ? 'light' : 'dark');
  localStorage.setItem(CHAVE_LOCAL, tema);
  // O cabeçalho do app é sempre verde (nos dois temas) — a barra de status do navegador/PWA
  // acompanha esse mesmo verde, só ajustando o tom pro par certo de cada tema.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tema === 'claro' ? '#15803d' : '#22c55e');
}
