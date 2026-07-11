import { useMemo, useState } from 'react';
import type { DadosPerfil, Perfil, Pesagem } from '../types';
import { hojeISO } from '../storage';
import { recordesPessoais } from '../calc';
import { analisarAtividadeFoto, analisarBalanca, avaliarSono } from '../api';
import type { MediaRef } from '../media';
import { blobParaBase64, excluirMidias, extrairFrameDeVideo, obterMidia } from '../media';
import { MediaGallery, MediaPicker } from './Midia';
import { IconeAdicionar } from './Icones';

interface Props {
  perfil: Perfil;
  dados: DadosPerfil;
  atualizar: (m: (d: DadosPerfil) => DadosPerfil) => void;
  aoMudarPeso: (pesoKg: number) => void;
}

interface Ponto {
  rotulo: string; // data curta "dd/mm"
  valor: number;
}

// ---------- Gráfico de linha em SVG puro (sem bibliotecas) ----------
function GraficoLinha({ pontos, unidade, cor = '#16a34a' }: { pontos: Ponto[]; unidade: string; cor?: string }) {
  // Toque/hover num ponto mostra o valor exato — os pontos por si só não deixavam claro
  // o número, só a tendência da linha.
  const [ativo, setAtivo] = useState<number | null>(null);
  if (pontos.length < 2) {
    return <p className="vazio">Registre pelo menos 2 valores para ver o gráfico.</p>;
  }
  const W = 340;
  const H = 150;
  const PAD = { esq: 38, dir: 10, topo: 12, baixo: 22 };
  const valores = pontos.map((p) => p.valor);
  let min = Math.min(...valores);
  let max = Math.max(...valores);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const folga = (max - min) * 0.1;
  min -= folga;
  max += folga;

  const x = (i: number) => PAD.esq + (i * (W - PAD.esq - PAD.dir)) / (pontos.length - 1);
  const y = (v: number) => PAD.topo + ((max - v) * (H - PAD.topo - PAD.baixo)) / (max - min);
  const caminho = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ');
  const pontoAtivo = ativo != null ? pontos[ativo] : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="grafico" role="img" onMouseLeave={() => setAtivo(null)}>
      {/* linhas de referência */}
      {[min + folga, (min + max) / 2, max - folga].map((v, i) => (
        <g key={i}>
          <line x1={PAD.esq} y1={y(v)} x2={W - PAD.dir} y2={y(v)} stroke="var(--borda)" strokeWidth="1" />
          <text x={PAD.esq - 4} y={y(v) + 3.5} textAnchor="end" fontSize="9" fill="var(--texto-suave)">
            {v.toFixed(1)}
          </text>
        </g>
      ))}
      <path d={caminho} fill="none" stroke={cor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pontos.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.valor)} r={ativo === i ? 4.5 : 3} fill={cor} />
      ))}
      {/* rótulos: primeira, meio e última data */}
      {[0, Math.floor((pontos.length - 1) / 2), pontos.length - 1]
        .filter((v, i, a) => a.indexOf(v) === i)
        .map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--texto-suave)">
            {pontos[i].rotulo}
          </text>
        ))}
      <text x={W - PAD.dir} y={PAD.topo} textAnchor="end" fontSize="9" fill="var(--texto-suave)">
        {unidade}
      </text>
      {/* área de toque maior que o ponto visível — mais fácil de acertar no dedo */}
      {pontos.map((p, i) => (
        <circle
          key={`hit-${i}`}
          cx={x(i)}
          cy={y(p.valor)}
          r={11}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => setAtivo(i)}
          onClick={() => setAtivo((a) => (a === i ? null : i))}
        />
      ))}
      {pontoAtivo && ativo != null && (
        <g>
          <rect
            x={Math.min(Math.max(x(ativo) - 32, PAD.esq), W - PAD.dir - 64)}
            y={Math.max(y(pontoAtivo.valor) - 26, 2)}
            width="64"
            height="17"
            rx="4"
            fill="var(--texto)"
          />
          <text
            x={Math.min(Math.max(x(ativo), PAD.esq + 32), W - PAD.dir - 32)}
            y={Math.max(y(pontoAtivo.valor) - 13.5, 15)}
            textAnchor="middle"
            fontSize="9"
            fontWeight="700"
            fill="var(--fundo)"
          >
            {pontoAtivo.valor}{unidade} · {pontoAtivo.rotulo}
          </text>
        </g>
      )}
    </svg>
  );
}

// ---------- Gráfico de barras ----------
function GraficoBarras({ pontos, cor = '#22c55e' }: { pontos: Ponto[]; cor?: string }) {
  // Toque numa barra destaca ela e escurece as outras, e mostra o valor mesmo quando é 0
  // (antes, barras zeradas não tinham nenhuma leitura possível).
  const [ativo, setAtivo] = useState<number | null>(null);
  const W = 340;
  const H = 130;
  const PAD = { esq: 10, dir: 10, topo: 14, baixo: 22 };
  const max = Math.max(1, ...pontos.map((p) => p.valor));
  const larguraBarra = (W - PAD.esq - PAD.dir) / pontos.length - 6;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="grafico" role="img" onMouseLeave={() => setAtivo(null)}>
      {pontos.map((p, i) => {
        const bx = PAD.esq + i * ((W - PAD.esq - PAD.dir) / pontos.length) + 3;
        const alt = (p.valor / max) * (H - PAD.topo - PAD.baixo);
        const by = H - PAD.baixo - alt;
        const destacado = ativo === i;
        return (
          <g
            key={i}
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setAtivo(i)}
            onClick={() => setAtivo((a) => (a === i ? null : i))}
          >
            <rect x={bx} y={PAD.topo} width={larguraBarra} height={H - PAD.topo - PAD.baixo} fill="transparent" />
            <rect
              x={bx}
              y={by}
              width={larguraBarra}
              height={Math.max(alt, 1)}
              rx="3"
              fill={p.valor ? cor : 'var(--borda)'}
              opacity={ativo === null || destacado ? 1 : 0.4}
              stroke={destacado ? 'var(--texto)' : 'none'}
              strokeWidth={destacado ? 1.5 : 0}
            />
            {(p.valor > 0 || destacado) && (
              <text x={bx + larguraBarra / 2} y={by - 3} textAnchor="middle" fontSize="9" fontWeight={destacado ? 700 : 400} fill="var(--texto)">
                {p.valor}
              </text>
            )}
            <text x={bx + larguraBarra / 2} y={H - 6} textAnchor="middle" fontSize="8.5" fill="var(--texto-suave)">
              {p.rotulo}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function rotuloCurto(dataISO: string): string {
  return `${dataISO.slice(8, 10)}/${dataISO.slice(5, 7)}`;
}

export default function EvolucaoTab({ perfil, dados, atualizar, aoMudarPeso }: Props) {
  const [pesoNovo, setPesoNovo] = useState('');
  const [analisando, setAnalisando] = useState(false);
  const [leitura, setLeitura] = useState('');
  const [erro, setErro] = useState('');

  // Foto da balança → IA lê o visor e registra a pesagem completa
  async function fotoBalanca(ref: MediaRef) {
    setAnalisando(true);
    setErro('');
    setLeitura('');
    try {
      const blob = await obterMidia(ref.id);
      if (!blob) throw new Error('Foto não encontrada.');
      const base64 = await blobParaBase64(blob);
      const r = await analisarBalanca(perfil, base64, blob.type || 'image/jpeg');
      if (!r.ehBalanca || !r.pesoKg || r.pesoKg <= 0) {
        excluirMidias([ref]);
        setErro('🤖 ' + (r.observacao || 'Não consegui ler os números dessa foto. Tente com o visor mais nítido.'));
        return;
      }
      const data = hojeISO();
      const nova: Pesagem = {
        data,
        pesoKg: r.pesoKg,
        imc: r.imc,
        gorduraPct: r.gorduraPct,
        massaMagraKg: r.massaMagraKg,
        musculoKg: r.musculoKg,
        aguaPct: r.aguaPct,
        gorduraVisceral: r.gorduraVisceral,
        metabolismoKcal: r.metabolismoKcal,
        midias: [ref],
      };
      atualizar((d) => {
        const anterior = d.pesagens.find((p) => p.data === data);
        if (anterior?.midias?.length) excluirMidias(anterior.midias.filter((m) => m.id !== ref.id));
        return { ...d, pesagens: [...d.pesagens.filter((p) => p.data !== data), nova] };
      });
      aoMudarPeso(r.pesoKg);
      setLeitura('🤖 ' + r.observacao);
    } catch (e) {
      excluirMidias([ref]);
      setErro((e as Error).message);
    } finally {
      setAnalisando(false);
    }
  }

  // Foto OU vídeo (extrai 1 frame) — a IA só analisa imagem, então vídeo vira frame primeiro.
  async function base64DeMidia(ref: MediaRef): Promise<{ base64: string; mediaType: string }> {
    const blob = await obterMidia(ref.id);
    if (!blob) throw new Error('Mídia não encontrada.');
    if (ref.tipo === 'video') return extrairFrameDeVideo(blob);
    return { base64: await blobParaBase64(blob), mediaType: blob.type || 'image/jpeg' };
  }

  // ----- Sono por foto/vídeo (análise de coach, integrada ao treino e alimentação) -----
  const [analisandoSono, setAnalisandoSono] = useState(false);
  const [resumoSono, setResumoSono] = useState('');
  const [erroSono, setErroSono] = useState('');

  async function fotoSonoRetroativa(ref: MediaRef) {
    setAnalisandoSono(true);
    setErroSono('');
    setResumoSono('');
    try {
      const { base64, mediaType } = await base64DeMidia(ref);
      const dataRef = hojeISO();
      const r = await avaliarSono(perfil, base64, mediaType);
      excluirMidias([ref]);
      if (!r.ehSono || !r.sonoHoras || r.sonoHoras <= 0) {
        setErroSono('🤖 ' + (r.comentario || 'Não consegui ler os dados de sono nessa mídia.'));
        return;
      }
      const data = r.data || dataRef;
      atualizar((d) => {
        const porData = new Map(d.atividadesDiarias.map((a) => [a.data, a]));
        const atual = porData.get(data) ?? { data, fonte: 'foto' };
        porData.set(data, { ...atual, sonoHoras: r.sonoHoras, sonoQualidade: r.sonoQualidade, frequenciaCardiacaMedia: r.frequenciaCardiacaMedia || atual.frequenciaCardiacaMedia, fonte: 'foto' });
        return { ...d, atividadesDiarias: [...porData.values()].sort((a, b) => a.data.localeCompare(b.data)) };
      });
      setResumoSono('🤖 ' + r.comentario);
    } catch (err) {
      setErroSono((err as Error).message);
    } finally {
      setAnalisandoSono(false);
    }
  }

  const [analisandoAtividade, setAnalisandoAtividade] = useState(false);
  const [resumoAtividadeFoto, setResumoAtividadeFoto] = useState('');
  const [erroAtividade, setErroAtividade] = useState('');

  async function fotoAtividade(ref: MediaRef) {
    setAnalisandoAtividade(true);
    setErroAtividade('');
    setResumoAtividadeFoto('');
    try {
      const { base64, mediaType } = await base64DeMidia(ref);
      const r = await analisarAtividadeFoto(perfil, base64, mediaType);
      excluirMidias([ref]);
      if (!r.ehIndicadorAtividade) {
        setErroAtividade('🤖 ' + r.comentario);
        return;
      }
      const data = r.data || hojeISO();
      atualizar((d) => {
        const porData = new Map(d.atividadesDiarias.map((a) => [a.data, a]));
        const atual = porData.get(data) ?? { data, fonte: 'foto' };
        porData.set(data, { ...atual, passos: r.passos || atual.passos, calorias: r.calorias || atual.calorias, minutosAtivos: r.minutosAtivos || atual.minutosAtivos, fonte: 'foto' });
        return { ...d, atividadesDiarias: [...porData.values()].sort((a, b) => a.data.localeCompare(b.data)) };
      });
      setResumoAtividadeFoto('🤖 ' + r.comentario);
    } catch (err) {
      setErroAtividade((err as Error).message);
    } finally {
      setAnalisandoAtividade(false);
    }
  }

  const atividadesOrdenadas = useMemo(
    () => [...dados.atividadesDiarias].sort((a, b) => a.data.localeCompare(b.data)).slice(-14),
    [dados.atividadesDiarias],
  );
  const pontosPassos: Ponto[] = atividadesOrdenadas
    .filter((a) => typeof a.passos === 'number')
    .map((a) => ({ rotulo: rotuloCurto(a.data), valor: a.passos! }));
  const pontosSono: Ponto[] = atividadesOrdenadas
    .filter((a) => typeof a.sonoHoras === 'number')
    .map((a) => ({ rotulo: rotuloCurto(a.data), valor: a.sonoHoras! }));

  // ----- peso -----
  const pesagens = useMemo(() => [...dados.pesagens].sort((a, b) => a.data.localeCompare(b.data)), [dados.pesagens]);
  const pontosPeso: Ponto[] = pesagens.map((p) => ({ rotulo: rotuloCurto(p.data), valor: p.pesoKg }));

  function registrarPeso() {
    const v = parseFloat(pesoNovo.replace(',', '.'));
    if (!v || v < 20 || v > 400) {
      alert('Digite um peso válido em kg.');
      return;
    }
    const data = hojeISO();
    atualizar((d) => ({
      ...d,
      pesagens: [...d.pesagens.filter((p) => p.data !== data), { data, pesoKg: v }],
    }));
    aoMudarPeso(v);
    setPesoNovo('');
  }

  // ----- recordes pessoais -----
  const recordes = useMemo(() => recordesPessoais(dados.sessoes), [dados.sessoes]);

  // ----- progressão de carga por exercício -----
  const exerciciosComCarga = useMemo(() => {
    const mapa = new Map<string, { rotulo: string; valor: number }[]>();
    for (const s of [...dados.sessoes].sort((a, b) => a.data.localeCompare(b.data))) {
      for (const item of s.itens) {
        const cargas = item.seriesFeitas.map((x) => x.cargaKg).filter((c): c is number => !!c && c > 0);
        if (!cargas.length) continue;
        const nome = item.nome.trim();
        if (!mapa.has(nome)) mapa.set(nome, []);
        mapa.get(nome)!.push({ rotulo: rotuloCurto(s.data.slice(0, 10)), valor: Math.max(...cargas) });
      }
    }
    return [...mapa.entries()].filter(([, pts]) => pts.length >= 1);
  }, [dados.sessoes]);

  const [exercicioSel, setExercicioSel] = useState('');
  const exercicioAtivo = exercicioSel || exerciciosComCarga[0]?.[0] || '';
  const pontosCarga = exerciciosComCarga.find(([nome]) => nome === exercicioAtivo)?.[1] ?? [];

  // ----- frequência semanal (últimas 8 semanas) -----
  const frequencia: Ponto[] = useMemo(() => {
    const semanas: Ponto[] = [];
    const agora = new Date();
    // domingo da semana atual
    const inicioSemanaAtual = new Date(agora);
    inicioSemanaAtual.setDate(agora.getDate() - agora.getDay());
    inicioSemanaAtual.setHours(0, 0, 0, 0);
    for (let i = 7; i >= 0; i--) {
      const inicio = new Date(inicioSemanaAtual);
      inicio.setDate(inicio.getDate() - i * 7);
      const fim = new Date(inicio);
      fim.setDate(fim.getDate() + 7);
      const qtd = dados.sessoes.filter((s) => {
        const d = new Date(s.data);
        return d >= inicio && d < fim;
      }).length;
      semanas.push({ rotulo: `${String(inicio.getDate()).padStart(2, '0')}/${String(inicio.getMonth() + 1).padStart(2, '0')}`, valor: qtd });
    }
    return semanas;
  }, [dados.sessoes]);

  const ultimoPeso = pesagens[pesagens.length - 1];
  const primeiroPeso = pesagens[0];
  const variacao = ultimoPeso && primeiroPeso ? ultimoPeso.pesoKg - primeiroPeso.pesoKg : 0;

  const pontosGordura: Ponto[] = pesagens
    .filter((p) => typeof p.gorduraPct === 'number')
    .map((p) => ({ rotulo: rotuloCurto(p.data), valor: p.gorduraPct! }));
  const pontosMassaMagra: Ponto[] = pesagens
    .filter((p) => typeof p.massaMagraKg === 'number')
    .map((p) => ({ rotulo: rotuloCurto(p.data), valor: p.massaMagraKg! }));
  const ultimaComDetalhe = [...pesagens].reverse().find((p) => p.imc || p.gorduraPct || p.massaMagraKg || p.aguaPct);

  return (
    <div>
      <div className="cartao">
        <h2>⚖️ Peso e bioimpedância</h2>
        <p className="meta-texto">
          📷 Tire uma foto do <strong>visor da balança</strong> (ou do app dela) que eu leio tudo: peso, gordura,
          massa magra, água, IMC...
        </p>
        <MediaPicker tipos={['foto']} aoAdicionar={fotoBalanca} />
        {analisando && <p className="vazio">🤖 Lendo os números da balança...</p>}
        {leitura && <p className="leitura-balanca">{leitura}</p>}
        {erro && <p className="erro">{erro}</p>}

        <label>Ou registre só o peso manualmente</label>
        <div className="linha-add">
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={pesoNovo}
            onChange={(e) => setPesoNovo(e.target.value)}
            placeholder={`Peso de hoje (kg)${perfil.pesoKg ? ` — último: ${perfil.pesoKg}` : ''}`}
          />
          <button className="primario" onClick={registrarPeso}><IconeAdicionar size={17} /></button>
        </div>
        {pesagens.length > 0 && (
          <p className="resumo-evolucao">
            Atual: <strong>{ultimoPeso.pesoKg} kg</strong>
            {pesagens.length > 1 && (
              <> · desde {rotuloCurto(primeiroPeso.data)}: <strong className={variacao <= 0 ? 'bom' : 'atencao'}>
                {variacao > 0 ? '+' : ''}{variacao.toFixed(1)} kg
              </strong></>
            )}
          </p>
        )}
        <GraficoLinha pontos={pontosPeso} unidade="kg" />
      </div>

      {ultimaComDetalhe && (
        <div className="cartao">
          <h2>🧬 Última bioimpedância ({rotuloCurto(ultimaComDetalhe.data)})</h2>
          <div className="grade-metricas">
            {ultimaComDetalhe.imc != null && <div><small>IMC</small><strong>{ultimaComDetalhe.imc.toFixed(1)}</strong></div>}
            {ultimaComDetalhe.gorduraPct != null && <div><small>Gordura</small><strong>{ultimaComDetalhe.gorduraPct.toFixed(1)}%</strong></div>}
            {ultimaComDetalhe.massaMagraKg != null && <div><small>Massa magra</small><strong>{ultimaComDetalhe.massaMagraKg.toFixed(1)} kg</strong></div>}
            {ultimaComDetalhe.musculoKg != null && <div><small>Músculo</small><strong>{ultimaComDetalhe.musculoKg.toFixed(1)} kg</strong></div>}
            {ultimaComDetalhe.aguaPct != null && <div><small>Água</small><strong>{ultimaComDetalhe.aguaPct.toFixed(1)}%</strong></div>}
            {ultimaComDetalhe.gorduraVisceral != null && <div><small>G. visceral</small><strong>{ultimaComDetalhe.gorduraVisceral}</strong></div>}
            {ultimaComDetalhe.metabolismoKcal != null && <div><small>Metabolismo</small><strong>{Math.round(ultimaComDetalhe.metabolismoKcal)} kcal</strong></div>}
          </div>
          <MediaGallery midias={ultimaComDetalhe.midias} />
        </div>
      )}

      <div className="cartao">
        <h2>📲 Atividade e sono</h2>
        <p className="meta-texto">
          Envie uma foto ou vídeo do seu sono e da sua atividade (Samsung Health ou similar) — o Coach analisa e
          essa informação entra direto na recomendação de treino e alimentação dos próximos dias.
        </p>
        <label>😴 Sono (foto ou vídeo do wearable)</label>
        <MediaPicker tipos={['foto', 'video']} aoAdicionar={fotoSonoRetroativa} />
        {analisandoSono && <p className="vazio">🤖 Analisando o sono...</p>}
        {resumoSono && <p className="leitura-balanca">{resumoSono}</p>}
        {erroSono && <p className="erro">{erroSono}</p>}

        <label>🏃 Atividade (foto ou vídeo — passos, tempo ativo, calorias)</label>
        <MediaPicker tipos={['foto', 'video']} aoAdicionar={fotoAtividade} />
        {analisandoAtividade && <p className="vazio">🤖 Analisando a atividade...</p>}
        {resumoAtividadeFoto && <p className="leitura-balanca">{resumoAtividadeFoto}</p>}
        {erroAtividade && <p className="erro">{erroAtividade}</p>}

        {pontosPassos.length > 0 && (
          <>
            <h3>👣 Passos por dia</h3>
            <GraficoBarras pontos={pontosPassos} cor="#2563eb" />
          </>
        )}
        {pontosSono.length >= 2 && (
          <>
            <h3>😴 Horas de sono</h3>
            <GraficoLinha pontos={pontosSono} unidade="h" cor="#7c3aed" />
          </>
        )}
      </div>

      {pontosGordura.length >= 2 && (
        <div className="cartao">
          <h2>📉 Gordura corporal (%)</h2>
          <GraficoLinha pontos={pontosGordura} unidade="%" cor="#d97706" />
        </div>
      )}

      {pontosMassaMagra.length >= 2 && (
        <div className="cartao">
          <h2>💪 Massa magra (kg)</h2>
          <GraficoLinha pontos={pontosMassaMagra} unidade="kg" cor="#2563eb" />
        </div>
      )}

      {recordes.length > 0 && (
        <div className="cartao">
          <h2>🏆 Recordes pessoais</h2>
          <div className="lista-recordes">
            {recordes.slice(0, 12).map((r) => (
              <div key={r.nome} className="item-recorde">
                <strong>{r.nome}</strong>
                <span>{r.cargaKg} kg</span>
                <small>{rotuloCurto(r.data)}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="cartao">
        <h2>🏋️ Progressão de carga</h2>
        {exerciciosComCarga.length === 0 ? (
          <p className="vazio">Registre as cargas durante os treinos (no player) para acompanhar sua progressão aqui.</p>
        ) : (
          <>
            <select value={exercicioAtivo} onChange={(e) => setExercicioSel(e.target.value)}>
              {exerciciosComCarga.map(([nome]) => (
                <option key={nome} value={nome}>{nome}</option>
              ))}
            </select>
            {pontosCarga.length >= 2 ? (
              <GraficoLinha pontos={pontosCarga} unidade="kg" cor="#2563eb" />
            ) : (
              <p className="vazio">
                Só {pontosCarga.length} registro até agora ({pontosCarga[0]?.valor} kg) — treine de novo para ver a linha subir! 📈
              </p>
            )}
          </>
        )}
      </div>

      <div className="cartao">
        <h2>📅 Treinos por semana</h2>
        <p className="resumo-evolucao">
          Últimas 8 semanas · total: <strong>{frequencia.reduce((a, p) => a + p.valor, 0)} treinos</strong>
        </p>
        <GraficoBarras pontos={frequencia} />
      </div>
    </div>
  );
}
