import { useEffect, useRef, useState } from 'react';
import type { Perfil, SessaoTreino } from '../types';
import { uid } from '../storage';
import { bip, falar, silenciar, vozDisponivel } from '../speech';
import { IconeComecar, IconeParar, IconePausa, IconeSalvar } from './Icones';

interface Props {
  perfil: Perfil;
  tituloTreino?: string; // dia do plano sendo executado, se houver
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

export default function RunPlayer({ perfil, tituloTreino, aoTerminar, aoCancelar }: Props) {
  const [estado, setEstado] = useState<'pronto' | 'correndo' | 'pausado' | 'fim'>('pronto');
  const [distM, setDistM] = useState(0);
  const [segundos, setSegundos] = useState(0);
  const [gpsOk, setGpsOk] = useState<'aguardando' | 'ok' | 'erro'>('aguardando');

  const ultimaPosRef = useRef<GeolocationCoordinates | null>(null);
  const watchRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const proximoAnuncioRef = useRef(500); // anuncia a cada 500 m
  const distRef = useRef(0);
  const segRef = useRef(0);
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

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
    setGpsOk('ok');
    if (estadoRef.current !== 'correndo') return;
    const c = pos.coords;
    if (c.accuracy > 35) return; // sinal ruim — ignora
    const anterior = ultimaPosRef.current;
    ultimaPosRef.current = c;
    if (!anterior) return;
    const passo = distanciaM(anterior, c);
    if (passo < 1 || passo > 120) return; // parado ou salto de GPS
    distRef.current += passo;
    setDistM(distRef.current);
    if (distRef.current >= proximoAnuncioRef.current) {
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

  function iniciar() {
    if (!navigator.geolocation) {
      setGpsOk('erro');
      alert('GPS não disponível neste aparelho/navegador.');
      return;
    }
    setEstado('correndo');
    manterTelaAcesa();
    falar(`Bora, ${perfil.nome}! ${tituloTreino ? tituloTreino + '. ' : ''}Vou te acompanhar a cada 500 metros. Boa corrida!`);
    watchRef.current = navigator.geolocation.watchPosition(aoNovaPosicao, () => setGpsOk('erro'), {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000,
    });
    timerRef.current = window.setInterval(() => {
      if (estadoRef.current === 'correndo') {
        segRef.current += 1;
        setSegundos(segRef.current);
      }
    }, 1000);
  }

  function pausar() {
    setEstado('pausado');
    ultimaPosRef.current = null; // não somar o deslocamento durante a pausa
    falar('Pausado. Quando quiser, é só retomar.');
  }

  function retomar() {
    setEstado('correndo');
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

  return (
    <div className="cartao">
      <div className="player-topo">
        <h2>🏃 {tituloTreino || 'Corrida livre'}</h2>
        {estado !== 'pronto' && (
          <span className={`chip gps-${gpsOk}`}>
            {gpsOk === 'ok' ? '📡 GPS ok' : gpsOk === 'erro' ? '📡 Sem GPS' : '📡 Buscando...'}
          </span>
        )}
      </div>

      {estado === 'pronto' && (
        <div className="centro">
          <p>
            Vou medir sua distância e ritmo pelo GPS e te acompanhar por voz a cada 500 metros.
            {!vozDisponivel() && ' (voz indisponível neste navegador)'}
          </p>
          <p className="meta-texto">📱 Mantenha o app aberto durante a corrida — a tela ficará sempre acesa.</p>
          <button className="primario grande" onClick={iniciar}>🚀 Começar a correr</button>
          <button onClick={aoCancelar}>Voltar</button>
        </div>
      )}

      {(estado === 'correndo' || estado === 'pausado') && (
        <div className="centro">
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
          {estado === 'pausado' && <p className="rotulo-descanso">⏸️ Pausado</p>}
          <div className="botoes centro-botoes">
            {estado === 'correndo' ? (
              <button onClick={pausar}><IconePausa size={16} /> Pausar</button>
            ) : (
              <button className="primario" onClick={retomar}><IconeComecar size={16} /> Retomar</button>
            )}
            <button className="perigo" onClick={() => { if (confirm('Encerrar a corrida?')) terminar(); }}>
              <IconeParar size={16} /> Encerrar
            </button>
          </div>
        </div>
      )}

      {estado === 'fim' && (
        <div className="centro">
          <h3>🎉 Corrida concluída!</h3>
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
