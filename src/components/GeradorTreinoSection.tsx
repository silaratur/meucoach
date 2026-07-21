import { useEffect, useState } from 'react';
import type { DadosPerfil, LocalTreino, Perfil, PlanoMusculacao, Treino } from '../types';
import { LOCAIS } from '../types';
import { uid, hojeISO } from '../storage';
import { dataLocalDe } from '../calc';
import { gerarPlano, gerarTreino } from '../api';
import { IconeComecar, IconeEditar, IconeExcluir, IconeCoach, IconeAquecimento, IconeCorrida, IconeAlongamento, IconeDica, ICONE_LOCAL } from './Icones';
import { Zap, CalendarDays, TrendingUp, PartyPopper } from 'lucide-react';
import Markdown from './Markdown';

// Relatório do dia mais recente (ontem ou hoje) — se indicar déficit/excesso de calorias ou
// atividade, entra como contexto pra recomendação de hoje favorecer recuperação gradual.
function avaliacaoRecenteDe(dados: DadosPerfil): string | undefined {
  const ultima = dados.avaliacoes[0];
  if (!ultima) return undefined;
  const hoje = hojeISO();
  const ontem = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const dataUltima = dataLocalDe(ultima.data);
  if (dataUltima !== hoje && dataUltima !== ontem) return undefined; // relatório velho — não é mais um bom guia pra hoje
  return ultima.texto;
}

interface Props {
  perfil: Perfil;
  dados: DadosPerfil;
  atualizar: (m: (d: DadosPerfil) => DadosPerfil) => void;
  aoComecarDia: (treino: Treino) => void;
  aoMontarManualmente: () => void;
}

type DuracaoPlano = '1dia' | '1semana' | '2semanas' | '1mes';

const OPCOES_DURACAO: { value: DuracaoPlano; label: string; semanas?: number }[] = [
  { value: '1dia', label: '1 dia' },
  { value: '1semana', label: '1 semana', semanas: 1 },
  { value: '2semanas', label: '2 semanas', semanas: 2 },
  { value: '1mes', label: '1 mês', semanas: 4 },
];

// Resumo de desempenho do plano anterior (aderência, RPE, progressão de carga) para o
// Coach avaliar antes de montar o próximo — sem isso, cada plano nasceria "no zero".
function planoAnteriorResumoDe(dados: DadosPerfil) {
  const anterior = dados.planosMusculacao[0];
  if (!anterior) return undefined;

  const sessoesDoCiclo = dados.sessoes.filter((s) => s.data >= anterior.criadoEm);
  const rpes = sessoesDoCiclo.map((s) => s.rpe).filter((r): r is number => r != null);
  const rpeMedioRegistrado = rpes.length ? +(rpes.reduce((a, b) => a + b, 0) / rpes.length).toFixed(1) : undefined;

  const porExercicio = new Map<string, { nome: string; primeira: number; ultima: number }>();
  for (const s of [...sessoesDoCiclo].sort((a, b) => a.data.localeCompare(b.data))) {
    for (const item of s.itens) {
      const cargas = item.seriesFeitas.map((x) => x.cargaKg).filter((c): c is number => !!c);
      if (!cargas.length) continue;
      const maxCarga = Math.max(...cargas);
      const chave = item.nome.toLowerCase();
      const atual = porExercicio.get(chave);
      if (!atual) porExercicio.set(chave, { nome: item.nome, primeira: maxCarga, ultima: maxCarga });
      else atual.ultima = maxCarga;
    }
  }

  return {
    nome: anterior.nome,
    semanas: anterior.semanas,
    criadoEm: anterior.criadoEm,
    estrategiaAnterior: anterior.estrategiaMes,
    totalDias: anterior.dias.length,
    diasConcluidos: anterior.concluidos.length,
    percentualAdesao: anterior.dias.length ? Math.round((anterior.concluidos.length / anterior.dias.length) * 100) : 0,
    rpeMedioRegistrado,
    progressaoCargas: [...porExercicio.values()],
    diasNaoFeitos: anterior.dias
      .filter((d) => !anterior.concluidos.includes(d.id))
      .map((d) => `${d.dia} (semana ${d.semana}) — ${d.objetivo}`)
      .slice(0, 10),
  };
}

export default function GeradorTreinoSection({ perfil, dados, atualizar, aoComecarDia, aoMontarManualmente }: Props) {
  const [duracaoPlano, setDuracaoPlano] = useState<DuracaoPlano>('1dia');
  const [local, setLocal] = useState<LocalTreino>('academia');
  const [foco, setFoco] = useState('coach');
  const [duracaoSessao, setDuracaoSessao] = useState(45);
  // Texto do campo separado do número salvo: permite apagar tudo e digitar de novo sem o
  // campo saltar pra um valor padrão a cada tecla — o padrão só entra ao perder o foco.
  const [duracaoTexto, setDuracaoTexto] = useState('45');
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState('');
  const [semanaSelecionada, setSemanaSelecionada] = useState<number | null>(null);

  const plano = dados.planosMusculacao[0] ?? null;
  const opcaoAtual = OPCOES_DURACAO.find((o) => o.value === duracaoPlano)!;

  useEffect(() => {
    setSemanaSelecionada(null);
  }, [plano?.id]);

  async function gerar() {
    setGerando(true);
    setErro('');
    try {
      const historico: { exercicio: string; ultimaCargaKg?: number }[] = [];
      const vistos = new Set<string>();
      for (const s of [...dados.sessoes].sort((a, b) => b.data.localeCompare(a.data))) {
        for (const item of s.itens) {
          const chave = item.nome.toLowerCase();
          if (vistos.has(chave)) continue;
          vistos.add(chave);
          const cargas = item.seriesFeitas.map((x) => x.cargaKg).filter((c): c is number => !!c);
          historico.push({ exercicio: item.nome, ultimaCargaKg: cargas.length ? Math.max(...cargas) : undefined });
        }
      }
      const sessoesRecentes = [...dados.sessoes]
        .sort((a, b) => b.data.localeCompare(a.data))
        .slice(0, 8)
        .map((s) => ({ data: s.data.slice(0, 10), nome: s.nomeTreino, exercicios: s.itens.map((i) => i.nome) }));
      const planoCorridaAtivo = dados.planosCorrida[0];
      const planoCorridaResumo = planoCorridaAtivo
        ? {
            nome: planoCorridaAtivo.nome,
            objetivo: planoCorridaAtivo.objetivo,
            diasDeCorrida: perfil.diasCorrida,
            estruturaSemanal: planoCorridaAtivo.dias
              .filter((d) => d.semana === 1)
              .map((d) => ({ dia: d.dia, tipo: d.tipo, distanciaKm: d.distanciaKm })),
          }
        : undefined;
      const planoAnteriorResumo = planoAnteriorResumoDe(dados);
      const avaliacaoRecente = avaliacaoRecenteDe(dados);
      // Sono ruim ou atividade muito alta/baixa nos últimos dias também entram na recomendação.
      const atividadeRecente = [...dados.atividadesDiarias].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 5);

      if (duracaoPlano === '1dia') {
        const t = await gerarTreino(perfil, local, foco, duracaoSessao, historico.slice(0, 30), sessoesRecentes, planoCorridaResumo, planoAnteriorResumo, avaliacaoRecente, atividadeRecente);
        const novo: Treino = {
          ...t,
          id: uid(),
          criadoEm: new Date().toISOString(),
          exercicios: t.exercicios.map((e) => ({ ...e, id: uid() })),
        };
        atualizar((d) => ({ ...d, treinos: [novo, ...d.treinos] }));
      } else {
        const semanas = opcaoAtual.semanas ?? 4;
        const p = await gerarPlano(perfil, local, duracaoSessao, semanas, historico.slice(0, 30), sessoesRecentes, planoCorridaResumo, planoAnteriorResumo, foco, avaliacaoRecente, atividadeRecente);
        const novo: PlanoMusculacao = {
          id: uid(),
          nome: p.nome,
          semanas: p.semanas ?? semanas,
          avaliacaoInicial: p.avaliacaoInicial,
          estrategiaMes: p.estrategiaMes,
          recomendacoesGerais: p.recomendacoesGerais,
          local,
          criadoEm: new Date().toISOString(),
          concluidos: [],
          dias: p.dias.map((d) => ({
            ...d,
            id: uid(),
            exercicios: d.exercicios.map((e) => ({ ...e, id: uid() })),
          })),
        };
        atualizar((d) => ({ ...d, planosMusculacao: [novo] }));
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setGerando(false);
    }
  }

  function alternarConcluido(diaId: string) {
    if (!plano) return;
    atualizar((d) => ({
      ...d,
      planosMusculacao: d.planosMusculacao.map((p) =>
        p.id === plano.id
          ? {
              ...p,
              concluidos: p.concluidos.includes(diaId)
                ? p.concluidos.filter((x) => x !== diaId)
                : [...p.concluidos, diaId],
            }
          : p,
      ),
    }));
  }

  function comecarDia(diaId: string) {
    if (!plano) return;
    const dia = plano.dias.find((d) => d.id === diaId);
    if (!dia) return;
    const treino: Treino = {
      id: dia.id,
      nome: `${dia.objetivo} (semana ${dia.semana})`,
      local: plano.local,
      aquecimento: dia.aquecimento,
      aquecimentoMin: dia.aquecimentoMin,
      dicas: [dia.cardioRecomendado, dia.alongamento ? `Alongamento: ${dia.alongamento}` : '']
        .filter(Boolean)
        .join(' · '),
      exercicios: dia.exercicios,
      criadoEm: plano.criadoEm,
    };
    aoComecarDia(treino);
  }

  const semanas = plano ? [...new Set(plano.dias.map((d) => d.semana))].sort((a, b) => a - b) : [];
  const feitos = plano?.concluidos.length ?? 0;
  const semanaAtual = plano ? semanas.find((s) => plano.dias.some((d) => d.semana === s && !plano.concluidos.includes(d.id))) ?? semanas[0] : 0;
  const semanaMostrada = semanaSelecionada ?? semanaAtual;

  return (
    <>
      <div className="cartao">
        <h2><IconeCoach size={19} /> Gerar treino com o Coach</h2>
        <label>Onde vai treinar?</label>
        <div className="chips-tipo">
          {LOCAIS.map((l) => {
            const Icone = ICONE_LOCAL[l.value];
            return (
              <button key={l.value} className={`chip ${local === l.value ? 'ativa' : ''}`} onClick={() => setLocal(l.value)}>
                <Icone size={15} /> {l.label}
              </button>
            );
          })}
        </div>

        <label>Duração do plano</label>
        <div className="chips-tipo">
          {OPCOES_DURACAO.map((o) => (
            <button key={o.value} className={`chip ${duracaoPlano === o.value ? 'ativa' : ''}`} onClick={() => setDuracaoPlano(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
        <p className="meta-texto">
          {duracaoPlano === '1dia'
            ? 'Um treino avulso, pra fazer hoje.'
            : `Uma periodização completa: treino dia a dia, evoluindo ao longo de ${opcaoAtual.label}, respeitando seus dias disponíveis (${perfil.diasMusculacao?.length ? perfil.diasMusculacao.join(', ') : 'defina na avaliação acima'}).`}
        </p>

        <div className="linha">
          <div>
            <label>Foco</label>
            <select value={foco} onChange={(e) => setFoco(e.target.value)}>
              <option value="coach">Coach decide (recomendado)</option>
              <option value="corpo inteiro">Corpo inteiro</option>
              <option value="superiores (peito, costas, ombros e braços)">Superiores</option>
              <option value="inferiores (pernas e glúteos)">Inferiores</option>
              <option value="peito e tríceps">Peito e tríceps</option>
              <option value="costas e bíceps">Costas e bíceps</option>
              <option value="pernas">Pernas</option>
              <option value="cardio e resistência">Cardio / resistência</option>
              <option value="abdômen e core">Abdômen e core</option>
            </select>
          </div>
          <div>
            <label>Duração da sessão (min)</label>
            <input
              type="number"
              value={duracaoTexto}
              onChange={(e) => setDuracaoTexto(e.target.value)}
              onBlur={() => {
                const n = parseInt(duracaoTexto, 10);
                const valido = Number.isFinite(n) && n > 0 ? n : 45;
                setDuracaoSessao(valido);
                setDuracaoTexto(String(valido));
              }}
            />
          </div>
        </div>

        <div className="botoes">
          <button
            className="primario grande"
            onClick={gerar}
            disabled={gerando || (duracaoPlano !== '1dia' && !perfil.diasMusculacao?.length)}
          >
            {gerando ? (
              <><IconeCoach size={17} /> {duracaoPlano === '1dia' ? 'Montando seu treino...' : 'Montando seu plano... (pode levar até um minuto)'}</>
            ) : (
              <><Zap size={17} /> {duracaoPlano === '1dia' ? 'Gerar treino' : `Gerar plano de ${opcaoAtual.label}`}</>
            )}
          </button>
          {duracaoPlano === '1dia' && <button onClick={aoMontarManualmente}><IconeEditar size={15} /> Montar manualmente</button>}
        </div>
        {duracaoPlano !== '1dia' && !perfil.diasMusculacao?.length && (
          <p className="meta-texto"><IconeDica size={14} /> Defina seus dias de musculação na "Avaliação do aluno" acima antes de gerar.</p>
        )}
        {erro && <p className="erro">{erro}</p>}
      </div>

      {plano && (
        <div className="cartao">
          <h2><CalendarDays size={19} /> {plano.nome}</h2>
          <p className="meta-texto">
            {plano.semanas === 1 ? '1 semana' : `${plano.semanas} semanas`} · {plano.dias.length} treinos
          </p>
          <div className="avaliacao-inicial"><Markdown texto={plano.avaliacaoInicial} /></div>
          <details className="sugestao">
            <summary><strong><TrendingUp size={15} /> Estratégia do plano</strong></summary>
            <Markdown texto={plano.estrategiaMes} />
          </details>
          <p className="resumo-evolucao">
            <strong>{feitos}/{plano.dias.length}</strong> treinos concluídos
          </p>
          {plano.dias.length > 0 && feitos === plano.dias.length && (
            <p className="resumo-evolucao celebracao"><PartyPopper size={16} /> Plano concluído! Hora de gerar o próximo ciclo.</p>
          )}
          <div className="barra-meta">
            <div className="barra-meta-cheia" style={{ width: `${plano.dias.length ? Math.round((feitos / plano.dias.length) * 100) : 0}%` }} />
          </div>

          {semanas.length > 1 && (
            <div className="pills-semana">
              {semanas.map((sem) => {
                const feitosSemana = plano.dias.filter((d) => d.semana === sem && plano.concluidos.includes(d.id)).length;
                const totalSemana = plano.dias.filter((d) => d.semana === sem).length;
                return (
                  <button
                    key={sem}
                    className={`pill-semana ${semanaMostrada === sem ? 'ativa' : ''}`}
                    onClick={() => setSemanaSelecionada(sem)}
                  >
                    Semana {sem} <small>{feitosSemana}/{totalSemana}</small>
                  </button>
                );
              })}
            </div>
          )}

          {plano.dias
            .filter((d) => d.semana === semanaMostrada)
            .map((d) => (
              <div key={d.id} className={`dia-corrida ${plano.concluidos.includes(d.id) ? 'feito' : ''}`}>
                <label className="dia-check">
                  <input type="checkbox" checked={plano.concluidos.includes(d.id)} onChange={() => alternarConcluido(d.id)} />
                  <span>
                    <strong>{d.dia} — {d.objetivo}</strong>
                    <small>
                      {d.gruposMusculares} · {d.exercicios.length} exercícios · ~{d.tempoEstimadoMin} min
                    </small>
                  </span>
                </label>
                <p className="detalhes-dia"><IconeAquecimento size={14} /> {d.aquecimento}</p>
                {d.exercicios.map((e) => (
                  <p key={e.id} className="detalhes-dia">
                    &nbsp;&nbsp;• <strong>{e.nome}</strong> — {e.series}x{e.repeticoes}
                    {e.cargaSugerida ? ` · ${e.cargaSugerida}` : ''} · descanso {e.descansoSeg}s
                  </p>
                ))}
                {d.cardioRecomendado && <p className="detalhes-dia"><IconeCorrida size={14} /> Cardio: {d.cardioRecomendado}</p>}
                {d.alongamento && <p className="detalhes-dia"><IconeAlongamento size={14} /> Alongamento: {d.alongamento}</p>}
                <button className="mini" onClick={() => comecarDia(d.id)}><IconeComecar size={13} /> Começar este treino</button>
              </div>
            ))}

          {plano.recomendacoesGerais && (
            <details className="sugestao">
              <summary><strong><IconeDica size={15} /> Recomendações gerais</strong></summary>
              <p>{plano.recomendacoesGerais}</p>
            </details>
          )}

          <div className="botoes">
            <button
              className="perigo"
              onClick={() => {
                if (confirm('Apagar este plano e gerar outro?')) {
                  atualizar((d) => ({ ...d, planosMusculacao: [] }));
                }
              }}
            >
              <IconeExcluir size={15} /> Apagar plano
            </button>
          </div>
        </div>
      )}
    </>
  );
}
