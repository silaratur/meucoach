import { useState } from 'react';
import type { DadosPerfil, Perfil, PlanoCorrida, SessaoTreino } from '../types';
import { DIAS_SEMANA } from '../types';
import { uid } from '../storage';
import { gerarPlanoCorrida } from '../api';
import RunPlayer from './RunPlayer';
import { IconeComecar, IconeExcluir, IconeCorrida, IconeAvaliacao, IconeMusculacao, IconeCoach, IconeDica } from './Icones';
import { Zap, CalendarDays } from 'lucide-react';

interface Props {
  perfil: Perfil;
  dados: DadosPerfil;
  atualizar: (m: (d: DadosPerfil) => DadosPerfil) => void;
  aoAtualizarPerfil: (p: Perfil) => void;
}

export default function CorridaSection({ perfil, dados, atualizar, aoAtualizarPerfil }: Props) {
  const [correndo, setCorrendo] = useState<string | null>(null); // título do treino em execução
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState('');
  // avaliação do corredor
  const [nivel, setNivel] = useState('iniciante — corro de vez em quando');
  const [objetivo, setObjetivo] = useState('completar 5 km');
  const [diasCorrida, setDiasCorrida] = useState<string[]>(perfil.diasCorrida ?? []);
  const [capacidade, setCapacidade] = useState('');
  const [obs, setObs] = useState('');

  const plano = dados.planosCorrida[0] ?? null;

  function alternarDia(d: string) {
    setDiasCorrida((atual) => (atual.includes(d) ? atual.filter((x) => x !== d) : [...atual, d]));
  }

  async function gerar() {
    if (!diasCorrida.length) {
      setErro('Escolha pelo menos um dia da semana para correr.');
      return;
    }
    setGerando(true);
    setErro('');
    try {
      // guarda os dias escolhidos no perfil — o gerador de musculação também os usa
      aoAtualizarPerfil({ ...perfil, diasCorrida });
      const corridasRecentes = dados.sessoes
        .filter((s) => s.corrida)
        .slice(0, 10)
        .map((s) => ({ data: s.data.slice(0, 10), ...s.corrida }));
      // plano integrado: o treinador de corrida conhece a musculação do aluno
      const sessoesMusculacao = dados.sessoes
        .filter((s) => !s.corrida)
        .slice(0, 6)
        .map((s) => ({ data: s.data.slice(0, 10), nome: s.nomeTreino }));
      const musculacao = {
        fazMusculacao: dados.treinos.length > 0 || sessoesMusculacao.length > 0,
        diasPreferidos: perfil.diasMusculacao ?? [],
        treinosAtuais: dados.treinos.slice(0, 4).map((t) => ({
          nome: t.nome,
          exercicios: t.exercicios.map((e) => e.nome),
        })),
        sessoesRecentes: sessoesMusculacao,
      };
      const p = await gerarPlanoCorrida(
        perfil,
        { nivelCorrida: nivel, objetivoCorrida: objetivo, diasCorrida, capacidadeAtual: capacidade, observacoes: obs },
        corridasRecentes,
        musculacao,
      );
      const novo: PlanoCorrida = {
        id: uid(),
        criadoEm: new Date().toISOString(),
        nome: p.nome,
        objetivo: p.objetivo,
        dicas: p.dicas,
        dias: p.dias.map((d) => ({ ...d, id: uid() })),
        concluidos: [],
      };
      atualizar((d) => ({ ...d, planosCorrida: [novo] })); // um plano ativo por vez
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
      planosCorrida: d.planosCorrida.map((p) =>
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

  function salvarCorrida(sessao: SessaoTreino) {
    atualizar((d) => ({ ...d, sessoes: [sessao, ...d.sessoes] }));
    setCorrendo(null);
  }

  if (correndo !== null) {
    return (
      <RunPlayer
        perfil={perfil}
        tituloTreino={correndo || undefined}
        aoTerminar={salvarCorrida}
        aoCancelar={() => setCorrendo(null)}
      />
    );
  }

  const semanas = plano ? [...new Set(plano.dias.map((d) => d.semana))].sort((a, b) => a - b) : [];
  const feitos = plano?.concluidos.length ?? 0;

  return (
    <div>
      <div className="cartao">
        <h2><IconeCorrida size={19} /> Correr agora</h2>
        <p className="meta-texto">GPS + coach por voz: distância, ritmo e incentivo a cada 500 metros.</p>
        <button className="primario grande" onClick={() => setCorrendo('')}><IconeComecar size={17} /> Iniciar corrida livre</button>
      </div>

      {!plano && (
        <div className="cartao">
          <h2><IconeAvaliacao size={19} /> Avaliação do corredor</h2>
          <p className="meta-texto">Me conta sobre você e eu monto um plano dia a dia, como um assessor esportivo.</p>

          <label>Seu nível na corrida</label>
          <select value={nivel} onChange={(e) => setNivel(e.target.value)}>
            <option value="nunca corri, começando do zero">Nunca corri — começando do zero</option>
            <option value="iniciante — corro de vez em quando">Iniciante — corro de vez em quando</option>
            <option value="regular — corro toda semana">Regular — corro toda semana</option>
            <option value="experiente — já fiz provas">Experiente — já fiz provas</option>
          </select>

          <label>Objetivo</label>
          <select value={objetivo} onChange={(e) => setObjetivo(e.target.value)}>
            <option value="começar a correr com saúde">Começar a correr com saúde</option>
            <option value="completar 5 km">Completar 5 km</option>
            <option value="completar 10 km">Completar 10 km</option>
            <option value="completar 21 km (meia maratona)">Meia maratona (21 km)</option>
            <option value="completar 42 km (maratona)">Maratona (42 km)</option>
            <option value="emagrecer correndo">Emagrecer correndo</option>
            <option value="melhorar meu ritmo/velocidade">Melhorar ritmo / velocidade</option>
          </select>

          <label>Quais os melhores dias para correr?</label>
          <div className="chips-tipo">
            {DIAS_SEMANA.map((d) => (
              <button key={d} type="button" className={`chip ${diasCorrida.includes(d) ? 'ativa' : ''}`} onClick={() => alternarDia(d)}>
                {d.slice(0, 3)}
              </button>
            ))}
          </div>
          {perfil.diasMusculacao?.length ? (
            <p className="meta-texto">
              <IconeMusculacao size={14} /> Musculação: {perfil.diasMusculacao.map((d) => d.slice(0, 3)).join('/')} — vou montar a corrida se
              encaixando nesses dias, como um plano só.
            </p>
          ) : null}

          <label>Hoje consigo correr...</label>
          <input value={capacidade} onChange={(e) => setCapacidade(e.target.value)} placeholder="Ex.: 2 km sem parar" />

          <label>Observações (dores, esteira ou rua, provas marcadas...)</label>
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: tenho uma prova de 5k em setembro; prefiro correr de manhã" />

          <button className="primario grande" onClick={gerar} disabled={gerando}>
            {gerando ? <><IconeCoach size={17} /> Montando seu plano...</> : <><Zap size={17} /> Gerar meu plano de corrida</>}
          </button>
          {erro && <p className="erro">{erro}</p>}
        </div>
      )}

      {plano && (
        <div className="cartao">
          <h2><CalendarDays size={19} /> {plano.nome}</h2>
          <p className="meta-texto">
            {plano.objetivo} · <strong>{feitos}/{plano.dias.length}</strong> treinos concluídos
          </p>
          <div className="barra-meta">
            <div className="barra-meta-cheia" style={{ width: `${plano.dias.length ? Math.round((feitos / plano.dias.length) * 100) : 0}%` }} />
          </div>

          {semanas.map((sem) => (
            <details key={sem} className="sugestao" open={sem === semanas.find((s) => plano.dias.some((d) => d.semana === s && !plano.concluidos.includes(d.id)))}>
              <summary>
                <strong>Semana {sem}</strong>
                <small>
                  {' '}{plano.dias.filter((d) => d.semana === sem && plano.concluidos.includes(d.id)).length}/
                  {plano.dias.filter((d) => d.semana === sem).length} feitos
                </small>
              </summary>
              {plano.dias
                .filter((d) => d.semana === sem)
                .map((d) => (
                  <div key={d.id} className={`dia-corrida ${plano.concluidos.includes(d.id) ? 'feito' : ''}`}>
                    <label className="dia-check">
                      <input
                        type="checkbox"
                        checked={plano.concluidos.includes(d.id)}
                        onChange={() => alternarConcluido(d.id)}
                      />
                      <span>
                        <strong>{d.dia} — {d.titulo}</strong>
                        <small>
                          {d.tipo}
                          {d.distanciaKm ? ` · ${d.distanciaKm} km` : ''}
                          {d.duracaoMin ? ` · ~${d.duracaoMin} min` : ''}
                        </small>
                      </span>
                    </label>
                    <p className="detalhes-dia">{d.detalhes}</p>
                    {!/descanso/i.test(d.tipo) && (
                      <button className="mini" onClick={() => setCorrendo(`${d.titulo} (semana ${sem})`)}>
                        <IconeComecar size={14} /> Correr este treino
                      </button>
                    )}
                  </div>
                ))}
            </details>
          ))}

          {plano.dicas && <p><IconeDica size={14} /> {plano.dicas}</p>}
          <div className="botoes">
            <button
              className="perigo"
              onClick={() => {
                if (confirm('Apagar este plano e criar outro?'))
                  atualizar((d) => ({ ...d, planosCorrida: [] }));
              }}
            >
              <IconeExcluir size={15} /> Apagar plano
            </button>
          </div>
        </div>
      )}

      <div className="cartao">
        <h2>Minhas corridas</h2>
        {dados.sessoes.filter((s) => s.corrida).length === 0 && (
          <div className="estado-vazio">
            <span className="icone-vazio"><IconeCorrida size={22} /></span>
            <p>Nenhuma corrida registrada ainda. Bora estrear o GPS?</p>
          </div>
        )}
        {dados.sessoes
          .filter((s) => s.corrida)
          .slice(0, 10)
          .map((s) => (
            <div key={s.id} className="registro">
              <span>
                {new Date(s.data).toLocaleDateString('pt-BR')} — <strong>{s.corrida!.distanciaKm} km</strong> em{' '}
                {s.corrida!.duracaoMin} min
                {s.corrida!.ritmoMinKm ? ` · ${Math.floor(s.corrida!.ritmoMinKm)}:${String(Math.round((s.corrida!.ritmoMinKm % 1) * 60)).padStart(2, '0')}/km` : ''}
                {s.corrida!.velocidadeKmH ? ` · ${s.corrida!.velocidadeKmH.toFixed(1)} km/h` : ''}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
