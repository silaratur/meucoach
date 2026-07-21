// Renderização simples do Markdown retornado pela IA (negrito, títulos e listas) — números com
// unidade (kcal, g, h, km, passos...) ganham destaque em cor/negrito para saltar aos olhos no
// texto corrido. Compartilhado entre qualquer tela que mostre texto gerado pela IA (Coach,
// análise nutricional da foto de refeição etc.) — nunca duplicar essa lógica localmente.
// `inline`: pra texto de uma linha só encaixado no meio de outro elemento (ex.: card de ação com
// checkbox, motivo de uma sugestão) — sem <p>/<br>, vira um <span> que herda o texto ao redor.
export default function Markdown({ texto, inline }: { texto: string; inline?: boolean }) {
  const html = texto
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/(~?\d[\d.,]*\s?(?:kcal|g|h\d{0,2}|km\/h|km|passos?|min)\b|~?\d[\d.,]*\/dia)/g, '<span class="num-destaque">$1</span>')
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-*] (.*)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>');
  if (inline) {
    return <span className="markdown markdown-inline" dangerouslySetInnerHTML={{ __html: html.replace(/\n+/g, ' ') }} />;
  }
  const bloco = html.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br/>');
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: `<p>${bloco}</p>` }} />;
}
