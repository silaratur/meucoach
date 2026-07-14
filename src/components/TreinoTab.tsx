import { useState } from 'react';
import type { DadosPerfil, Exercicio, Perfil, SessaoTreino, Treino } from '../types';
import { DIAS_SEMANA, HORARIOS_TREINO, LOCAIS, NIVEIS_EXPERIENCIA } from '../types';
import CorridaSection from './CorridaSection';
import { uid } from '../storage';
import { excluirMidias } from '../media';
import { linkVideoExercicio, grupoCorporal } from '../calc';
import { MediaGallery, MediaPicker } from './Midia';
import WorkoutPlayer from './WorkoutPlayer';
import VisaoSemana from './VisaoSemana';
import GeradorTreinoSection from './GeradorTreinoSection';
import {
  IconeAdicionar,
  IconeComecar,
  IconeEditar,
  IconeExcluir,
  IconeSalvar,
  IconeVideo,
  IconeMusculacao,
  IconeCorrida,
  IconeAvaliacao,
  IconeAquecimento,
  IconeDica,
  ICONE_LOCAL,
} from './Icones';
import { AlertTriangle, Repeat, Zap, MessageCircle, Link2 } from 'lucide-react';

interface Props {
  perfil: Perfil;
  dados: DadosPerfil;
  atualizar: (m: (d: DadosPerfil) => DadosPerfil) => void;
  aoAtualizarPerfil: (p: Perfil) => void;
}

// Card de avaliação do aluno — como um bom avaliador, o Coach pergunta antes de prescrever.
function AnamneseCard({ perfil, aoSalvar }: { perfil: Perfil; aoSalvar: (p: Perfil) => void }) {
  const incompleto = perfil.nivelExperiencia == null || perfil.restricoesSaude == null;
  const [aberto, setAberto] = useState(incompleto);
  const [nivel, setNivel] = useState(perfil.nivelExperiencia ?? 'iniciante');
  const [freq, setFreq] = useState(perfil.frequenciaSemana ?? 3);
  const [horario, setHorario] = useState(perfil.horarioTreino ?? 'noite');
  const [equip, setEquip] = useState(perfil.equipamentos ?? '');
  const [saude, setSaude] = useState(perfil.restricoesSaude ?? '');
  const [dias, setDias] = useState<string[]>(perfil.diasMusculacao ?? []);
  const [objSecundarios, setObjSecundarios] = useState(perfil.objetivosSecundarios ?? '');
  const [gosta, setGosta] = useState(perfil.preferenciasExercicios ?? '');
  const [evita, setEvita] = useState(perfil.exerciciosEvitar ?? '');
  const [cardio, setCardio] = useState(perfil.disponibilidadeCardio ?? '');

  function alternarDia(d: string) {
    setDias((atual) => (atual.includes(d) ? atual.filter((x) => x !== d) : [...atual, d]));
  }

  if (!aberto) {
    return (
      <div className="cartao anamnese-ok">
        <p>
          <IconeAvaliacao size={15} /> <strong>Avaliação:</strong> {NIVEIS_EXPERIENCIA.find((n) => n.value === perfil.nivelExperiencia)?.label},{' '}
          {perfil.diasMusculacao?.length
            ? perfil.diasMusculacao.map((d) => d.slice(0, 3)).join('/')
            : `${perfil.frequenciaSemana ?? '?'}x/semana`}
          , treina {HORARIOS_TREINO.find((h) => h.value === perfil.horarioTreino)?.label.toLowerCase()}
          {perfil.restricoesSaude ? <> · <AlertTriangle size={13} /> {perfil.restricoesSaude}</> : ' · sem restrições de saúde'}
          {'  '}
          <button className="mini" onClick={() => setAberto(true)}><IconeEditar size={13} /> Editar</button>
        </p>
      </div>
    );
  }

  return (
    <div className="cartao">
      <h2><IconeAvaliacao size={19} /> Avaliação do aluno</h2>
      <p className="meta-texto">
        Antes de montar seu treino, preciso te conhecer — como todo bom avaliador físico. Isso também ajusta suas
        refeições e suplementos.
      </p>

      <label>Sua experiência com musculação</label>
      <select value={nivel} onChange={(e) => setNivel(e.target.value as Perfil['nivelExperiencia'] & string)}>
        {NIVEIS_EXPERIENCIA.map((n) => (
          <option key={n.value} value={n.value}>{n.label}</option>
        ))}
      </select>

      <label>Quais os melhores dias para a musculação?</label>
      <div className="chips-tipo">
        {DIAS_SEMANA.map((d) => (
          <button key={d} type="button" className={`chip ${dias.includes(d) ? 'ativa' : ''}`} onClick={() => alternarDia(d)}>
            {d.slice(0, 3)}
          </button>
        ))}
      </div>

      <label>Em que horário costuma treinar?</label>
      <select value={horario} onChange={(e) => setHorario(e.target.value as Perfil['horarioTreino'] & string)}>
        {HORARIOS_TREINO.map((h) => (
          <option key={h.value} value={h.value}>{h.label}</option>
        ))}
      </select>

      <label>Equipamentos disponíveis / restrições da academia</label>
      <textarea
        value={equip}
        onChange={(e) => setEquip(e.target.value)}
        placeholder="Ex.: academia completa; ou: só halteres até 20 kg e não tem barra fixa"
      />

      <label>Restrições de saúde (lesões, condições médicas)</label>
      <textarea
        value={saude}
        onChange={(e) => setSaude(e.target.value)}
        placeholder="Ex.: hérnia de disco L4-L5, pressão alta controlada... (deixe em branco se não tiver)"
      />

      <label>Objetivos secundários</label>
      <input
        value={objSecundarios}
        onChange={(e) => setObjSecundarios(e.target.value)}
        placeholder="Ex.: melhorar postura, mais disposição no dia a dia"
      />

      <label>Exercícios que você gosta</label>
      <input
        value={gosta}
        onChange={(e) => setGosta(e.target.value)}
        placeholder="Ex.: supino, agachamento livre"
      />

      <label>Exercícios que evita ou não gosta</label>
      <input
        value={evita}
        onChange={(e) => setEvita(e.target.value)}
        placeholder="Ex.: burpee, corrida na esteira"
      />

      <label>Disponibilidade para cardio extra</label>
      <input
        value={cardio}
        onChange={(e) => setCardio(e.target.value)}
        placeholder="Ex.: 20 min depois do treino, 3x/semana — ou 'sem tempo agora'"
      />

      <button
        className="primario grande"
        onClick={() => {
          aoSalvar({
            ...perfil,
            nivelExperiencia: nivel as Perfil['nivelExperiencia'],
            frequenciaSemana: dias.length || freq,
            horarioTreino: horario as Perfil['horarioTreino'],
            equipamentos: equip,
            restricoesSaude: saude, // '' = avaliado, sem restrições
            diasMusculacao: dias,
            objetivosSecundarios: objSecundarios,
            preferenciasExercicios: gosta,
            exerciciosEvitar: evita,
            disponibilidadeCardio: cardio,
          });
          setFreq(dias.length || freq);
          setAberto(false);
        }}
      >
        <IconeSalvar size={16} /> Salvar avaliação
      </button>
    </div>
  );
}

export default function TreinoTab({ perfil, dados, atualizar, aoAtualizarPerfil }: Props) {
  const [modo, setModo] = useState<'musculacao' | 'corrida'>('musculacao');
  const [treinoAtivo, setTreinoAtivo] = useState<Treino | null>(null);
  const [atividadeLivre, setAtividadeLivre] = useState('');
  const [editando, setEditando] = useState<Treino | null>(null);

  // Treino sugerido para hoje: próximo dia não concluído do plano de musculação ativo.
  const planoAtivo = dados.planosMusculacao[0];
  const proximoDia = planoAtivo?.dias.find((d) => !planoAtivo.concluidos.includes(d.id));

  function iniciarTreinoSugerido() {
    if (!planoAtivo || !proximoDia) return;
    setTreinoAtivo({
      id: proximoDia.id,
      nome: `${proximoDia.objetivo} (semana ${proximoDia.semana})`,
      local: planoAtivo.local,
      aquecimento: proximoDia.aquecimento,
      aquecimentoMin: proximoDia.aquecimentoMin,
      dicas: [proximoDia.cardioRecomendado, proximoDia.alongamento ? `Alongamento: ${proximoDia.alongamento}` : '']
        .filter(Boolean)
        .join(' · '),
      exercicios: proximoDia.exercicios,
      criadoEm: planoAtivo.criadoEm,
    });
  }

  // Resumo de volume semanal (séries feitas por grupo corporal) — esta semana vs. semana anterior.
  function volumePorGrupo(inicioMs: number, fimMs: number) {
    const totais: Record<'superior' | 'inferior', number> = { superior: 0, inferior: 0 };
    for (const s of dados.sessoes) {
      const t = new Date(s.data).getTime();
      if (t < inicioMs || t >= fimMs) continue;
      for (const item of s.itens) {
        const grupo = grupoCorporal(item.nome);
        if (grupo === 'superior' || grupo === 'inferior') totais[grupo] += item.seriesFeitas.length;
      }
    }
    return totais;
  }
  const agoraMs = Date.now();
  const seteDiasMs = 7 * 24 * 60 * 60 * 1000;
  const volumeEstaSemana = volumePorGrupo(agoraMs - seteDiasMs, agoraMs);
  const volumeSemanaAnterior = volumePorGrupo(agoraMs - 2 * seteDiasMs, agoraMs - seteDiasMs);

  function registrarAtividadeLivre() {
    if (!atividadeLivre.trim()) return;
    const sessao: SessaoTreino = {
      id: uid(),
      nomeTreino: atividadeLivre.trim(),
      local: 'rua',
      data: new Date().toISOString(),
      itens: [],
      atividadeLivre: atividadeLivre.trim(),
    };
    atualizar((d) => ({ ...d, sessoes: [sessao, ...d.sessoes] }));
    setAtividadeLivre('');
  }

  function salvarSessao(sessao: SessaoTreino) {
    atualizar((d) => ({ ...d, sessoes: [sessao, ...d.sessoes] }));
    setTreinoAtivo(null);
  }

  if (treinoAtivo) {
    return (
      <WorkoutPlayer
        treino={treinoAtivo}
        perfil={perfil}
        sessoes={dados.sessoes}
        aoTerminar={salvarSessao}
        aoCancelar={() => setTreinoAtivo(null)}
      />
    );
  }

  if (editando) {
    return <EditorTreino treino={editando} aoSalvar={(t) => {
      atualizar((d) => ({
        ...d,
        treinos: d.treinos.some((x) => x.id === t.id) ? d.treinos.map((x) => (x.id === t.id ? t : x)) : [t, ...d.treinos],
      }));
      setEditando(null);
    }} aoCancelar={() => setEditando(null)} />;
  }

  return (
    <div>
      <VisaoSemana perfil={perfil} dados={dados} aoComecarDia={setTreinoAtivo} />

      <div className="chips-tipo modo-treino">
        <button className={`chip ${modo === 'musculacao' ? 'ativa' : ''}`} onClick={() => setModo('musculacao')}>
          <IconeMusculacao size={15} /> Musculação
        </button>
        <button className={`chip ${modo === 'corrida' ? 'ativa' : ''}`} onClick={() => setModo('corrida')}>
          <IconeCorrida size={15} /> Corrida
        </button>
      </div>

      {modo === 'corrida' ? (
        <CorridaSection perfil={perfil} dados={dados} atualizar={atualizar} aoAtualizarPerfil={aoAtualizarPerfil} />
      ) : (
        <>
      <AnamneseCard perfil={perfil} aoSalvar={aoAtualizarPerfil} />

      {proximoDia && planoAtivo && (
        <div className="cartao">
          <h2><Zap size={19} /> Treino Sugerido para Hoje</h2>
          <p className="objetivo-sugerido">
            <strong>{proximoDia.objetivo}</strong> · {proximoDia.gruposMusculares} · ~{proximoDia.tempoEstimadoMin} min
          </p>
          <ol className="lista-compacta-exercicios">
            {proximoDia.exercicios.slice(0, 5).map((e) => (
              <li key={e.id}>{e.nome} — {e.series}x{e.repeticoes}</li>
            ))}
          </ol>
          <button className="primario grande" onClick={iniciarTreinoSugerido}><IconeComecar size={17} /> Iniciar Treino</button>
        </div>
      )}

      {(volumeEstaSemana.superior > 0 || volumeEstaSemana.inferior > 0 || volumeSemanaAnterior.superior > 0 || volumeSemanaAnterior.inferior > 0) && (
        <div className="cartao">
          <h2><IconeMusculacao size={19} /> Resumo de Volume Semanal</h2>
          <div className="comparativos-bioimpedancia">
            <div className="comparativo-metrica">
              <small>Inferiores</small>
              <strong>{volumeEstaSemana.inferior} séries</strong>
              <div className="comparativo-barras">
                <div className="comparativo-col">
                  <span className="comparativo-valor">{volumeEstaSemana.inferior}</span>
                  <div
                    className="comparativo-barra"
                    style={{ height: `${(volumeEstaSemana.inferior / Math.max(1, volumeEstaSemana.inferior, volumeSemanaAnterior.inferior)) * 100}%`, background: '#f59e0b' }}
                  />
                  <small>Esta semana</small>
                </div>
                <div className="comparativo-col">
                  <span className="comparativo-valor">{volumeSemanaAnterior.inferior}</span>
                  <div
                    className="comparativo-barra anterior"
                    style={{ height: `${(volumeSemanaAnterior.inferior / Math.max(1, volumeEstaSemana.inferior, volumeSemanaAnterior.inferior)) * 100}%` }}
                  />
                  <small>Anterior</small>
                </div>
              </div>
            </div>
            <div className="comparativo-metrica">
              <small>Superiores</small>
              <strong>{volumeEstaSemana.superior} séries</strong>
              <div className="comparativo-barras">
                <div className="comparativo-col">
                  <span className="comparativo-valor">{volumeEstaSemana.superior}</span>
                  <div
                    className="comparativo-barra"
                    style={{ height: `${(volumeEstaSemana.superior / Math.max(1, volumeEstaSemana.superior, volumeSemanaAnterior.superior)) * 100}%`, background: 'var(--verde)' }}
                  />
                  <small>Esta semana</small>
                </div>
                <div className="comparativo-col">
                  <span className="comparativo-valor">{volumeSemanaAnterior.superior}</span>
                  <div
                    className="comparativo-barra anterior"
                    style={{ height: `${(volumeSemanaAnterior.superior / Math.max(1, volumeEstaSemana.superior, volumeSemanaAnterior.superior)) * 100}%` }}
                  />
                  <small>Anterior</small>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {dados.treinos.length > 0 && (
        <button className="primario grande botao-repetir" onClick={() => setTreinoAtivo(dados.treinos[0])}>
          <Repeat size={17} /> Repetir último treino ({dados.treinos[0].nome})
        </button>
      )}

      <GeradorTreinoSection
        perfil={perfil}
        dados={dados}
        atualizar={atualizar}
        aoComecarDia={setTreinoAtivo}
        aoMontarManualmente={() => setEditando({ id: uid(), nome: 'Meu treino', local: 'academia', exercicios: [], criadoEm: new Date().toISOString() })}
      />

      <div className="cartao">
        <h2><IconeCorrida size={19} /> Atividade livre</h2>
        <label>Fez caminhada, corrida, bike, futebol? Registre aqui:</label>
        <div className="linha-add">
          <input
            value={atividadeLivre}
            onChange={(e) => setAtividadeLivre(e.target.value)}
            placeholder="Ex.: caminhada de 40 minutos no parque"
          />
          <button className="primario" onClick={registrarAtividadeLivre}><IconeAdicionar size={17} /></button>
        </div>
      </div>

      <div className="cartao">
        <h2>Meus treinos</h2>
        {dados.treinos.length === 0 && (
          <div className="estado-vazio">
            <span className="icone-vazio"><Zap size={22} /></span>
            <p>Nenhum treino ainda. Gere um com o Coach acima!</p>
          </div>
        )}
        {dados.treinos.map((t) => (
          <details key={t.id} className="sugestao">
            <summary>
              <strong>{(() => { const Icone = ICONE_LOCAL[t.local]; return <Icone size={15} />; })()} {t.nome}</strong>
              <small> {t.exercicios.length} exercícios</small>
            </summary>
            {t.aquecimento && (
              <p><IconeAquecimento size={14} /> <strong>Aquecimento{t.aquecimentoMin ? ` (${t.aquecimentoMin} min)` : ''}:</strong> {t.aquecimento}</p>
            )}
            <ol>
              {t.exercicios.map((e) => {
                const grupo = e.grupoId ? t.exercicios.filter((x) => x.grupoId === e.grupoId) : null;
                const posicaoNoGrupo = grupo ? grupo.findIndex((x) => x.id === e.id) + 1 : 0;
                return (
                  <li key={e.id}>
                    {grupo && grupo.length > 1 && (
                      <span className="badge-superset">
                        {grupo.length === 3 ? 'Tri-set' : 'Bi-set'} {posicaoNoGrupo}/{grupo.length}
                      </span>
                    )}
                    <strong>{e.nome}</strong> — {e.series}x{e.repeticoes}
                    {e.cargaSugerida ? ` · ${e.cargaSugerida}` : ''}
                    {' · '}
                    {grupo && grupo.length > 1 && posicaoNoGrupo < grupo.length
                      ? 'sem descanso (próximo do grupo)'
                      : `descanso ${e.descansoSeg}s`}
                    {e.dicaRapida && <><br /><em><MessageCircle size={13} /> "{e.dicaRapida}"</em></>}
                    {e.instrucoes && <><br /><small>{e.instrucoes}</small></>}
                    <br />
                    <a className="link-video" href={linkVideoExercicio(e.nome)} target="_blank" rel="noreferrer">
                      <IconeVideo size={14} /> Ver demonstração em vídeo
                    </a>
                    <MediaGallery midias={e.midias} />
                  </li>
                );
              })}
            </ol>
            {t.dicas && <p><IconeDica size={14} /> {t.dicas}</p>}
            <div className="botoes">
              <button className="primario" onClick={() => setTreinoAtivo(t)}><IconeComecar size={16} /> Começar treino</button>
              <button onClick={() => setEditando(t)}><IconeEditar size={14} /> Editar</button>
              <button
                className="perigo"
                onClick={() => {
                  if (confirm(`Excluir o treino "${t.nome}"?`)) {
                    t.exercicios.forEach((e) => excluirMidias(e.midias));
                    atualizar((d) => ({ ...d, treinos: d.treinos.filter((x) => x.id !== t.id) }));
                  }
                }}
              >
                <IconeExcluir size={15} />
              </button>
            </div>
          </details>
        ))}
      </div>

      <div className="cartao">
        <h2>Histórico</h2>
        {dados.sessoes.length === 0 && (
          <div className="estado-vazio">
            <span className="icone-vazio"><IconeAvaliacao size={22} /></span>
            <p>Nenhuma sessão registrada ainda.</p>
          </div>
        )}
        {dados.sessoes.slice(0, 15).map((s) => (
          <div key={s.id} className="registro">
            <span>
              {new Date(s.data).toLocaleDateString('pt-BR')} — <strong>{s.nomeTreino}</strong>
              {s.duracaoMin ? ` (${s.duracaoMin} min)` : ''}
              {s.itens.length > 0 && ` · ${s.itens.length} exercícios`}
              {s.rpe != null && <span className="tag-rpe"> · RPE {s.rpe}/10</span>}
            </span>
          </div>
        ))}
      </div>
        </>
      )}
    </div>
  );
}

// ---------- Editor manual de treino ----------

// true se o exercício i está unido ao i+1 (mesmo grupo, formando bi-set/tri-set)
function ligadoComProximo(exs: Exercicio[], i: number): boolean {
  const a = exs[i]?.grupoId;
  const b = exs[i + 1]?.grupoId;
  return !!a && a === b;
}

// Recalcula os grupoId de toda a lista a partir de um array de "ligações" (tamanho n-1).
function recalcularGrupos(exs: Exercicio[], ligacoes: boolean[]): Exercicio[] {
  const grupoIds: (string | undefined)[] = new Array(exs.length).fill(undefined);
  let i = 0;
  while (i < exs.length) {
    let tamanho = 1;
    while (i + tamanho - 1 < ligacoes.length && ligacoes[i + tamanho - 1] && tamanho < 3) tamanho++;
    if (tamanho > 1) {
      const gid = uid();
      for (let k = 0; k < tamanho; k++) grupoIds[i + k] = gid;
    }
    i += tamanho;
  }
  return exs.map((e, idx) => ({ ...e, grupoId: grupoIds[idx] }));
}

function EditorTreino({ treino, aoSalvar, aoCancelar }: { treino: Treino; aoSalvar: (t: Treino) => void; aoCancelar: () => void }) {
  const [t, setT] = useState<Treino>(treino);
  // Texto do campo separado do número salvo: permite apagar tudo e digitar de novo sem o
  // campo saltar pra 0 a cada tecla — o valor só é aplicado ao perder o foco.
  const [aquecimentoTexto, setAquecimentoTexto] = useState(String(treino.aquecimentoMin ?? ''));

  function setEx(i: number, campo: keyof Exercicio, valor: string | number) {
    const ex = [...t.exercicios];
    ex[i] = { ...ex[i], [campo]: valor };
    setT({ ...t, exercicios: ex });
  }

  function alternarLigacao(i: number) {
    setT((atual) => {
      const exs = atual.exercicios;
      const ligacoes = exs.slice(0, -1).map((_, idx) => ligadoComProximo(exs, idx));
      const novoValor = !ligacoes[i];
      if (novoValor) {
        // conta o tamanho que a cadeia teria incluindo i e i+1, para não passar de 3 (tri-set)
        let tamanho = 2;
        let a = i - 1;
        while (a >= 0 && ligacoes[a]) {
          tamanho++;
          a--;
        }
        let b = i + 1;
        while (b < ligacoes.length && ligacoes[b]) {
          tamanho++;
          b++;
        }
        if (tamanho > 3) {
          alert('Um bi-set/tri-set pode ter no máximo 3 exercícios.');
          return atual;
        }
      }
      ligacoes[i] = novoValor;
      return { ...atual, exercicios: recalcularGrupos(exs, ligacoes) };
    });
  }

  return (
    <div className="cartao">
      <h2><IconeEditar size={19} /> Editar treino</h2>
      <label>Nome do treino</label>
      <input value={t.nome} onChange={(e) => setT({ ...t, nome: e.target.value })} />
      <label>Local</label>
      <div className="chips-tipo">
        {LOCAIS.map((l) => {
          const Icone = ICONE_LOCAL[l.value];
          return (
            <button key={l.value} className={`chip ${t.local === l.value ? 'ativa' : ''}`} onClick={() => setT({ ...t, local: l.value })}>
              <Icone size={15} /> {l.label}
            </button>
          );
        })}
      </div>

      <div className="linha">
        <div>
          <label>Aquecimento (minutos)</label>
          <input
            type="number"
            min={0}
            value={aquecimentoTexto}
            onChange={(e) => setAquecimentoTexto(e.target.value)}
            onBlur={() => {
              const n = parseInt(aquecimentoTexto, 10);
              const valido = Number.isFinite(n) && n >= 0 ? n : undefined;
              setT({ ...t, aquecimentoMin: valido });
              setAquecimentoTexto(valido != null ? String(valido) : '');
            }}
          />
        </div>
        <div>
          <label>Descrição do aquecimento</label>
          <input
            value={t.aquecimento ?? ''}
            onChange={(e) => setT({ ...t, aquecimento: e.target.value || undefined })}
            placeholder="Ex.: 5 min esteira + mobilidade de ombros"
          />
        </div>
      </div>

      {t.exercicios.map((e, i) => {
        const ligado = ligadoComProximo(t.exercicios, i);
        return (
          <div key={e.id}>
            <div className="editor-exercicio">
              {e.grupoId && <span className="badge-superset"><Link2 size={12} /> Superset</span>}
              <div className="linha-add">
                <input value={e.nome} onChange={(ev) => setEx(i, 'nome', ev.target.value)} placeholder="Nome do exercício" />
                <button className="mini" onClick={() => setT({ ...t, exercicios: t.exercicios.filter((x) => x.id !== e.id) })}>✕</button>
              </div>
              <div className="linha">
                <div>
                  <label>Séries</label>
                  <input type="number" value={e.series} onChange={(ev) => setEx(i, 'series', +ev.target.value || 1)} />
                </div>
                <div>
                  <label>Repetições</label>
                  <input value={e.repeticoes} onChange={(ev) => setEx(i, 'repeticoes', ev.target.value)} placeholder="8-12" />
                </div>
                <div>
                  <label>{ligado ? 'Descanso após o grupo (s)' : 'Descanso (s)'}</label>
                  <input type="number" value={e.descansoSeg} onChange={(ev) => setEx(i, 'descansoSeg', +ev.target.value || 60)} />
                </div>
              </div>
              <div className="linha">
                <div>
                  <label>Cadência (segundos por repetição)</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={e.cadenciaSeg ?? 3}
                    onChange={(ev) => setEx(i, 'cadenciaSeg', +ev.target.value || 3)}
                  />
                </div>
                <div>
                  <label>Dica rápida (falada durante a série)</label>
                  <input
                    value={e.dicaRapida ?? ''}
                    onChange={(ev) => setEx(i, 'dicaRapida', ev.target.value)}
                    placeholder="Ex.: Cotovelos fixos"
                  />
                </div>
              </div>
              <label>Material de apoio (como executar)</label>
              <MediaPicker
                aoAdicionar={(ref) =>
                  setT((atual) => {
                    const ex = [...atual.exercicios];
                    ex[i] = { ...ex[i], midias: [...(ex[i].midias ?? []), ref] };
                    return { ...atual, exercicios: ex };
                  })
                }
              />
              <MediaGallery
                midias={e.midias}
                aoRemover={(ref) => {
                  excluirMidias([ref]);
                  setT((atual) => {
                    const ex = [...atual.exercicios];
                    ex[i] = { ...ex[i], midias: (ex[i].midias ?? []).filter((m) => m.id !== ref.id) };
                    return { ...atual, exercicios: ex };
                  });
                }}
              />
            </div>
            {i < t.exercicios.length - 1 && (
              <button className="mini botao-ligar" onClick={() => alternarLigacao(i)}>
                {ligado ? '✓ Unido ao próximo (bi/tri-set) — desfazer' : <><Link2 size={13} /> Unir com o próximo (bi-set/tri-set)</>}
              </button>
            )}
          </div>
        );
      })}

      <div className="botoes">
        <button
          onClick={() =>
            setT({
              ...t,
              exercicios: [...t.exercicios, { id: uid(), nome: '', series: 3, repeticoes: '10-12', descansoSeg: 90, cadenciaSeg: 3 }],
            })
          }
        >
          <IconeAdicionar size={15} /> Exercício
        </button>
        <button className="primario" onClick={() => t.nome.trim() && aoSalvar(t)}><IconeSalvar size={16} /> Salvar</button>
        <button onClick={aoCancelar}>Cancelar</button>
      </div>
    </div>
  );
}
