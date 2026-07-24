import { useEffect, useRef, useState } from 'react';
import type { MediaRef, TipoMidia } from '../media';
import { comprimirImagem, salvarMidia, urlMidia } from '../media';
import { IconeCamera, IconeGaleria, IconeNotaAudio, IconeParar, IconeVideo } from './Icones';

// ---------- Botões para anexar foto / vídeo / áudio ----------
interface PickerProps {
  aoAdicionar: (ref: MediaRef) => void;
  tipos?: TipoMidia[];
  compacto?: boolean; // botões só com ícone (sem texto) — pra economizar espaço vertical
}

export function MediaPicker({ aoAdicionar, tipos = ['foto', 'video', 'audio'], compacto = false }: PickerProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const [gravando, setGravando] = useState(false);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);

  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>, tipo: TipoMidia) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const blob = tipo === 'foto' ? await comprimirImagem(file) : file;
      if (tipo !== 'foto' && blob.size > 60 * 1024 * 1024) {
        alert('Arquivo muito grande (máx. 60 MB). Grave um trecho mais curto.');
        return;
      }
      aoAdicionar(await salvarMidia(blob, tipo));
    } catch {
      alert('Não consegui salvar esse arquivo.');
    }
  }

  async function alternarGravacao() {
    if (gravando) {
      gravadorRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const gravador = new MediaRecorder(stream);
      pedacosRef.current = [];
      gravador.ondataavailable = (ev) => ev.data.size && pedacosRef.current.push(ev.data);
      gravador.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(false);
        const blob = new Blob(pedacosRef.current, { type: gravador.mimeType || 'audio/webm' });
        if (blob.size > 0) aoAdicionar(await salvarMidia(blob, 'audio'));
      };
      gravadorRef.current = gravador;
      gravador.start();
      setGravando(true);
    } catch {
      // sem microfone/permissão: cai para escolher arquivo
      audioRef.current?.click();
    }
  }

  return (
    <div className={`media-picker${compacto ? ' compacto' : ''}`}>
      {tipos.includes('foto') && (
        <>
          <button type="button" onClick={() => cameraRef.current?.click()} title="Câmera">
            <IconeCamera size={17} />{!compacto && ' Câmera'}
          </button>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => aoEscolher(e, 'foto')} />
          <button type="button" onClick={() => galeriaRef.current?.click()} title="Galeria">
            <IconeGaleria size={17} />{!compacto && ' Galeria'}
          </button>
          <input ref={galeriaRef} type="file" accept="image/*" hidden onChange={(e) => aoEscolher(e, 'foto')} />
        </>
      )}
      {tipos.includes('video') && (
        <>
          <button type="button" onClick={() => videoRef.current?.click()} title="Vídeo">
            <IconeVideo size={17} />{!compacto && ' Vídeo'}
          </button>
          <input ref={videoRef} type="file" accept="video/*" capture="environment" hidden onChange={(e) => aoEscolher(e, 'video')} />
        </>
      )}
      {tipos.includes('audio') && (
        <>
          <button type="button" className={gravando ? 'gravando' : ''} onClick={alternarGravacao} title={gravando ? 'Parar gravação' : 'Áudio'}>
            {gravando ? <IconeParar size={17} /> : <IconeNotaAudio size={17} />}{!compacto && (gravando ? '' : ' Áudio')}
          </button>
          <input ref={audioRef} type="file" accept="audio/*" hidden onChange={(e) => aoEscolher(e, 'audio')} />
        </>
      )}
    </div>
  );
}

// ---------- Galeria de mídias anexadas ----------
interface GaleriaProps {
  midias: MediaRef[] | undefined;
  aoRemover?: (ref: MediaRef) => void;
}

export function MediaGallery({ midias, aoRemover }: GaleriaProps) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [ampliada, setAmpliada] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    (async () => {
      const novo: Record<string, string> = {};
      for (const m of midias ?? []) {
        const u = await urlMidia(m.id);
        if (u) novo[m.id] = u;
      }
      if (ativo) setUrls(novo);
    })();
    return () => {
      ativo = false;
    };
  }, [midias]);

  if (!midias?.length) return null;

  return (
    <div className="media-galeria">
      {midias.map((m) => {
        const url = urls[m.id];
        if (!url) return null;
        return (
          <div key={m.id} className="media-item">
            {m.tipo === 'foto' && (
              <img src={url} alt="Foto anexada" onClick={() => setAmpliada(url)} />
            )}
            {m.tipo === 'video' && <video src={url} controls playsInline preload="metadata" />}
            {m.tipo === 'audio' && <audio src={url} controls preload="metadata" />}
            {aoRemover && (
              <button className="mini remover-midia" onClick={() => aoRemover(m)}>✕</button>
            )}
          </div>
        );
      })}
      {ampliada && (
        <div className="media-lightbox" onClick={() => setAmpliada(null)}>
          <img src={ampliada} alt="Foto ampliada" />
        </div>
      )}
    </div>
  );
}
