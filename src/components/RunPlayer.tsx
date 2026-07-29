import { useEffect, useRef, useState } from 'react';
import type { BlocoCorrida, DiaCorrida, EtapaCorrida, Perfil, SessaoTreino } from '../types';
import { uid } from '../storage';
import { bip, falar, silenciar, vozDisponivel } from '../speech';
import { IconeComecar, IconeParar, IconePausa, IconeSalvar, IconeCorrida } from './Icones';
import { Satellite, Smartphone, Rocket, PartyPopper, SkipForward } from 'lucide-react';

interface Props {
  perfil: Perfil;
  tituloTreino?: string; // dia do plano sendo executado, se houver
  diaPlano?: DiaCorrida; // quando presente e com `etapas`, o coach guia o treino por voz
  aoTerminar: (s: SessaoTreino) => void;
  aoCancelar: () => void;
}

const INCENTIVOS_CORRIDA = [
  'Você está voando!',
  'Mantém esse ritmo, tá lindo!',
  'Respira fundo, passada leve.',
  'Cada passo conta. Segue firme!',
  'Olha você superando seus limites!',
  'Postura ereta, braços soltos. Perfeito!',
];

// Faixa aproximada de km/h por percepção de esforço — usada só para dar feedback de ritmo
// quando o bloco não tem `velocidadeAlvoKmH` numérico definido.
const FAIXA_RITMO_KMH: Record<BlocoCorrida['ritmo'], [number, number]> = {
  leve: [5, 8],
  moderado: [7.5, 10.5],
  forte: [10, 13],
  máximo: [12, 20],
};

// Distância entre dois pontos GPS (fórmula de Haversine), em metros.
function distanciaM(a: GeolocationCoordinates, b: GeolocationCoordinates): number {
  const R = 6371000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatarRitmo(minPorKm: number): string {
  if (!isFinite(minPorKm) || minPorKm <= 0) return '—';
  const m = Math.floor(minPorKm);
  const s = Math.round((minPorKm - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Velocidade (km/h) é só o inverso do ritmo (min/km) — mesma métrica, outra unidade,
// mais intuitiva pra quem já pensa em "quantos km por hora" em vez de "min por km".
function velocidadeDe(minPorKm: number): number {
  return isFinite(minPorKm) && minPorKm > 0 ? 60 / minPorKm : 0;
}

function formatarVelocidade(kmh: number): string {
  return kmh > 0 ? kmh.toFixed(1) : '—';
}

function ritmoEmFala(minPorKm: number): string {
  if (!isFinite(minPorKm) || minPorKm <= 0) return '';
  const m = Math.floor(minPorKm);
  const s = Math.round((minPorKm - m) * 60);
  return s ? `${m} minutos e ${s} por quilômetro` : `${m} minutos por quilômetro`;
}

function distanciaEmFala(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} metros`;
  const inteiro = Math.floor(km);
  const meio = km - inteiro >= 0.45 && km - inteiro < 0.55;
  if (meio) return inteiro ? `${inteiro} quilômetro${inteiro > 1 ? 's' : ''} e meio` : 'meio quilômetro';
  return `${km.toFixed(1).replace('.', ' vírgula ')} quilômetros`;
}

function formatarMMSS(seg: number): string {
  const s = Math.max(0, seg);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function duracaoEmFala(seg: number): string {
  if (seg < 60) return `${seg} segundos`;
  const min = Math.round(seg / 60);
  return `${min} minuto${min > 1 ? 's' : ''}`;
}

function fraseAtividade(bloco: BlocoCorrida): string {
  if (bloco.atividade === 'caminhar') return bloco.ritmo === 'leve' ? 'caminhada leve' : 'caminhada';
  const porRitmo: Record<BlocoCorrida['ritmo'], string> = {
    leve: 'trote leve',
    moderado: 'ritmo moderado',
    forte: 'ritmo forte',
    máximo: 'seu ritmo máximo',
  };
  return porRitmo[bloco.ritmo];
}

function fraseInicioBloco(etapa: EtapaCorrida, bloco: BlocoCorrida, repeticao: number): string {
  const duracao = duracaoEmFala(bloco.duracaoSeg);
  if (etapa.tipo === 'aquecimento') return `${duracao} de aquecimento, ${fraseAtividade(bloco)} pra soltar o corpo.`;
  if (etapa.tipo === 'resfriamento') return `Última etapa: volta à calma, ${duracao} de ${fraseAtividade(bloco)}. Você mandou muito bem hoje!`;
  if (etapa.tipo === 'intervalado') {
    if (bloco.atividade === 'caminhar') return `Recuperação: ${duracao} de ${fraseAtividade(bloco)}.`;
    return `Tiro ${repeticao} de ${etapa.repeticoes}! ${duracao} em ${fraseAtividade(bloco)}.`;
  }
  return `Agora ${duracao} em ${fraseAtividade(bloco)}.`;
}

function rotuloEtapa(etapa: EtapaCorrida, bloco: BlocoCorrida, repeticao: number): string {
  if (etapa.tipo === 'aquecimento') return 'Aquecimento';
  if (etapa.tipo === 'resfriamento') return 'Volta à calma';
  if (etapa.tipo === 'intervalado') return `Intervalado — ${bloco.atividade === 'correr' ? 'Tiro' : 'Recuperação'} ${repeticao}/${etapa.repeticoes}`;
  return 'Corrida contínua';
}

// Faixa de ritmo alvo em texto curto, pro cartão da etapa — mesma fonte usada pra avaliar o
// desempenho em avaliarRitmoBloco (velocidadeAlvoKmH quando houver, senão a faixa por percepção
// de esforço).
function faixaAlvoTexto(bloco: BlocoCorrida): string | null {
  if (bloco.atividade !== 'correr') return null;
  if (bloco.velocidadeAlvoKmH) return `~${bloco.velocidadeAlvoKmH.toFixed(1)} km/h`;
  const [min, max] = FAIXA_RITMO_KMH[bloco.ritmo];
  return `${min}–${max} km/h`;
}

export default function RunPlayer({ perfil, tituloTreino, diaPlano, aoTerminar, aoCancelar }: Props) {
  const guiado = !!diaPlano?.etapas?.length;
  const [estado, setEstado] = useState<'pronto' | 'correndo' | 'pausado' | 'fim'>('pronto');
  const [distM, setDistM] = useState(0);
  const [segundos, setSegundos] = useState(0);
  const [gpsOk, setGpsOk] = useState<'aguardando' | 'ok' | 'fraco' | 'erro'>('aguardando');
  const [etapaIdx, setEtapaIdx] = useState(0);
  const [repeticao, setRepeticao] = useState(1);
  const [blocoIdx, setBlocoIdx] = useState(0);
  const [restanteBloco, setRestanteBloco] = useState(0);

  const ultimaPosRef = useRef<GeolocationPosition | null>(null);
  const watchRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const proximoAnuncioRef = useRef(500); // anuncia a cada 500 m
  const distRef = useRef(0);
  const segRef = useRef(0);
  // Tempo decorrido por wall-clock (Date.now()), não por contagem de ticks do setInterval — se o
  // navegador atrasar/agrupar os ticks (aba em segundo plano), um contador "+1 por tick" fica pra
  // trás e distorce ritmo/velocidade (calculados como distância/tempo); recalcular a partir do
  // relógio real corrige mesmo que os ticks tenham sido atrasados.
  const inicioCorridaRef = useRef(0);
  const segAcumuladosRef = useRef(0);
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  // Navegação do roteiro guiado (etapas/repetições/blocos) — refs pra ler dentro do tick do
  // setInterval sem depender de closures desatualizadas, espelhando o padrão já usado pra
  // distância/tempo total (distRef/segRef).
  const etapaIdxRef = useRef(0);
  const repeticaoRef = useRef(1);
  const blocoIdxRef = useRef(0);
  const restanteBlocoRef = useRef(0);
  const avisadoQuaseFimRef = useRef(false);
  const distBlocoInicioRef = useRef(0);
  const segBlocoInicioRef = useRef(0);

  async function manterTelaAcesa() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
      if (nav.wakeLock) wakeLockRef.current = await nav.wakeLock.request('screen');
    } catch { /* segue sem wake lock */ }
  }

  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === 'visible' && estadoRef.current === 'correndo') manterTelaAcesa();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar);
      pararSensores();
      wakeLockRef.current?.release().catch(() => {});
      silenciar();
    };
  }, []);

  function pararSensores() {
    if (watchRef.current !== null) navigator.geolocation?.clearWatch(watchRef.current);
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    watchRef.current = null;
    timerRef.current = null;
  }

  function aoNovaPosicao(pos: GeolocationPosition) {
    if (estadoRef.current !== 'correndo') {
      setGpsOk('ok');
      return;
    }
    const c = pos.coords;
    if (c.accuracy > 50) {
      setGpsOk('fraco'); // sinal ruim — ignora a leitura, mas NÃO mexe na referência (ver abaixo)
      return;
    }
    const anterior = ultimaPosRef.current;
    if (!anterior) {
      ultimaPosRef.current = pos;
      setGpsOk('ok');
      return;
    }
    const passo = distanciaM(anterior.coords, c);
    const segundosEntrePontos = (pos.timestamp - anterior.timestamp) / 1000;
    // Velocidade implícita acima de ~36 km/h é humanamente impossível numa corrida — descarta
    // como salto de GPS. CRÍTICO: só promove `pos` a nova referência quando o segmento passa
    // nessa checagem — antes, a leitura era promovida ANTES de validar, então um outlier virava a
    // base de comparação da leitura seguinte e travava o acúmulo de distância até o ruído "se
    // resolver sozinho" (a causa raiz de "GPS não mede distância direito").
    const velocidadeImplicitaMs = segundosEntrePontos > 0 ? passo / segundosEntrePontos : Infinity;
    setGpsOk('ok');
    if (velocidadeImplicitaMs > 10) return; // descarta o outlier, mantém a referência anterior
    ultimaPosRef.current = pos; // segmento plausível: agora sim vira a nova referência
    if (passo < 1) return; // parado — referência já atualizada acima, só não soma distância
    distRef.current += passo;
    setDistM(distRef.current);
    if (!guiado && distRef.current >= proximoAnuncioRef.current) {
      proximoAnuncioRef.current += 500;
      anunciarProgresso();
    }
  }

  function anunciarProgresso() {
    const km = distRef.current / 1000;
    const ritmo = segRef.current / 60 / km;
    const incentivo = INCENTIVOS_CORRIDA[Math.floor(Math.random() * INCENTIVOS_CORRIDA.length)];
    falar(`${distanciaEmFala(km)}. Ritmo de ${ritmoEmFala(ritmo)}, ${formatarVelocidade(velocidadeDe(ritmo))} quilômetros por hora. ${incentivo}`);
    bip(1);
  }

  // Compara a velocidade real do bloco (desde que começou) com a faixa esperada pro ritmo
  // pedido — sempre em tom de apoio, nunca de crítica. null quando a amostra é pequena demais
  // pra significar algo (bloco muito curto ou deslocamento por GPS insuficiente).
  function avaliarRitmoBloco(bloco: BlocoCorrida): string | null {
    if (bloco.atividade !== 'correr') return null;
    const distBlocoM = distRef.current - distBlocoInicioRef.current;
    const segBloco = segRef.current - segBlocoInicioRef.current;
    if (segBloco < 30 || distBlocoM < 30) return null;
    const kmh = (distBlocoM / 1000) / (segBloco / 3600);
    const [min, max] = bloco.velocidadeAlvoKmH
      ? [bloco.velocidadeAlvoKmH * 0.85, bloco.velocidadeAlvoKmH * 1.15]
      : FAIXA_RITMO_KMH[bloco.ritmo];
    if (kmh < min) return 'ritmo um pouco mais lento que o pedido, sem problema — o importante é manter a consistência.';
    if (kmh > max) return bloco.ritmo === 'máximo' ? null : 'você foi mais rápido que o pedido — bom sinal, mas sem queimar o gás todo agora.';
    return 'ritmo bom, dentro do esperado.';
  }

  function iniciarBlocoAtual(primeira: boolean) {
    const etapa = diaPlano!.etapas![etapaIdxRef.current];
    const bloco = etapa.blocos[blocoIdxRef.current];
    setEtapaIdx(etapaIdxRef.current);
    setRepeticao(repeticaoRef.current);
    setBlocoIdx(blocoIdxRef.current);
    restanteBlocoRef.current = bloco.duracaoSeg;
    setRestanteBloco(bloco.duracaoSeg);
    distBlocoInicioRef.current = distRef.current;
    segBlocoInicioRef.current = segRef.current;
    avisadoQuaseFimRef.current = false;
    const frase = fraseInicioBloco(etapa, bloco, repeticaoRef.current);
    falar(primeira ? `Bora, ${perfil.nome}! Vamos começar! ${frase}` : frase);
    if (!primeira) bip(2);
  }

  function avancarBloco() {
    const etapas = diaPlano!.etapas!;
    const etapa = etapas[etapaIdxRef.current];
    if (blocoIdxRef.current < etapa.blocos.length - 1) {
      blocoIdxRef.current += 1;
    } else if (repeticaoRef.current < etapa.repeticoes) {
      repeticaoRef.current += 1;
      blocoIdxRef.current = 0;
    } else if (etapaIdxRef.current < etapas.length - 1) {
      etapaIdxRef.current += 1;
      blocoIdxRef.current = 0;
      repeticaoRef.current = 1;
    } else {
      terminar();
      return;
    }
    iniciarBlocoAtual(false);
  }

  function tickBloco() {
    restanteBlocoRef.current -= 1;
    const r = restanteBlocoRef.current;
    setRestanteBloco(Math.max(0, r));
    if (r <= 0) {
      avancarBloco();
      return;
    }
    const etapa = diaPlano!.etapas![etapaIdxRef.current];
    const bloco = etapa.blocos[blocoIdxRef.current];
    const marco = bloco.duracaoSeg >= 15 ? Math.max(5, Math.round(bloco.duracaoSeg * 0.25)) : -1;
    if (r === marco && !avisadoQuaseFimRef.current) {
      avisadoQuaseFimRef.current = true;
      const feedback = bloco.atividade === 'correr' ? avaliarRitmoBloco(bloco) : null;
      const frase = feedback
        ? `Falta pouco! ${feedback}`
        : bloco.atividade === 'correr'
          ? 'Falta pouco, sustenta o ritmo!'
          : 'Recuperação quase acabando, já pode ir se preparando.';
      falar(frase, { fila: true });
    }
  }

  function pularEtapa() {
    bip(1);
    avancarBloco();
  }

  function iniciar() {
    if (estado !== 'pronto') return; // evita clique duplo duplicando watchPosition/setInterval
    if (!navigator.geolocation) {
      setGpsOk('erro');
      alert('GPS não disponível neste aparelho/navegador.');
      return;
    }
    setEstado('correndo');
    manterTelaAcesa();
    inicioCorridaRef.current = Date.now();
    segAcumuladosRef.current = 0;
    if (guiado) {
      etapaIdxRef.current = 0;
      repeticaoRef.current = 1;
      blocoIdxRef.current = 0;
      iniciarBlocoAtual(true);
    } else {
      falar(`Bora, ${perfil.nome}! ${tituloTreino ? tituloTreino + '. ' : ''}Vou te acompanhar a cada 500 metros. Boa corrida!`);
    }
    watchRef.current = navigator.geolocation.watchPosition(
      aoNovaPosicao,
      (err) => {
        console.error('Erro de geolocalização:', err.code, err.message);
        setGpsOk('erro');
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
    timerRef.current = window.setInterval(() => {
      if (estadoRef.current === 'correndo') {
        const decorrido = segAcumuladosRef.current + Math.floor((Date.now() - inicioCorridaRef.current) / 1000);
        segRef.current = decorrido;
        setSegundos(decorrido);
        if (guiado) tickBloco();
      }
    }, 1000);
  }

  function pausar() {
    setEstado('pausado');
    segAcumuladosRef.current = segRef.current; // congela o total de segundos até agora
    ultimaPosRef.current = null; // não somar o deslocamento durante a pausa
    falar('Pausado. Quando quiser, é só retomar.');
  }

  function retomar() {
    setEstado('correndo');
    inicioCorridaRef.current = Date.now(); // reinicia a contagem de wall-clock a partir de agora
    falar('Retomando. Vamos!');
  }

  function terminar() {
    pararSensores();
    wakeLockRef.current?.release().catch(() => {});
    setEstado('fim');
    const km = distRef.current / 1000;
    const ritmo = km > 0.05 ? segRef.current / 60 / km : 0;
    falar(
      km >= 0.2
        ? `Corrida concluída! ${distanciaEmFala(km)} em ${Math.round(segRef.current / 60)} minutos, ritmo médio de ${ritmoEmFala(ritmo)}, ${formatarVelocidade(velocidadeDe(ritmo))} quilômetros por hora. Você mandou muito bem, ${perfil.nome}!`
        : 'Corrida encerrada.',
    );
  }

  function salvar() {
    const km = Math.round((distRef.current / 1000) * 100) / 100;
    const minutos = Math.max(1, Math.round(segRef.current / 60));
    const ritmo = km > 0.05 ? Math.round((segRef.current / 60 / km) * 100) / 100 : undefined;
    const velocidade = ritmo ? Math.round(velocidadeDe(ritmo) * 10) / 10 : undefined;
    const sessao: SessaoTreino = {
      id: uid(),
      nomeTreino: tituloTreino || `Corrida ${km} km`,
      local: 'rua',
      data: new Date().toISOString(),
      duracaoMin: minutos,
      itens: [],
      atividadeLivre: `Corrida de ${km} km em ${minutos} min${ritmo ? ` (ritmo ${formatarRitmo(ritmo)}/km · ${formatarVelocidade(velocidade ?? 0)} km/h)` : ''}`,
      corrida: { distanciaKm: km, duracaoMin: minutos, ritmoMinKm: ritmo, velocidadeKmH: velocidade },
    };
    aoTerminar(sessao);
  }

  const km = distM / 1000;
  const ritmoAtual = km > 0.05 ? segundos / 60 / km : 0;
  const hh = Math.floor(segundos / 3600);
  const mm = String(Math.floor((segundos % 3600) / 60)).padStart(2, '0');
  const ss = String(segundos % 60).padStart(2, '0');
  const etapaAtual = guiado ? diaPlano!.etapas![etapaIdx] : undefined;
  const blocoAtual = etapaAtual?.blocos[blocoIdx];

  return (
    <div className="cartao">
      <div className="player-topo">
        <h2><IconeCorrida size={19} /> {tituloTreino || 'Corrida livre'}</h2>
        {estado !== 'pronto' && (
          <span className={`chip gps-${gpsOk}`}>
            <Satellite size={13} />{' '}
            {gpsOk === 'ok' ? 'GPS ok' : gpsOk === 'erro' ? 'Sem GPS' : gpsOk === 'fraco' ? 'Sinal fraco' : 'Buscando...'}
          </span>
        )}
      </div>

      {estado === 'pronto' && (
        <div className="centro">
          <p>
            {guiado
              ? 'Vou te guiar por voz em cada etapa deste treino — aquecimento, tiros, recuperação e volta à calma — avaliando seu ritmo no caminho.'
              : 'Vou medir sua distância e ritmo pelo GPS e te acompanhar por voz a cada 500 metros.'}
            {!vozDisponivel() && ' (voz indisponível neste navegador)'}
          </p>
          <p className="meta-texto"><Smartphone size={14} /> Mantenha o app aberto durante a corrida — a tela ficará sempre acesa.</p>
          <button className="primario grande" onClick={iniciar}><Rocket size={17} /> Começar a correr</button>
          <button onClick={aoCancelar}>Voltar</button>
        </div>
      )}

      {(estado === 'correndo' || estado === 'pausado') && (
        <div className="centro">
          {guiado && etapaAtual && blocoAtual && (
            <div className="cartao-etapa-corrida">
              <p className="rotulo-descanso">{rotuloEtapa(etapaAtual, blocoAtual, repeticao)}</p>
              <div className="timer">{formatarMMSS(restanteBloco)}</div>
              {faixaAlvoTexto(blocoAtual) && <p className="meta-texto">Ritmo alvo: {faixaAlvoTexto(blocoAtual)}</p>}
            </div>
          )}
          <div className="corrida-metricas">
            <div>
              <small>Distância</small>
              <strong>{km.toFixed(2)} km</strong>
            </div>
            <div>
              <small>Tempo</small>
              <strong>{hh ? `${hh}:` : ''}{mm}:{ss}</strong>
            </div>
            <div>
              <small>Ritmo</small>
              <strong>{formatarRitmo(ritmoAtual)}/km</strong>
            </div>
            <div>
              <small>Velocidade</small>
              <strong>{formatarVelocidade(velocidadeDe(ritmoAtual))} km/h</strong>
            </div>
          </div>
          {estado === 'pausado' && <p className="rotulo-descanso"><IconePausa size={15} /> Pausado</p>}
          <div className="botoes centro-botoes">
            {estado === 'correndo' ? (
              <button onClick={pausar}><IconePausa size={16} /> Pausar</button>
            ) : (
              <button className="primario" onClick={retomar}><IconeComecar size={16} /> Retomar</button>
            )}
            {guiado && estado === 'correndo' && (
              <button className="mini" onClick={pularEtapa}><SkipForward size={14} /> Pular</button>
            )}
            <button className="perigo" onClick={() => { if (confirm('Encerrar a corrida?')) terminar(); }}>
              <IconeParar size={16} /> Encerrar
            </button>
          </div>
        </div>
      )}

      {estado === 'fim' && (
        <div className="centro">
          <h3><PartyPopper size={20} /> Corrida concluída!</h3>
          <p>
            <strong>{km.toFixed(2)} km</strong> em {Math.round(segundos / 60)} min
            {km > 0.05 && (
              <>
                {' '}· ritmo médio <strong>{formatarRitmo(segundos / 60 / km)}/km</strong>
                {' '}· <strong>{formatarVelocidade(velocidadeDe(segundos / 60 / km))} km/h</strong>
              </>
            )}
          </p>
          <button className="primario grande" onClick={salvar}><IconeSalvar size={18} /> Salvar no histórico</button>
          <button onClick={aoCancelar}>Descartar</button>
        </div>
      )}
    </div>
  );
}
