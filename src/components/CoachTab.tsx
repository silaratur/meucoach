import { useState } from 'react';
import type { Avaliacao, DadosPerfil, Perfil } from '../types';
import { DIAS_SEMANA } from '../types';
import { avaliarDia } from '../api';
import { hojeISO, uid } from '../storage';
import { dataLocalDe, diaSemanaHoje, metaDiaria, resumoAtividade, streakDias, totaisDoDia } from '../calc';
import { IconeExcluir, IconeCoach, IconeAvaliacao, IconeSono } from './Icones';
import { Flame, Footprints } from 'lucide-react';

function formatarDataLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Segunda-feira da semana N semanas atrás/na frente de hoje (offsetSemanas negativo = passado).
function segundaDaSemana(offsetSemanas: number): Date {
  const hoje = new Date();
  const diaSemana = hoje.getDay(); // 0=domingo..6=sábado
  const deslocamento = diaSemana === 0 ? -6 : 1 - diaSemana;
  const seg = new Date(hoje);
  seg.setDate(hoje.getDate() + deslocamento + offsetSemanas * 7);
  seg.setHours(0, 0, 0, 0);
  return seg;
}

interface Props {
  perfil: Perfil;
  dados: DadosPerfil;
  atualizar: (m: (d: DadosPerfil) => DadosPerfil) => void;
}

// Renderização simples do Markdown retornado (negrito, títulos e listas) — números com unidade
// (kcal, g, h, km, passos...) ganham destaque em cor/negrito para saltar aos olhos no texto corrido.
function Markdown({ texto }: { texto: string }) {
  const html = texto
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/(~?\d[\d.,]*\s?(?:kcal|g|h\d{0,2}|km\/h|km|passos?|min)\b|~?\d[\d.,]*\/dia)/g, '<span class="num-destaque">$1</span>')
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-*] (.*)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }} />;
}

// Separa a seção final de ações práticas (ex.: "3 ações para amanhã", com ou sem "#") do resto do
// texto, pra virarem cards com checkbox em vez de ficarem perdidas dentro do texto corrido.
// Best-effort: aceita lista com "-", "*" ou numerada ("1.", "2)"...); se o formato não bater,
// devolve o texto inteiro em `antes` sem quebrar nada.
function extrairAcoes(texto: string): { antes: string; acoes: string[]; depois: string } {
  const titulo = texto.match(/^.*a[çc][õo]es.*(amanh[ãa]|pr[áa]tica).*$/im);
  if (!titulo || titulo.index == null) return { antes: texto, acoes: [], depois: '' };
  const inicioLista = titulo.index + titulo[0].length;
  const linhas = texto.slice(inicioLista).split('\n');
  const acoes: string[] = [];
  let i = 0;
  for (; i < linhas.length; i++) {
    const linha = linhas[i].trim();
    if (!linha) continue;
    const item = linha.match(/^(?:[-*]|\d+[.)])\s*(.+)$/);
    if (item) {
      acoes.push(item[1].trim().replace(/\*\*(.+?)\*\*/g, '$1'));
      continue;
    }
    break;
  }
  if (!acoes.length) return { antes: texto, acoes: [], depois: '' };
  return { antes: texto.slice(0, titulo.index), acoes, depois: linhas.slice(i).join('\n') };
}

// Card de ação com checkbox — marcado é só de apoio visual nesta sessão (não há campo no backend
// para status de ação individual ainda), reseta ao trocar de dia selecionado ou recarregar a página.
function CardAcao({ texto }: { texto: string }) {
  const [feito, setFeito] = useState(false);
  return (
    <label className={`cartao-acao ${feito ? 'feito' : ''}`}>
      <input type="checkbox" checked={feito} onChange={() => setFeito((v) => !v)} />
      <span>{texto}</span>
    </label>
  );
}

export default function CoachTab({ perfil, dados, atualizar }: Props) {
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const hoje = hojeISO();
  // Relatório do dia: calendário por semana em vez de empilhar todas as avaliações — a lista
  // crescia sem fim e a tela ficava enorme com o passar dos dias.
  const [semanaOffset, setSemanaOffset] = useState(0);
  const [diaSelecionado, setDiaSelecionado] = useState(hoje);

  function irParaSemana(novoOffset: number) {
    const novoInicio = segundaDaSemana(novoOffset);
    const chavesDaSemana = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(novoInicio);
      d.setDate(novoInicio.getDate() + i);
      return formatarDataLocal(d);
    });
    setSemanaOffset(novoOffset);
    setDiaSelecionado(chavesDaSemana.includes(hoje) ? hoje : chavesDaSemana[chavesDaSemana.length - 1]);
  }

  const inicioSemana = segundaDaSemana(semanaOffset);
  const diasDaSemana = DIAS_SEMANA.map((nomeDia, i) => {
    const data = new Date(inicioSemana);
    data.setDate(inicioSemana.getDate() + i);
    const chave = formatarDataLocal(data);
    return {
      nomeDia,
      chave,
      diaMes: data.getDate(),
      ehHoje: chave === hoje,
      temAvaliacao: dados.avaliacoes.some((a) => dataLocalDe(a.data) === chave),
    };
  });
  const avaliacaoSelecionada = dados.avaliacoes.find((a) => dataLocalDe(a.data) === diaSelecionado);
  const dia = dados.dias[hoje] ?? { data: hoje, registros: [] };
  const totaisHoje = totaisDoDia(dia.registros);
  const treinosHoje = dados.sessoes.filter((s) => dataLocalDe(s.data) === hoje).length;
  const nomeDiaHoje = diaSemanaHoje();
  const treinoPrevistoHoje = (perfil.diasMusculacao?.includes(nomeDiaHoje) ?? false) || (perfil.diasCorrida?.includes(nomeDiaHoje) ?? false);
  const treinoHoje = treinoPrevistoHoje || treinosHoje > 0;
  const meta = metaDiaria(perfil, dados.sessoes, dados.atividadesDiarias, treinoHoje);
  const seteDias = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const treinosSemana = dados.sessoes.filter((s) => new Date(s.data).getTime() >= seteDias).length;
  const atividade = resumoAtividade(dados.atividadesDiarias, 7);
  const streak = streakDias(dados.sessoes);
  const atividadeHoje = dados.atividadesDiarias.find((a) => a.data === hoje);
  const pctCaloriasHoje = meta && totaisHoje.calorias > 0 ? Math.min(100, Math.round((totaisHoje.calorias / meta.kcal) * 100)) : 0;
  const pilaresHoje = [
    dia.registros.length > 0,
    treinosHoje > 0,
    atividadeHoje?.sonoHoras != null,
    atividadeHoje?.passos != null,
    dados.avaliacoes.some((a) => dataLocalDe(a.data) === hoje),
  ];

  async function avaliar() {
    setCarregando(true);
    setErro('');
    try {
      const sessoesRecentes = [...dados.sessoes]
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
      const atividadeRecente = [...dados.atividadesDiarias]
        .sort((a, b) => b.data.localeCompare(a.data))
        .slice(0, 7);
      // Se já existe uma avaliação de hoje, ela é sobrescrita — a nova considera tudo até agora.
      const avaliacaoHojeExistente = dados.avaliacoes.find((a) => dataLocalDe(a.data) === hoje);
      const resp = await avaliarDia(
        perfil,
        dia,
        sessoesRecentes,
        totaisDoDia(dia.registros),
        metaDiaria(perfil, dados.sessoes, dados.atividadesDiarias, treinoHoje),
        atividadeRecente,
        avaliacaoHojeExistente?.texto,
      );
      const avaliacao: Avaliacao = { id: avaliacaoHojeExistente?.id ?? uid(), data: new Date().toISOString(), texto: resp.texto };
      atualizar((d) => ({
        ...d,
        avaliacoes: [avaliacao, ...d.avaliacoes.filter((a) => a.id !== avaliacao.id)].slice(0, 30),
      }));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div>
      <div className="cartao">
        <h2><IconeCoach size={19} /> Avaliação do Coach</h2>
        <div className="resumo-duas-colunas">
          <div className="coluna-resumo">
            <h3 className="rotulo-coluna">Macros de Hoje</h3>
            <div className="mini-barra-linha">
              <div className="barra-meta mini"><div className="barra-meta-cheia" style={{ width: `${pctCaloriasHoje}%` }} /></div>
              <span>{totaisHoje.itensComEstimativa ? Math.round(totaisHoje.calorias) : 0} kcal</span>
            </div>
            <div className="mini-barra-linha">
              <div className="barra-meta mini"><div className="barra-meta-cheia" style={{ width: '100%', background: '#f59e0b' }} /></div>
              <span>{meta ? meta.kcal : '—'} kcal</span>
            </div>
          </div>
          <div className="coluna-resumo">
            <h3 className="rotulo-coluna">Pontos de Atenção</h3>
            {atividade.sonoMedia != null && (
              <p className="ponto-atencao"><IconeSono size={14} /> Sono: <strong>{atividade.sonoMedia}h</strong></p>
            )}
            {atividade.passosMedia != null && (
              <p className="ponto-atencao"><Footprints size={14} /> Passos: <strong>{Math.round(atividade.passosMedia / 1000)}k</strong></p>
            )}
            {atividade.sonoMedia == null && atividade.passosMedia == null && (
              <p className="meta-texto">Sem dados de sono/passos ainda.</p>
            )}
          </div>
        </div>
        {streak > 0 && (
          <p className="streak-texto">
            <Flame size={15} /> Sequência de <strong>{streak}</strong> {streak === 1 ? 'dia ativo' : 'dias ativos'}! · Treinos esta semana: <strong>{treinosSemana}</strong>
          </p>
        )}
        <button className="primario grande" onClick={avaliar} disabled={carregando}>
          {carregando ? <><IconeCoach size={16} /> Analisando seu dia...</> : <><IconeAvaliacao size={16} /> Avaliar meu dia (alimentação + treino)</>}
        </button>
        {erro && <p className="erro">{erro}</p>}
      </div>

      <div className="cartao">
        <div className="calendario-topo">
          <button className="mini secundario" onClick={() => irParaSemana(semanaOffset - 1)} title="Semana anterior">
            ‹
          </button>
          <h2><IconeAvaliacao size={19} /> Relatório do dia</h2>
          <button
            className="mini secundario"
            onClick={() => irParaSemana(semanaOffset + 1)}
            disabled={semanaOffset >= 0}
            title="Próxima semana"
          >
            ›
          </button>
        </div>
        <div className="visao-semana">
          {diasDaSemana.map((d) => (
            <button
              key={d.chave}
              className={`dia-semana-item ${d.ehHoje ? 'hoje' : ''} ${diaSelecionado === d.chave ? 'selecionado' : ''}`}
              onClick={() => setDiaSelecionado(d.chave)}
            >
              <small>{d.nomeDia.slice(0, 3)}</small>
              <strong>{d.diaMes}</strong>
              <span className={`indicador-relatorio ${d.temAvaliacao ? 'presente' : ''}`} />
            </button>
          ))}
        </div>

        <div className="detalhe-dia-semana">
          {avaliacaoSelecionada ? (
            <>
              <div className="cabecalho-avaliacao">
                <p className="meta-texto">
                  {new Date(avaliacaoSelecionada.data).toLocaleDateString('pt-BR')}{' '}
                  <small>às {new Date(avaliacaoSelecionada.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>
                </p>
                {diaSelecionado === hoje && (
                  <div className="stepper-completude" title="Refeições · Treino · Sono · Passos · Avaliação">
                    {pilaresHoje.map((ok, i) => (
                      <span key={i} className={`stepper-ponto ${ok ? 'feito' : ''}`} />
                    ))}
                  </div>
                )}
              </div>
              {(() => {
                const { antes, acoes, depois } = extrairAcoes(avaliacaoSelecionada.texto);
                return (
                  <>
                    <Markdown texto={antes} />
                    {acoes.map((a, i) => <CardAcao key={i} texto={a} />)}
                    {depois && <Markdown texto={depois} />}
                  </>
                );
              })()}
              <button
                className="mini"
                onClick={() => atualizar((d) => ({ ...d, avaliacoes: d.avaliacoes.filter((x) => x.id !== avaliacaoSelecionada.id) }))}
              >
                <IconeExcluir size={14} /> Apagar
              </button>
            </>
          ) : (
            <p className="meta-texto">
              {diaSelecionado === hoje
                ? 'Nenhuma avaliação ainda hoje — gere uma acima.'
                : 'Nenhuma avaliação registrada para este dia.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
