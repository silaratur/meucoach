import { useState } from 'react';
import type { Avaliacao, DadosPerfil, Perfil } from '../types';
import { DIAS_SEMANA } from '../types';
import { avaliarDia } from '../api';
import { hojeISO, uid } from '../storage';
import { dataLocalDe, diaSemanaHoje, metaDiaria, resumoAtividade, streakDias, totaisDoDia } from '../calc';
import { IconeExcluir } from './Icones';

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

// Anel de progresso estilo Apple Health — sem bibliotecas, SVG puro.
function AnelProgresso({ valor, meta, cor, rotulo, exibir }: { valor: number; meta: number; cor: string; rotulo: string; exibir: string }) {
  const raio = 34;
  const circunferencia = 2 * Math.PI * raio;
  const pct = meta > 0 ? Math.max(0, Math.min(1, valor / meta)) : 0;
  return (
    <div className="anel-item">
      <svg viewBox="0 0 80 80" className="anel-svg">
        <circle cx="40" cy="40" r={raio} fill="none" stroke="var(--borda)" strokeWidth="8" />
        <circle
          cx="40"
          cy="40"
          r={raio}
          fill="none"
          stroke={cor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circunferencia}
          strokeDashoffset={circunferencia * (1 - pct)}
          transform="rotate(-90 40 40)"
        />
        <text x="40" y="45" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--texto)">
          {exibir}
        </text>
      </svg>
      <small>{rotulo}</small>
    </div>
  );
}

// Renderização simples do Markdown retornado (negrito, títulos e listas)
function Markdown({ texto }: { texto: string }) {
  const html = texto
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
  const objetivoTreinosSemana = perfil.diasMusculacao?.length || perfil.frequenciaSemana || 3;

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
        <h2>🤖 Avaliação do Coach</h2>
        <div className="linha-aneis">
          <AnelProgresso
            valor={totaisHoje.calorias}
            meta={meta?.kcal ?? 2000}
            cor="#22c55e"
            rotulo="Calorias"
            exibir={totaisHoje.itensComEstimativa ? String(Math.round(totaisHoje.calorias)) : '—'}
          />
          <AnelProgresso
            valor={treinosSemana}
            meta={objetivoTreinosSemana}
            cor="#2563eb"
            rotulo="Treinos/semana"
            exibir={`${treinosSemana}/${objetivoTreinosSemana}`}
          />
          <AnelProgresso
            valor={atividade.sonoMedia ?? 0}
            meta={8}
            cor="#7c3aed"
            rotulo="Sono médio"
            exibir={atividade.sonoMedia != null ? `${atividade.sonoMedia}h` : '—'}
          />
        </div>
        {streak > 0 && (
          <p className="streak-texto">
            🔥 Sequência de <strong>{streak}</strong> {streak === 1 ? 'dia ativo' : 'dias ativos'}!
          </p>
        )}
        <div className="grade-metricas">
          <div><small>Refeições hoje</small><strong>{dia.registros.length}</strong></div>
          <div><small>Calorias hoje</small><strong>{totaisHoje.itensComEstimativa ? `~${Math.round(totaisHoje.calorias)}` : '—'}</strong></div>
          <div><small>Meta kcal</small><strong>{meta ? `~${meta.kcal}` : '—'}</strong></div>
          <div><small>Proteína hoje</small><strong>{totaisHoje.itensComEstimativa ? `${Math.round(totaisHoje.proteinas_g)}g` : '—'}</strong></div>
          <div><small>Treinos hoje</small><strong>{treinosHoje}</strong></div>
          <div><small>Treinos 7 dias</small><strong>{treinosSemana}</strong></div>
          {atividade.passosMedia != null && <div><small>Passos/dia (média)</small><strong>{atividade.passosMedia.toLocaleString('pt-BR')}</strong></div>}
          {atividade.sonoMedia != null && <div><small>Sono/noite (média)</small><strong>{atividade.sonoMedia}h</strong></div>}
        </div>
        <button className="primario grande" onClick={avaliar} disabled={carregando}>
          {carregando ? '🤖 Analisando seu dia...' : '📋 Avaliar meu dia (alimentação + treino)'}
        </button>
        {erro && <p className="erro">{erro}</p>}
      </div>

      <div className="cartao">
        <div className="calendario-topo">
          <button className="mini secundario" onClick={() => irParaSemana(semanaOffset - 1)} title="Semana anterior">
            ‹
          </button>
          <h2>📋 Relatório do dia</h2>
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
              <p className="meta-texto">
                {new Date(avaliacaoSelecionada.data).toLocaleDateString('pt-BR')}{' '}
                <small>às {new Date(avaliacaoSelecionada.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>
              </p>
              <Markdown texto={avaliacaoSelecionada.texto} />
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
