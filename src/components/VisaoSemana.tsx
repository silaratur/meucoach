import { useState } from 'react';
import type { DadosPerfil, Perfil, Treino } from '../types';
import { DIAS_SEMANA } from '../types';
import { dataLocalDe } from '../calc';
import { IconeComecar, IconeConcluido, IconeMusculacao, IconeCorrida, IconeSono } from './Icones';
import { CalendarDays } from 'lucide-react';

function formatarDataLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function segundaDaSemana(): Date {
  const hoje = new Date();
  const diaSemana = hoje.getDay(); // 0=domingo .. 6=sábado
  const deslocamento = diaSemana === 0 ? -6 : 1 - diaSemana;
  const seg = new Date(hoje);
  seg.setDate(hoje.getDate() + deslocamento);
  seg.setHours(0, 0, 0, 0);
  return seg;
}

// Quantas semanas se passaram entre a criação do plano e a data alvo — usado pra achar
// a "semana N" certa do plano ativo, já que a Visão da Semana só mostra a semana atual.
function semanaDoPlano(criadoEmISO: string, alvo: Date): number {
  const inicio = new Date(criadoEmISO);
  inicio.setHours(0, 0, 0, 0);
  const diffDias = Math.floor((alvo.getTime() - inicio.getTime()) / (24 * 60 * 60 * 1000));
  return Math.floor(diffDias / 7) + 1;
}

interface Props {
  perfil: Perfil;
  dados: DadosPerfil;
  aoComecarDia?: (treino: Treino) => void;
}

// Visão da semana: o que está planejado (musculação/corrida) vs. o que já foi feito.
// Clicável — mostra o resultado de dias passados e o treino previsto para dias futuros.
export default function VisaoSemana({ perfil, dados, aoComecarDia }: Props) {
  const inicio = segundaDaSemana();
  const hojeChave = formatarDataLocal(new Date());
  const [selecionado, setSelecionado] = useState(hojeChave);

  const dias = DIAS_SEMANA.map((nomeDia, i) => {
    const data = new Date(inicio);
    data.setDate(inicio.getDate() + i);
    const chave = formatarDataLocal(data);
    const planejadoMusculacao = perfil.diasMusculacao?.includes(nomeDia) ?? false;
    const planejadoCorrida = perfil.diasCorrida?.includes(nomeDia) ?? false;
    const sessoesDoDia = dados.sessoes.filter((s) => dataLocalDe(s.data) === chave);
    const feitoMusculacao = sessoesDoDia.some((s) => !s.corrida);
    const feitoCorrida = sessoesDoDia.some((s) => !!s.corrida);
    return {
      nomeDia,
      data,
      chave,
      diaMes: data.getDate(),
      ehHoje: chave === hojeChave,
      planejadoMusculacao,
      planejadoCorrida,
      feitoMusculacao,
      feitoCorrida,
      sessoesDoDia,
    };
  });

  const semNadaPlanejado = !perfil.diasMusculacao?.length && !perfil.diasCorrida?.length;
  if (semNadaPlanejado) return null;

  const diaSel = dias.find((d) => d.chave === selecionado) ?? dias.find((d) => d.ehHoje)!;

  const planoMusc = dados.planosMusculacao[0];
  const diaPlanoMusc =
    planoMusc && diaSel.planejadoMusculacao
      ? planoMusc.dias.find((d) => d.semana === semanaDoPlano(planoMusc.criadoEm, diaSel.data) && d.dia === diaSel.nomeDia)
      : undefined;

  const planoCorrida = dados.planosCorrida[0];
  const diaPlanoCorrida =
    planoCorrida && diaSel.planejadoCorrida
      ? planoCorrida.dias.find((d) => d.semana === semanaDoPlano(planoCorrida.criadoEm, diaSel.data) && d.dia === diaSel.nomeDia)
      : undefined;

  function comecarDiaPlano() {
    if (!diaPlanoMusc || !planoMusc || !aoComecarDia) return;
    const treino: Treino = {
      id: diaPlanoMusc.id,
      nome: `${diaPlanoMusc.objetivo} (semana ${diaPlanoMusc.semana})`,
      local: planoMusc.local,
      aquecimento: diaPlanoMusc.aquecimento,
      aquecimentoMin: diaPlanoMusc.aquecimentoMin,
      dicas: [diaPlanoMusc.cardioRecomendado, diaPlanoMusc.alongamento ? `Alongamento: ${diaPlanoMusc.alongamento}` : '']
        .filter(Boolean)
        .join(' · '),
      exercicios: diaPlanoMusc.exercicios,
      criadoEm: planoMusc.criadoEm,
    };
    aoComecarDia(treino);
  }

  return (
    <div className="cartao">
      <h2><CalendarDays size={19} /> Sua semana</h2>
      <div className="visao-semana">
        {dias.map((d) => (
          <button
            key={d.nomeDia}
            className={`dia-semana-item ${d.ehHoje ? 'hoje' : ''} ${selecionado === d.chave ? 'selecionado' : ''}`}
            onClick={() => setSelecionado(d.chave)}
          >
            <small>{d.nomeDia.slice(0, 3)}</small>
            <strong>{d.diaMes}</strong>
            <div className="icones-dia">
              {d.planejadoMusculacao && <span className={d.feitoMusculacao ? 'feito' : 'pendente'}><IconeMusculacao size={13} /></span>}
              {d.planejadoCorrida && <span className={d.feitoCorrida ? 'feito' : 'pendente'}><IconeCorrida size={13} /></span>}
              {!d.planejadoMusculacao && !d.planejadoCorrida && <span className="descanso"><IconeSono size={13} /></span>}
            </div>
          </button>
        ))}
      </div>

      <div className="detalhe-dia-semana">
        {diaSel.sessoesDoDia.length > 0 ? (
          diaSel.sessoesDoDia.map((s) => (
            <p key={s.id} className="detalhes-dia">
              <IconeConcluido size={14} /> <strong>{s.nomeTreino}</strong>
              {s.duracaoMin ? ` · ${s.duracaoMin} min` : ''}
              {s.itens.length > 0 ? ` · ${s.itens.length} exercícios` : ''}
              {s.corrida ? ` · ${s.corrida.distanciaKm} km` : ''}
              {s.rpe != null ? ` · RPE ${s.rpe}/10` : ''}
            </p>
          ))
        ) : diaPlanoMusc ? (
          <>
            <p className="detalhes-dia">
              <IconeMusculacao size={14} /> <strong>{diaPlanoMusc.objetivo}</strong> · {diaPlanoMusc.gruposMusculares} · {diaPlanoMusc.exercicios.length}{' '}
              exercícios · ~{diaPlanoMusc.tempoEstimadoMin} min
            </p>
            {aoComecarDia && <button className="mini" onClick={comecarDiaPlano}><IconeComecar size={13} /> Começar este treino</button>}
          </>
        ) : diaPlanoCorrida ? (
          <p className="detalhes-dia">
            <IconeCorrida size={14} /> <strong>{diaPlanoCorrida.titulo}</strong> · {diaPlanoCorrida.tipo}
            {diaPlanoCorrida.distanciaKm ? ` · ${diaPlanoCorrida.distanciaKm} km` : ''}
          </p>
        ) : (
          <p className="meta-texto">
            {diaSel.planejadoMusculacao || diaSel.planejadoCorrida
              ? 'Nenhum treino específico previsto para este dia ainda.'
              : 'Dia de descanso.'}
          </p>
        )}
      </div>
    </div>
  );
}
