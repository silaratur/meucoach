import { useEffect, useMemo, useRef, useState } from 'react';
import type { Exercicio, ItemSessao, Perfil, SessaoTreino, Treino } from '../types';
import { cargaRecomendada, uid } from '../storage';
import {
  bip,
  definirVozHabilitada,
  falar,
  incentivoAleatorio,
  incentivoCurto,
  ouvirResposta,
  repeticoesEmFala,
  silenciar,
  vozDisponivel,
} from '../speech';
import { iconeEquipamento, linkVideoExercicio, maiorCargaHistorica, ultimasSeriesDoExercicio } from '../calc';
import { trocarExercicio } from '../api';
import { urlImagemExercicio } from '../media';
import { MediaGallery } from './Midia';
import {
  IconeComecar,
  IconeConcluido,
  IconeHistorico,
  IconeImagemIndisponivel,
  IconeMicrofone,
  IconeParar,
  IconePular,
  IconeSalvar,
  IconeTrocar,
  IconeVideo,
} from './Icones';

// Imagem ilustrativa gerada por IA (cacheada por nome no servidor) — clicável, abre o vídeo
// de demonstração. Proporção fixa 4:3 evita "salto" de layout enquanto carrega.
function ImagemExercicio({ nome, hrefVideo }: { nome: string; hrefVideo: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setUrl(null);
    urlImagemExercicio(nome).then((u) => {
      if (!cancelado) {
        setUrl(u);
        setCarregando(false);
      }
    });
    return () => {
      cancelado = true;
    };
  }, [nome]);

  if (carregando) return <div className="imagem-exercicio imagem-exercicio-vazia"><IconeImagemIndisponivel size={22} /> Gerando ilustração...</div>;
  if (!url) return null;
  return (
    <a className="imagem-exercicio" href={hrefVideo} target="_blank" rel="noreferrer">
      <img src={url} alt={`Demonstração: ${nome}`} loading="lazy" />
    </a>
  );
}

interface Props {
  treino: Treino;
  perfil: Perfil;
  sessoes: SessaoTreino[];
  aoTerminar: (s: SessaoTreino) => void;
  aoCancelar: () => void;
}

type Fase = 'pronto' | 'aquecimento' | 'exercicio' | 'descanso' | 'fim';

interface Bloco {
  exercicios: Exercicio[]; // 1 = exercício solo · 2/3 = bi-set/tri-set (mesmo grupoId)
}

function rodadasDoBloco(bloco: Bloco): number {
  return Math.max(...bloco.exercicios.map((e) => e.series));
}

// Extrai o alvo de repetições: "8-12" → 12 · "15" → 15 · "30s" → 30 segundos
function alvoDe(repeticoes: string): { alvo: number; emSegundos: boolean } {
  const numeros = repeticoes.match(/\d+/g)?.map(Number) ?? [];
  const alvo = numeros.length ? Math.min(60, Math.max(...numeros)) : 10;
  return { alvo, emSegundos: /\d\s*(s|seg)/i.test(repeticoes) };
}

export default function WorkoutPlayer({ treino, perfil, sessoes, aoTerminar, aoCancelar }: Props) {
  // Cópia local dos exercícios — permite substituir 1 exercício em execução (aparelho ocupado/indisponível)
  // sem alterar o treino original guardado no perfil.
  const [exerciciosState, setExerciciosState] = useState<Exercicio[]>(treino.exercicios);

  // Agrupa exercícios consecutivos com o mesmo grupoId em blocos (bi-set/tri-set).
  const blocos = useMemo<Bloco[]>(() => {
    const vistos = new Set<string>();
    const out: Bloco[] = [];
    for (const ex of exerciciosState) {
      if (ex.grupoId) {
        if (vistos.has(ex.grupoId)) continue;
        vistos.add(ex.grupoId);
        out.push({ exercicios: exerciciosState.filter((e) => e.grupoId === ex.grupoId) });
      } else {
        out.push({ exercicios: [ex] });
      }
    }
    return out;
  }, [exerciciosState]);

  const [fase, setFase] = useState<Fase>('pronto');
  const [blocoIdx, setBlocoIdx] = useState(0);
  const [estacaoIdx, setEstacaoIdx] = useState(0);
  const [rodada, setRodada] = useState(1);
  const [restante, setRestante] = useState(0);
  const [vozOn, setVozOn] = useState(true);
  const [itens, setItens] = useState<ItemSessao[]>(exerciciosState.map((e) => ({ nome: e.nome, seriesFeitas: [] })));
  const [repsFeitas, setRepsFeitas] = useState('');
  const [cargaUsada, setCargaUsada] = useState('');
  // coach conversacional
  const [guiando, setGuiando] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [contagemPrep, setContagemPrep] = useState(0);
  const [repAtual, setRepAtual] = useState(0);
  const [perguntandoPeso, setPerguntandoPeso] = useState(false);
  const [escutando, setEscutando] = useState(false);
  const [recorde, setRecorde] = useState<string | null>(null);
  const [rpe, setRpe] = useState<number | null>(null);
  const [trocando, setTrocando] = useState(false);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [perguntandoRir, setPerguntandoRir] = useState(false);

  const inicioRef = useRef(Date.now());
  const timerRef = useRef<number | null>(null);
  const contagemRef = useRef<number | null>(null);
  const contagemPrepRef = useRef<number | null>(null);
  const pararEscutaRef = useRef<(() => void) | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  // Guarda ONDE gravar o RIR (índice do item/série) — capturado no momento da série final,
  // porque exAtual/itensIdx já mudam pro próximo exercício antes da pessoa responder.
  const rirAlvoRef = useRef<{ itensIdx: number; serieIdx: number } | null>(null);

  const blocoAtual = blocos[blocoIdx];
  const exAtual = blocoAtual?.exercicios[estacaoIdx];
  const ehSuperset = (blocoAtual?.exercicios.length ?? 0) > 1;
  const ultimaEstacao = estacaoIdx === (blocoAtual?.exercicios.length ?? 1) - 1;
  const totalRodadasBloco = blocoAtual ? rodadasDoBloco(blocoAtual) : 1;
  const ultimaRodada = rodada >= totalRodadasBloco;
  const ultimoBloco = blocoIdx >= blocos.length - 1;
  const recomendacao = exAtual ? cargaRecomendada(sessoes, exAtual.nome) : { motivo: '' };
  const recordeAtual = exAtual ? maiorCargaHistorica(sessoes, exAtual.nome) : 0;
  const historicoExercicio = exAtual ? ultimasSeriesDoExercicio(sessoes, exAtual.nome) : [];
  const emEstadoPronto = fase === 'exercicio' && !preparando && !guiando;

  useEffect(() => {
    setMostrarHistorico(false);
  }, [blocoIdx, estacaoIdx]);

  // Mantém a tela do celular acesa durante todo o treino (Wake Lock).
  async function manterTelaAcesa() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
      if (!nav.wakeLock) return;
      wakeLockRef.current = await nav.wakeLock.request('screen');
    } catch {
      // sem suporte ou permissão — segue sem travar a tela
    }
  }

  function liberarTela() {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }

  // Se o usuário sair e voltar ao app no meio do treino, readquire o wake lock.
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === 'visible' && fase !== 'pronto' && fase !== 'fim') manterTelaAcesa();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [fase]);

  useEffect(() => {
    definirVozHabilitada(vozOn);
  }, [vozOn]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (contagemRef.current) window.clearInterval(contagemRef.current);
      if (contagemPrepRef.current) window.clearInterval(contagemPrepRef.current);
      pararEscutaRef.current?.();
      wakeLockRef.current?.release().catch(() => {});
      silenciar();
      definirVozHabilitada(true);
    },
    [],
  );

  // ---------- Anúncios por voz ----------
  function anunciarEstacao(bIdx: number, eIdx: number, rod: number, primeiraDoBloco: boolean) {
    const bloco = blocos[bIdx];
    const ex = bloco?.exercicios[eIdx];
    if (!ex) return;
    const rec = cargaRecomendada(sessoes, ex.nome);
    const carga = rec.cargaKg ? ` Recomendo ${rec.cargaKg} quilos.` : '';
    const dica = rod === 1 && ex.dicaRapida ? ` Lembrete: ${ex.dicaRapida}.` : '';
    if (bloco.exercicios.length > 1) {
      if (eIdx === 0 && primeiraDoBloco) {
        const nomes = bloco.exercicios.map((e) => e.nome).join(', depois ');
        const tipo = bloco.exercicios.length === 3 ? 'tri-set' : 'bi-set';
        falar(
          `Agora um ${tipo}: ${nomes}, sem descanso entre eles. ${rodadasDoBloco(bloco)} rodadas. Vamos começar por ${ex.nome}, ${repeticoesEmFala(ex.repeticoes)}.${carga}${dica} Toque em "série guiada" quando estiver pronto.`,
        );
      } else {
        falar(`Agora: ${ex.nome}. ${repeticoesEmFala(ex.repeticoes)}.${carga}${dica}`, { fila: true });
      }
    } else {
      falar(
        `${ex.nome}. Série ${rod} de ${ex.series}, ${repeticoesEmFala(ex.repeticoes)}.${carga}${dica} Quando estiver em posição, toque em "série guiada" que eu marco o ritmo com você.`,
      );
    }
  }

  function textoDicaDescanso(ex: Exercicio): string | undefined {
    if (ex.dicaRapida) return `Enquanto descansa: ${ex.dicaRapida}.`;
    if (ex.instrucoes) return ex.instrucoes.split(/(?<=[.!?])\s/)[0];
    return undefined;
  }

  // Compara a série que acabou de terminar com a anterior do MESMO exercício nesta sessão —
  // uma reflexão de performance pra falar no descanso, em vez de só repetir a dica de postura.
  function textoPerformance(repsAtual: number | undefined, serieAnterior: { reps?: number; cargaKg?: number } | undefined): string | undefined {
    if (repsAtual == null || serieAnterior?.reps == null) return undefined;
    if (repsAtual > serieAnterior.reps) return `Você fez ${repsAtual} reps, mais que a série anterior (${serieAnterior.reps}) — ótima evolução dentro do treino!`;
    if (repsAtual < serieAnterior.reps) return `Essa série rendeu ${repsAtual} reps, um pouco menos que a anterior (${serieAnterior.reps}) — normal com a fadiga acumulando, foque na técnica.`;
    return `Mesmas ${repsAtual} reps da série anterior — boa consistência.`;
  }

  function textoProximoDescanso(): string | undefined {
    if (!blocoAtual) return undefined;
    if (!ultimaRodada) {
      if (ehSuperset) return `Próxima rodada: de novo ${blocoAtual.exercicios.map((e) => e.nome).join(' e ')}.`;
      return `Próxima série: mais ${repeticoesEmFala(blocoAtual.exercicios[0].repeticoes)} de ${blocoAtual.exercicios[0].nome}.`;
    }
    const prox = blocos[blocoIdx + 1];
    if (!prox) return undefined;
    const primeiro = prox.exercicios[0];
    if (prox.exercicios.length > 1) {
      const tipo = prox.exercicios.length === 3 ? 'tri-set' : 'bi-set';
      return `A seguir: um ${tipo} começando por ${primeiro.nome}.`;
    }
    return `A seguir: ${primeiro.nome}. ${repeticoesEmFala(primeiro.repeticoes)}.`;
  }

  // ---------- Início: aquecimento (se houver) ou direto pro primeiro bloco ----------
  function comecar() {
    inicioRef.current = Date.now();
    manterTelaAcesa();
    if (treino.aquecimentoMin && treino.aquecimentoMin > 0) {
      iniciarAquecimento();
    } else {
      iniciarPrimeiroBloco();
    }
  }

  function iniciarAquecimento() {
    const seg = Math.max(30, (treino.aquecimentoMin ?? 0) * 60);
    setFase('aquecimento');
    setRestante(seg);
    falar(
      `Vamos começar com o aquecimento. ${treino.aquecimento || 'Mobilize as articulações e eleve a frequência cardíaca gradualmente.'}`,
    );
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setRestante((r) => {
        if (r <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          bip(2);
          iniciarPrimeiroBloco();
          return 0;
        }
        if (r === 11) falar('Aquecimento quase terminando. Já pode ir se aproximando do primeiro exercício.', { fila: true });
        return r - 1;
      });
    }, 1000);
  }

  function pularAquecimento() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    iniciarPrimeiroBloco();
  }

  function iniciarPrimeiroBloco() {
    setFase('exercicio');
    setBlocoIdx(0);
    setEstacaoIdx(0);
    setRodada(1);
    const primeiro = blocos[0]?.exercicios[0];
    const rec = primeiro ? cargaRecomendada(sessoes, primeiro.nome) : { motivo: '' };
    setCargaUsada(rec.cargaKg ? String(rec.cargaKg) : '');
    anunciarEstacao(0, 0, 1, true);
  }

  // ---------- Preparação: ~3s para o aluno tocar em "começar" e se posicionar no aparelho ----------
  function iniciarSerieGuiada() {
    if (!exAtual || guiando || preparando) return;
    setPreparando(true);
    setContagemPrep(3);
    falar('Prepare-se e se posicione no aparelho.', { rapida: true });
    contagemPrepRef.current = window.setInterval(() => {
      setContagemPrep((n) => {
        const prox = n - 1;
        if (prox > 0) {
          falar(String(prox), { fila: true, rapida: true });
          return prox;
        }
        if (contagemPrepRef.current) {
          window.clearInterval(contagemPrepRef.current);
          contagemPrepRef.current = null;
        }
        setPreparando(false);
        iniciarContagemReal();
        return 0;
      });
    }, 1000);
  }

  // ---------- Série guiada: o coach conta o ritmo (cadência específica do exercício) ----------
  function iniciarContagemReal() {
    if (!exAtual) return;
    const { alvo, emSegundos } = alvoDe(exAtual.repeticoes);
    setGuiando(true);
    setRepAtual(0);
    const cadenciaMs = emSegundos ? 1000 : Math.max(1000, Math.round((exAtual.cadenciaSeg || 3) * 1000));
    const dicaRapida = exAtual.dicaRapida;
    falar(emSegundos ? `${alvo} segundos. Já!` : 'Vamos!', { rapida: true });
    window.setTimeout(() => {
      let n = 0;
      contagemRef.current = window.setInterval(() => {
        n++;
        setRepAtual(n);
        if (emSegundos) {
          if (alvo - n === 10) falar('Faltam dez segundos, segura firme!', { fila: true, rapida: true });
          else if (n % 10 === 0) bip(1);
        } else {
          falar(String(n), { rapida: true });
          // intencionalidade positiva e revisão técnica no meio da série, como um personal do lado
          if (n > 1 && n < alvo && n % 3 === 0) {
            const usaDica = dicaRapida && n % 6 === 0;
            falar(usaDica ? dicaRapida! : incentivoCurto(), { fila: true, rapida: true });
          }
          if (n === alvo - 1 && alvo >= 4) falar('Mais uma, tudo que tem!', { fila: true, rapida: true });
        }
        if (n >= alvo) terminarSerieGuiada(alvo, emSegundos);
      }, cadenciaMs);
    }, 900);
  }

  function terminarSerieGuiada(reps: number, emSegundos = false) {
    if (contagemRef.current) {
      window.clearInterval(contagemRef.current);
      contagemRef.current = null;
    }
    setGuiando(false);
    setRepAtual(0);
    concluirEstacao(emSegundos ? undefined : reps);
  }

  // ---------- Conclusão de uma estação (um exercício, uma rodada) ----------
  function concluirEstacao(repsOverride?: number) {
    if (!exAtual || !blocoAtual) return;
    const reps = repsOverride ?? (repsFeitas ? parseInt(repsFeitas, 10) : undefined);
    const carga = cargaUsada ? parseFloat(cargaUsada.replace(',', '.')) : undefined;
    const itensIdx = exerciciosState.findIndex((e) => e.id === exAtual.id);
    let serieAnterior: { reps?: number; cargaKg?: number } | undefined;
    setItens((prev) => {
      const novo = [...prev];
      const seriesJaFeitas = novo[itensIdx]?.seriesFeitas ?? [];
      serieAnterior = seriesJaFeitas[seriesJaFeitas.length - 1];
      if (ultimaRodada) rirAlvoRef.current = { itensIdx, serieIdx: seriesJaFeitas.length };
      novo[itensIdx] = { ...novo[itensIdx], seriesFeitas: [...seriesJaFeitas, { reps, cargaKg: carga }] };
      return novo;
    });
    setRepsFeitas('');
    if (ultimaRodada) setPerguntandoRir(true);

    // Recorde pessoal: só comemora se já existia uma marca anterior para bater.
    if (carga && carga > 0) {
      const recordeAnterior = maiorCargaHistorica(sessoes, exAtual.nome);
      if (recordeAnterior > 0 && carga > recordeAnterior) {
        const msg = `🏆 Recorde pessoal em ${exAtual.nome}: ${carga} kg!`;
        setRecorde(msg);
        falar(`Novo recorde pessoal! ${carga} quilos em ${exAtual.nome}. Mandou muito bem!`, { fila: true });
        window.setTimeout(() => setRecorde((r) => (r === msg ? null : r)), 6000);
      }
    }

    if (!ultimaEstacao) {
      // avança para a próxima estação da MESMA rodada, sem descanso (é assim que um superset funciona)
      const proxEstIdx = estacaoIdx + 1;
      const proxEx = blocoAtual.exercicios[proxEstIdx];
      setEstacaoIdx(proxEstIdx);
      const recProx = cargaRecomendada(sessoes, proxEx.nome);
      setCargaUsada(recProx.cargaKg ? String(recProx.cargaKg) : '');
      anunciarEstacao(blocoIdx, proxEstIdx, rodada, false);
      return;
    }

    // terminou a rodada inteira (todas as estações do bloco) — acabou o treino?
    if (ultimaRodada && ultimoBloco) {
      finalizar();
      return;
    }

    falar(incentivoAleatorio());

    // Prioriza uma reflexão de performance (comparando com a série anterior do mesmo exercício
    // nesta sessão) e só cai pra dica de postura/técnica quando não há o que comparar ainda.
    const dica = textoPerformance(reps, serieAnterior) ?? textoDicaDescanso(exAtual);
    const proximo = textoProximoDescanso();
    const descansoSeg = exAtual.descansoSeg || perfil.descansoPadraoSeg;

    iniciarDescanso(descansoSeg, { dica, proximo }, () => {
      setPerguntandoPeso(false);
      pararEscutaRef.current?.();
      if (ultimaRodada) {
        const proxBlocoIdx = blocoIdx + 1;
        const proxBloco = blocos[proxBlocoIdx];
        setBlocoIdx(proxBlocoIdx);
        setEstacaoIdx(0);
        setRodada(1);
        const rec = proxBloco ? cargaRecomendada(sessoes, proxBloco.exercicios[0].nome) : { motivo: '' };
        setCargaUsada(rec.cargaKg ? String(rec.cargaKg) : '');
        anunciarEstacao(proxBlocoIdx, 0, 1, true);
      } else {
        setEstacaoIdx(0);
        setRodada((r) => r + 1);
        // Mesmo exercício, próxima rodada: mantém a carga já ajustada (leve/bom/pesado) da série
        // anterior — NÃO volta pra recomendação histórica, senão o ajuste feito se perde.
        anunciarEstacao(blocoIdx, 0, rodada + 1, false);
      }
    });

    // pergunta sobre o peso durante o descanso (se houve carga usada)
    if (carga && carga > 0) {
      window.setTimeout(() => perguntarPeso(), 4500);
    }
  }

  function perguntarPeso() {
    setPerguntandoPeso(true);
    falar('Me conta: o peso ficou leve, bom, ou pesado?', {
      fila: true,
      aoTerminar: () => {
        setEscutando(true);
        pararEscutaRef.current = ouvirResposta(7000, (texto) => {
          setEscutando(false);
          if (!texto) return; // sem resposta por voz — os botões continuam na tela
          const t = texto.toLowerCase();
          if (/lev|f[áa]c|frac|pouco|aument/.test(t)) aplicarAjuste('leve');
          else if (/pesad|dif[íi]c|muito|n[ãa]o consegui|dimin/.test(t)) aplicarAjuste('pesado');
          else if (/bom|boa|ok|adequad|perfeit|mant|certo|ideal/.test(t)) aplicarAjuste('bom');
        });
      },
    });
  }

  // Anilhas/placas de academia normalmente incrementam de 2,5 em 2,5 kg — arredonda pra esse padrão
  // em vez de sugerir cargas como "20.6kg" que não existem na prática.
  function arredondar25(v: number): number {
    return Math.round(v / 2.5) * 2.5;
  }

  // RIR (repetições em reserva) — só perguntado na série final de cada exercício, pra não
  // pesar a mão em toda série. Grava retroativamente na série que já foi salva em concluirEstacao.
  function registrarRir(valor: number) {
    const alvo = rirAlvoRef.current;
    setPerguntandoRir(false);
    rirAlvoRef.current = null;
    if (!alvo) return;
    setItens((prev) => {
      const novo = [...prev];
      const item = novo[alvo.itensIdx];
      if (!item) return prev;
      const series = [...item.seriesFeitas];
      const serie = series[alvo.serieIdx];
      if (!serie) return prev;
      series[alvo.serieIdx] = { ...serie, rir: valor };
      novo[alvo.itensIdx] = { ...item, seriesFeitas: series };
      return novo;
    });
  }

  function aplicarAjuste(resposta: 'leve' | 'bom' | 'pesado') {
    setPerguntandoPeso(false);
    setEscutando(false);
    pararEscutaRef.current?.();
    const atual = parseFloat(cargaUsada.replace(',', '.'));
    if (!atual || isNaN(atual)) return;
    if (resposta === 'leve') {
      const nova = Math.max(atual + 2.5, arredondar25(atual * 1.05));
      setCargaUsada(String(nova));
      falar(`Boa! Então sobe para ${nova} quilos na próxima série.`, { fila: true });
    } else if (resposta === 'pesado') {
      const nova = Math.max(2.5, Math.min(atual - 2.5, arredondar25(atual * 0.92)));
      setCargaUsada(String(nova));
      falar(`Sem problema. Desce para ${nova} quilos e capricha na técnica.`, { fila: true });
    } else {
      falar(`Perfeito, mantém ${atual} quilos. Tá no caminho certo!`, { fila: true });
    }
  }

  // ---------- Trocar o exercício atual (aparelho ocupado/indisponível na academia) ----------
  async function trocarExercicioAtual() {
    if (!exAtual || trocando) return;
    setTrocando(true);
    try {
      const sugestao = await trocarExercicio(perfil, exAtual, treino.local);
      const novoEx: Exercicio = { ...exAtual, ...sugestao };
      setExerciciosState((prev) => prev.map((e) => (e.id === exAtual.id ? novoEx : e)));
      setItens((prev) =>
        prev.map((it, idx) => (exerciciosState[idx]?.id === exAtual.id ? { nome: novoEx.nome, seriesFeitas: [] } : it)),
      );
      const rec = cargaRecomendada(sessoes, novoEx.nome);
      setCargaUsada(rec.cargaKg ? String(rec.cargaKg) : '');
      falar(`Trocado para ${novoEx.nome}. ${novoEx.instrucoes ?? ''}`);
    } catch (e) {
      alert('Não consegui sugerir uma troca agora: ' + (e as Error).message);
    } finally {
      setTrocando(false);
    }
  }

  // ---------- Descanso: preenchido com dica, análise e prévia do próximo — não é silêncio ----------
  // Os últimos ~10s são uma "zona protegida": nenhuma dica/prévia é agendada tão perto do fim, e os
  // avisos de tempo (dez segundos, contagem final) NUNCA usam fila — cancelam qualquer fala pendente
  // pra sempre chegar na hora certa, sem serem atropelados ou atropelar o bip final.
  function iniciarDescanso(segundos: number, conteudo: { dica?: string; proximo?: string }, aoFim: () => void) {
    setFase('descanso');
    setRestante(segundos);
    const marcoDica = conteudo.dica && segundos >= 35 ? Math.max(15, Math.round(segundos * 0.55)) : -1;
    const marcoProximo = conteudo.proximo && segundos >= 30 ? Math.max(11, Math.round(segundos * 0.22)) : -1;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setRestante((r) => {
        if (r <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          bip(3);
          setFase('exercicio');
          aoFim();
          return 0;
        }
        if (r === marcoDica) falar(conteudo.dica!, { fila: true });
        else if (r === marcoProximo) falar(conteudo.proximo!, { fila: true });
        else if (r === 10) falar('Dez segundos.', { rapida: true });
        else if (r <= 3) falar(String(r), { rapida: true });
        return r - 1;
      });
    }, 1000);
  }

  function pularDescanso() {
    setRestante(1);
  }

  function pularBloco() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (contagemRef.current) window.clearInterval(contagemRef.current);
    if (contagemPrepRef.current) window.clearInterval(contagemPrepRef.current);
    setGuiando(false);
    setPreparando(false);
    setPerguntandoPeso(false);
    setPerguntandoRir(false);
    if (blocoIdx >= blocos.length - 1) {
      finalizar();
      return;
    }
    const proxBlocoIdx = blocoIdx + 1;
    const proxBloco = blocos[proxBlocoIdx];
    setBlocoIdx(proxBlocoIdx);
    setEstacaoIdx(0);
    setRodada(1);
    setFase('exercicio');
    const rec = cargaRecomendada(sessoes, proxBloco.exercicios[0].nome);
    setCargaUsada(rec.cargaKg ? String(rec.cargaKg) : '');
    anunciarEstacao(proxBlocoIdx, 0, 1, true);
  }

  function finalizar() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (contagemRef.current) window.clearInterval(contagemRef.current);
    if (contagemPrepRef.current) window.clearInterval(contagemPrepRef.current);
    pararEscutaRef.current?.();
    setGuiando(false);
    setPreparando(false);
    setPerguntandoPeso(false);
    setPerguntandoRir(false);
    liberarTela();
    setFase('fim');
    falar(`Treino concluído, ${perfil.nome}! Você foi incrível hoje. Alonga, hidrata e descansa — o músculo cresce no descanso.`);
  }

  function salvar() {
    const sessao: SessaoTreino = {
      id: uid(),
      treinoId: treino.id,
      nomeTreino: treino.nome,
      local: treino.local,
      data: new Date().toISOString(),
      duracaoMin: Math.max(1, Math.round((Date.now() - inicioRef.current) / 60000)),
      itens: itens.filter((i) => i.seriesFeitas.length > 0),
      rpe: rpe ?? undefined,
    };
    aoTerminar(sessao);
  }

  const minutos = String(Math.floor(restante / 60)).padStart(1, '0');
  const segundos = String(restante % 60).padStart(2, '0');

  return (
    <div className="player">
      <div className="cartao">
        <div className="player-topo">
          <h2><IconeComecar size={19} /> {treino.nome}</h2>
          {vozDisponivel() && (
            <button className="chip" onClick={() => setVozOn(!vozOn)}>
              {vozOn ? '🔊 Voz ligada' : '🔇 Voz desligada'}
            </button>
          )}
        </div>

        {recorde && <div className="banner-recorde">{recorde}</div>}

        {fase === 'pronto' && (
          <div className="centro">
            <p>
              {exerciciosState.length} {exerciciosState.length === 1 ? 'exercício' : 'exercícios'} te esperando
              {blocos.length < exerciciosState.length
                ? ` (organizados em ${blocos.length} ${blocos.length === 1 ? 'bloco' : 'blocos'}, com bi-sets/tri-sets)`
                : ''}
              .
              {treino.aquecimento && (
                <>
                  <br />🔥 Aquecimento{treino.aquecimentoMin ? ` (${treino.aquecimentoMin} min)` : ''}: {treino.aquecimento}
                </>
              )}
            </p>
            <button className="primario grande" onClick={comecar}>🚀 Começar</button>
            <button onClick={aoCancelar}>Voltar</button>
          </div>
        )}

        {fase === 'aquecimento' && (
          <div className="centro descanso">
            <p className="rotulo-descanso">🔥 Aquecimento e mobilidade</p>
            {treino.aquecimento && <p className="instrucao">{treino.aquecimento}</p>}
            <div className="timer">{minutos}:{segundos}</div>
            <button className="secundario" onClick={pularAquecimento}><IconePular size={16} /> Pular aquecimento</button>
          </div>
        )}

        {(fase === 'exercicio' || fase === 'descanso') && exAtual && blocoAtual && (
          <>
            <p className="progresso">
              Bloco {blocoIdx + 1} de {blocos.length}
              {ehSuperset && ` · Estação ${estacaoIdx + 1} de ${blocoAtual.exercicios.length}`}
            </p>
            {ehSuperset && (
              <span className="badge-superset">{blocoAtual.exercicios.length === 3 ? 'Tri-set' : 'Bi-set'}</span>
            )}
            <h3 className="nome-exercicio">
              {iconeEquipamento(exAtual.nome)} {exAtual.nome}
              {recordeAtual > 0 && <span className="badge-recorde">🏆 {recordeAtual}kg</span>}
            </h3>
            <p className="serie-info">
              Rodada <strong>{rodada}</strong> de {totalRodadasBloco} · {exAtual.repeticoes} repetições
            </p>
            {exAtual.instrucoes && <p className="instrucao">💡 {exAtual.instrucoes}</p>}

            <ImagemExercicio nome={exAtual.nome} hrefVideo={linkVideoExercicio(exAtual.nome)} />

            <div className="acoes-exercicio">
              <a className="pill-acao" href={linkVideoExercicio(exAtual.nome)} target="_blank" rel="noreferrer">
                <IconeVideo size={15} /> Como fazer
              </a>
              <button className="pill-acao" onClick={() => setMostrarHistorico((v) => !v)}>
                <IconeHistorico size={15} /> Histórico
              </button>
              {emEstadoPronto && (
                <button className="pill-acao" onClick={trocarExercicioAtual} disabled={trocando}>
                  {trocando ? '🤖 Buscando...' : <><IconeTrocar size={15} /> Trocar</>}
                </button>
              )}
            </div>
            {mostrarHistorico && (
              <div className="historico-exercicio">
                {historicoExercicio.length === 0 ? (
                  <p className="historico-vazio">Sem histórico anterior deste exercício ainda.</p>
                ) : (
                  historicoExercicio.map((h, idx) => (
                    <div className="historico-item" key={idx}>
                      <span className="historico-data">{new Date(h.data).toLocaleDateString('pt-BR')}</span>
                      <span className="historico-series">
                        {h.seriesFeitas
                          .map((s) => `${s.reps ?? '—'}×${s.cargaKg ?? '—'}kg${s.rir != null ? ` (RIR ${s.rir})` : ''}`)
                          .join(' · ')}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            <MediaGallery midias={exAtual.midias} />
            <p className="recomendacao">
              🏋️ {recomendacao.cargaKg ? `Carga recomendada: ${recomendacao.cargaKg} kg — ` : ''}{recomendacao.motivo}
            </p>

            {fase === 'descanso' ? (
              <div className="centro descanso">
                <p className="rotulo-descanso">😮‍💨 Descanso</p>
                <div className="timer">{minutos}:{segundos}</div>
                {perguntandoPeso && (
                  <div className="pergunta-peso">
                    <p><IconeMicrofone size={15} /> {escutando ? 'Estou ouvindo... como ficou o peso?' : 'Como ficou o peso?'}</p>
                    <div className="botoes centro-botoes">
                      <button onClick={() => aplicarAjuste('leve')}>😌 Leve</button>
                      <button className="primario" onClick={() => aplicarAjuste('bom')}>👍 Bom</button>
                      <button onClick={() => aplicarAjuste('pesado')}>🥵 Pesado</button>
                    </div>
                  </div>
                )}
                {perguntandoRir && (
                  <div className="pergunta-rir">
                    <p>🎯 Última série desse exercício: quantas repetições ainda tinha de sobra?</p>
                    <div className="botoes centro-botoes">
                      {[0, 1, 2, 3, 4].map((n) => (
                        <button key={n} onClick={() => registrarRir(n)}>{n === 4 ? '4+' : n}</button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="botoes centro-botoes">
                  <button className="secundario" onClick={pularDescanso}><IconePular size={16} /> Pular descanso</button>
                  <button onClick={() => setRestante((r) => Math.max(1, r - 15))}>−15s</button>
                  <button onClick={() => setRestante((r) => r + 15)}>+15s</button>
                </div>
              </div>
            ) : preparando ? (
              <div className="centro">
                <p className="rotulo-descanso">🧍 Posicione-se no aparelho...</p>
                <div className="timer">{contagemPrep}</div>
              </div>
            ) : guiando ? (
              <div className="centro">
                <p className="rotulo-descanso">🎬 Série guiada — acompanha o ritmo!</p>
                <div className="timer">{repAtual}</div>
                <button className="primario grande" onClick={() => terminarSerieGuiada(repAtual || 1, alvoDe(exAtual.repeticoes).emSegundos)}>
                  <IconeConcluido size={18} /> Terminei
                </button>
              </div>
            ) : (
              <div className="centro">
                <div className="linha">
                  <div>
                    <label>Repetições feitas</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={repsFeitas}
                      onChange={(e) => setRepsFeitas(e.target.value)}
                      placeholder={exAtual.repeticoes}
                    />
                  </div>
                  <div>
                    <label>Carga (kg)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={cargaUsada}
                      onChange={(e) => setCargaUsada(e.target.value)}
                      placeholder={exAtual.cargaSugerida || '—'}
                    />
                  </div>
                </div>
                {vozDisponivel() && vozOn && (
                  <button className="destaque grande" onClick={iniciarSerieGuiada}>
                    🎬 Série guiada (eu conto o ritmo com você)
                  </button>
                )}
                <button className="primario grande" onClick={() => concluirEstacao()}><IconeConcluido size={18} /> Série concluída</button>
              </div>
            )}

            <div className="botoes rodape-player">
              <button className="secundario" onClick={pularBloco}><IconePular size={16} /> Próximo exercício</button>
              <button className="perigo" onClick={() => { if (confirm('Encerrar o treino agora?')) finalizar(); }}>
                <IconeParar size={16} /> Encerrar
              </button>
            </div>
          </>
        )}

        {fase === 'fim' && (
          <div className="centro celebracao">
            <h3>🎉 Treino concluído!</h3>
            <p>
              {itens.reduce((acc, i) => acc + i.seriesFeitas.length, 0)} séries em{' '}
              {Math.max(1, Math.round((Date.now() - inicioRef.current) / 60000))} minutos. Mandou bem demais!
            </p>
            <p className="rpe-pergunta">De 1 a 10, como foi o esforço geral desse treino?</p>
            <div className="rpe-escala">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  className={`rpe-botao ${rpe === n ? 'ativa' : ''}`}
                  onClick={() => setRpe(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <button className="primario grande" onClick={salvar}><IconeSalvar size={18} /> Salvar no histórico</button>
            <button onClick={aoCancelar}>Descartar</button>
          </div>
        )}
      </div>
    </div>
  );
}
