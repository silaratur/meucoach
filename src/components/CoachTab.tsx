import { useState } from 'react';
import type { Avaliacao, DadosPerfil, Perfil } from '../types';
import { avaliarDia } from '../api';
import { hojeISO, uid } from '../storage';
import { dataLocalDe, diaSemanaHoje, metaDiaria, resumoAtividade, streakDias, totaisDoDia } from '../calc';
import { IconeExcluir } from './Icones';

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

      {dados.avaliacoes.map((a) => (
        <div className="cartao" key={a.id}>
          <h2>
            📋 {new Date(a.data).toLocaleDateString('pt-BR')}{' '}
            <small>{new Date(a.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>
          </h2>
          <Markdown texto={a.texto} />
          <button
            className="mini"
            onClick={() => atualizar((d) => ({ ...d, avaliacoes: d.avaliacoes.filter((x) => x.id !== a.id) }))}
          >
            <IconeExcluir size={14} /> Apagar
          </button>
        </div>
      ))}
    </div>
  );
}
