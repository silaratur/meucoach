// Acompanha um job de IA em background (geração de plano de treino/corrida/dieta) por polling —
// rede de segurança pra quando o app fica aberto em primeiro plano; quem cobre o app em segundo
// plano/tela bloqueada é o push notification que o servidor dispara ao concluir.
import { statusJobIA } from './api';

export function acompanharJobIA(jobId: string, aoConcluir: () => void, aoErro: (msg: string) => void): () => void {
  const intervalo = setInterval(async () => {
    try {
      const r = await statusJobIA(jobId);
      if (r.status === 'concluido') {
        clearInterval(intervalo);
        aoConcluir();
      } else if (r.status === 'falhou') {
        clearInterval(intervalo);
        aoErro(r.erro || 'Falha ao gerar.');
      }
    } catch {
      // rede instável — tenta de novo no próximo tick
    }
  }, 5000);
  return () => clearInterval(intervalo);
}
