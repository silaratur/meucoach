// Armazenamento de mídias (fotos, vídeos e áudios) no servidor — assim elas
// aparecem em qualquer aparelho, não só no navegador onde foram enviadas.

import { cabecalhos, notificarNaoAutorizado } from './session';

export type TipoMidia = 'foto' | 'video' | 'audio';

export interface MediaRef {
  id: string;
  tipo: TipoMidia;
}

function extensaoDe(mime: string): string {
  return mime.split('/')[1]?.split(';')[0] || 'bin';
}

export async function salvarMidia(blob: Blob, tipo: TipoMidia): Promise<MediaRef> {
  const form = new FormData();
  form.append('tipo', tipo);
  form.append('arquivo', blob, `${tipo}.${extensaoDe(blob.type)}`);
  const resp = await fetch('/api/midia', { method: 'POST', headers: cabecalhos(), body: form });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) notificarNaoAutorizado();
  if (!resp.ok) throw new Error((data as { error?: string }).error || 'Falha ao enviar mídia.');
  return data as MediaRef;
}

export async function obterMidia(id: string): Promise<Blob | null> {
  const resp = await fetch(`/api/midia/${id}`, { headers: cabecalhos() });
  if (resp.status === 401) notificarNaoAutorizado();
  if (!resp.ok) return null;
  return resp.blob();
}

const urlCache = new Map<string, string>();

export async function urlMidia(id: string): Promise<string | null> {
  if (urlCache.has(id)) return urlCache.get(id)!;
  const blob = await obterMidia(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

// Imagem ilustrativa do exercício, gerada por IA e cacheada no SERVIDOR por nome (todas as
// pessoas reaproveitam a mesma imagem pro mesmo exercício — evita gerar/pagar de novo).
// O cache aqui no cliente é só a URL de objeto local, pra não refazer a requisição a cada
// re-render do mesmo exercício durante a sessão.
const urlImagemExercicioCache = new Map<string, string>();

export async function urlImagemExercicio(nomeExercicio: string): Promise<string | null> {
  if (urlImagemExercicioCache.has(nomeExercicio)) return urlImagemExercicioCache.get(nomeExercicio)!;
  const resp = await fetch(`/api/exercicio-imagem?nome=${encodeURIComponent(nomeExercicio)}`, { headers: cabecalhos() });
  if (resp.status === 401) notificarNaoAutorizado();
  if (!resp.ok) return null;
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  urlImagemExercicioCache.set(nomeExercicio, url);
  return url;
}

export async function excluirMidia(id: string): Promise<void> {
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
  await fetch(`/api/midia/${id}`, { method: 'DELETE', headers: cabecalhos() }).catch(() => {});
}

export async function excluirMidias(refs: MediaRef[] | undefined): Promise<void> {
  for (const r of refs ?? []) await excluirMidia(r.id).catch(() => {});
}

// Reduz a foto para no máximo 1280px e JPEG 80% — economiza espaço e
// deixa o arquivo pequeno o bastante para enviar à IA.
export async function comprimirImagem(file: Blob, maxLado = 1280): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * escala);
  const h = Math.round(bitmap.height * escala);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.8),
  );
}

export function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Extrai 1 frame de um vídeo (do meio da gravação, pra evitar tela preta do início) como
// JPEG base64 — a IA só analisa imagem, então um vídeo do wearable precisa virar foto primeiro.
export function extrairFrameDeVideo(blob: Blob): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(blob);
    video.src = url;
    const limpar = () => URL.revokeObjectURL(url);
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, (video.duration || 2) / 2);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Sem suporte a canvas neste navegador.');
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        limpar();
        resolve({ base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' });
      } catch (e) {
        limpar();
        reject(e as Error);
      }
    };
    video.onerror = () => {
      limpar();
      reject(new Error('Não consegui ler esse vídeo.'));
    };
  });
}
