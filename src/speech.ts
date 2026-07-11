// Voz do personal: usa a síntese de fala nativa do Android/navegador (pt-BR, offline).

let vozPtBr: SpeechSynthesisVoice | null = null;
let habilitado = true;

function escolherVoz() {
  const vozes = window.speechSynthesis?.getVoices() ?? [];
  const pt = vozes.filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('pt-br'));
  const qualquerPt = vozes.filter((v) => v.lang.toLowerCase().startsWith('pt'));
  // Preferência: vozes "Natural" (Edge/Windows) > Google (Android/Chrome) > local > qualquer pt
  vozPtBr =
    pt.find((v) => /natural/i.test(v.name)) ||
    pt.find((v) => /google/i.test(v.name)) ||
    pt.find((v) => /luciana|felipe|maria|francisca|camila/i.test(v.name)) ||
    pt.find((v) => v.localService) ||
    pt[0] ||
    qualquerPt[0] ||
    null;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  escolherVoz();
  window.speechSynthesis.onvoiceschanged = escolherVoz;
}

export function vozDisponivel(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function definirVozHabilitada(on: boolean) {
  habilitado = on;
  if (!on) window.speechSynthesis?.cancel();
}

export function falar(texto: string, opcoes?: { fila?: boolean; rapida?: boolean; aoTerminar?: () => void }) {
  if (!habilitado || !vozDisponivel()) {
    opcoes?.aoTerminar?.();
    return;
  }
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = 'pt-BR';
  if (vozPtBr) u.voice = vozPtBr;
  u.rate = opcoes?.rapida ? 1.15 : 1.0; // ritmo natural, menos robótico
  u.pitch = 1.02;
  if (opcoes?.aoTerminar) u.onend = opcoes.aoTerminar;
  if (!opcoes?.fila) window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export function silenciar() {
  window.speechSynthesis?.cancel();
}

// Converte a notação de repetições em fala natural:
// "8-12" → "entre 8 e 12 repetições" · "15" → "15 repetições" · "30s" → "30 segundos"
export function repeticoesEmFala(repeticoes: string): string {
  const txt = repeticoes.trim();
  const faixa = txt.match(/^(\d+)\s*[-–a]\s*(\d+)/);
  if (faixa) return `entre ${faixa[1]} e ${faixa[2]} repetições`;
  const segundos = txt.match(/^(\d+)\s*(s|seg)/i);
  if (segundos) return `${segundos[1]} segundos`;
  const numero = txt.match(/^(\d+)/);
  if (numero) return `${numero[1]} repetições`;
  return txt;
}

// Bip de fim de descanso via WebAudio (funciona mesmo sem voz).
let audioCtx: AudioContext | null = null;

export function bip(vezes = 1) {
  try {
    audioCtx = audioCtx || new AudioContext();
    for (let i = 0; i < vezes; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 880;
      const t = audioCtx.currentTime + i * 0.3;
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.start(t);
      osc.stop(t + 0.22);
    }
  } catch {
    // sem áudio disponível
  }
}

// ---------- Ditado por voz (fala → texto, nativo do Android/Chrome) ----------
type ReconhecimentoCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

function ctorDitado(): ReconhecimentoCtor | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition as ReconhecimentoCtor) || (w.webkitSpeechRecognition as ReconhecimentoCtor) || null;
}

export function ditadoDisponivel(): boolean {
  return typeof window !== 'undefined' && !!ctorDitado();
}

// Inicia o ditado; retorna uma função para parar. Chama aoTexto com cada trecho final reconhecido.
export function iniciarDitado(aoTexto: (t: string) => void, aoFim: () => void): (() => void) | null {
  const Ctor = ctorDitado();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = 'pt-BR';
  rec.continuous = true;
  rec.interimResults = false;
  rec.onresult = (ev) => {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) aoTexto(r[0].transcript.trim());
    }
  };
  rec.onend = aoFim;
  rec.onerror = () => aoFim();
  try {
    rec.start();
  } catch {
    return null;
  }
  return () => rec.stop();
}

// Escuta uma resposta curta do usuário por alguns segundos e devolve o texto ouvido.
// Usado no coach conversacional ("o peso ficou bom?").
export function ouvirResposta(timeoutMs: number, aoResultado: (texto: string | null) => void): () => void {
  if (!ditadoDisponivel()) {
    aoResultado(null);
    return () => {};
  }
  let respondeu = false;
  let parar: (() => void) | null = null;
  const terminar = (texto: string | null) => {
    if (respondeu) return;
    respondeu = true;
    parar?.();
    aoResultado(texto);
  };
  parar = iniciarDitado(
    (texto) => terminar(texto),
    () => terminar(null),
  );
  const timer = setTimeout(() => terminar(null), timeoutMs);
  return () => {
    clearTimeout(timer);
    terminar(null);
  };
}

const INCENTIVOS = [
  'Boa! Série concluída. Você está mandando muito bem!',
  'Excelente! Continue com essa energia!',
  'Mais uma pra conta. Seu futuro eu agradece!',
  'Muito bem! Respira fundo e mantém o foco.',
  'Isso aí! Cada série te deixa mais forte.',
  'Ótimo ritmo! A constância é o segredo.',
  'Mandou bem demais! Hidrata aí rapidinho.',
];

export function incentivoAleatorio(): string {
  return INCENTIVOS[Math.floor(Math.random() * INCENTIVOS.length)];
}

// Incentivos curtinhos falados NO MEIO da contagem de repetições, sem atrasar o ritmo.
const INCENTIVOS_CURTOS = ['Isso!', 'Boa!', 'Força!', 'Capricha!', 'Controla!', 'Respira!', 'Segue firme!', 'Tá lindo!'];

export function incentivoCurto(): string {
  return INCENTIVOS_CURTOS[Math.floor(Math.random() * INCENTIVOS_CURTOS.length)];
}
