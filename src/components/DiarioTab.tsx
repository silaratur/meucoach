import { useEffect, useRef, useState } from 'react';
import type { DadosPerfil, Perfil, Registro, SugestaoRefeicao, TipoRefeicao } from '../types';
import { TIPOS_REFEICAO } from '../types';
import { hojeISO, horaAgora, uid } from '../storage';
import { analisarFoto, estimarCalorias, sugerirRefeicoes } from '../api';
import { ditadoDisponivel, iniciarDitado } from '../speech';
import { dataLocalDe, diaSemanaHoje, metaDiaria, totaisDoDia } from '../calc';
import { OBJETIVOS } from '../types';

function OBJETIVO_LABEL(v: string): string {
  return OBJETIVOS.find((o) => o.value === v)?.label.split(' (')[0] ?? v;
}
import type { MediaRef } from '../media';
import { blobParaBase64, excluirMidias, obterMidia } from '../media';
import { MediaGallery, MediaPicker } from './Midia';
import { IconeAdicionar, IconeConcluido, IconeMicrofone, IconeParar } from './Icones';

interface Props {
  perfil: Perfil;
  dados: DadosPerfil;
  atualizar: (m: (d: DadosPerfil) => DadosPerfil) => void;
}

export default function DiarioTab({ perfil, dados, atualizar }: Props) {
  const data = hojeISO();
  const dia = dados.dias[data] ?? { data, registros: [] };

  const [tipo, setTipo] = useState<TipoRefeicao>('cafe');
  const [descricao, setDescricao] = useState('');
  const [midiasPendentes, setMidiasPendentes] = useState<MediaRef[]>([]);
  const [sugestoes, setSugestoes] = useState<SugestaoRefeicao[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [analisando, setAnalisando] = useState(false);
  const [erro, setErro] = useState('');
  const [ditando, setDitando] = useState(false);
  const [estimando, setEstimando] = useState(false);
  const [macrosPendentes, setMacrosPendentes] = useState<Pick<
    Registro,
    'calorias' | 'proteinas_g' | 'carboidratos_g' | 'gorduras_g'
  > | null>(null);
  const pararDitadoRef = useRef<(() => void) | null>(null);

  useEffect(() => () => pararDitadoRef.current?.(), []);

  function alternarDitado() {
    if (ditando) {
      pararDitadoRef.current?.();
      return;
    }
    const parar = iniciarDitado(
      (texto) => setDescricao((d) => (d ? d + ' ' : '') + texto),
      () => setDitando(false),
    );
    if (parar) {
      pararDitadoRef.current = parar;
      setDitando(true);
    } else {
      setErro('Ditado por voz não disponível neste navegador.');
    }
  }

  function inserirRegistro(novo: Registro) {
    atualizar((d) => ({
      ...d,
      dias: { ...d.dias, [data]: { data, registros: [...(d.dias[data]?.registros ?? []), novo] } },
    }));
  }

  function adicionar() {
    if (!descricao.trim() && midiasPendentes.length === 0) return;
    inserirRegistro({
      id: uid(),
      tipo,
      descricao: descricao.trim() || '(foto/áudio anexado)',
      hora: horaAgora(),
      midias: midiasPendentes.length ? midiasPendentes : undefined,
      ...(macrosPendentes ?? {}),
    });
    setDescricao('');
    setMidiasPendentes([]);
    setMacrosPendentes(null);
  }

  function remover(id: string) {
    const registro = dia.registros.find((r) => r.id === id);
    excluirMidias(registro?.midias);
    atualizar((d) => ({
      ...d,
      dias: { ...d.dias, [data]: { data, registros: (d.dias[data]?.registros ?? []).filter((r) => r.id !== id) } },
    }));
  }

  async function analisarFotoPendente(fotoRef?: MediaRef) {
    const foto = fotoRef ?? midiasPendentes.find((m) => m.tipo === 'foto');
    if (!foto) return;
    setAnalisando(true);
    setErro('');
    try {
      const blob = await obterMidia(foto.id);
      if (!blob) throw new Error('Foto não encontrada.');
      const base64 = await blobParaBase64(blob);
      const rotulo = TIPOS_REFEICAO.find((t) => t.value === tipo)?.label ?? tipo;
      const a = await analisarFoto(perfil, base64, blob.type || 'image/jpeg', rotulo);
      if (!a.ehComida) {
        setErro('🤖 ' + a.descricao);
      } else {
        setDescricao(`${a.descricao}\n🤖 ${a.comentario}`);
        setMacrosPendentes({
          calorias: a.calorias,
          proteinas_g: a.proteinas_g,
          carboidratos_g: a.carboidratos_g,
          gorduras_g: a.gorduras_g,
        });
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAnalisando(false);
    }
  }

  async function pedirSugestoes() {
    setCarregando(true);
    setErro('');
    setSugestoes(null);
    try {
      const rotulo = TIPOS_REFEICAO.find((t) => t.value === tipo)?.label ?? tipo;
      // Sono ruim ou atividade muito alta/baixa recente também entram na sugestão — tudo integrado.
      const atividadeRecente = [...dados.atividadesDiarias].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 3);
      const resp = await sugerirRefeicoes(perfil, rotulo, dia.registros, atividadeRecente);
      setSugestoes(resp.sugestoes);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  async function estimarDia() {
    const semEstimativa = dia.registros
      .filter((r) => typeof r.calorias !== 'number' && r.tipo !== 'suplemento')
      .map((r) => ({ id: r.id, tipo: r.tipo, descricao: r.descricao }));
    if (!semEstimativa.length) return;
    setEstimando(true);
    setErro('');
    try {
      const { estimativas } = await estimarCalorias(perfil, semEstimativa);
      atualizar((d) => {
        const registros = (d.dias[data]?.registros ?? []).map((r) => {
          const e = estimativas.find((x) => x.id === r.id);
          return e ? { ...r, calorias: e.calorias, proteinas_g: e.proteinas_g, carboidratos_g: e.carboidratos_g, gorduras_g: e.gorduras_g } : r;
        });
        return { ...d, dias: { ...d.dias, [data]: { data, registros } } };
      });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEstimando(false);
    }
  }

  const dataBonita = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const temFotoPendente = midiasPendentes.some((m) => m.tipo === 'foto');
  const totais = totaisDoDia(dia.registros);
  const nomeDiaHoje = diaSemanaHoje();
  const treinoPrevistoHoje = (perfil.diasMusculacao?.includes(nomeDiaHoje) ?? false) || (perfil.diasCorrida?.includes(nomeDiaHoje) ?? false);
  const treinoHoje = treinoPrevistoHoje || dados.sessoes.some((s) => dataLocalDe(s.data) === data);
  const meta = metaDiaria(perfil, dados.sessoes, dados.atividadesDiarias, treinoHoje);
  const pctMeta = meta && totais.calorias > 0 ? Math.min(100, Math.round((totais.calorias / meta.kcal) * 100)) : 0;

  return (
    <div>
      <div className="cartao">
        <h2>📅 {dataBonita}</h2>
        <label>O que você comeu / tomou?</label>
        <div className="chips-tipo">
          {TIPOS_REFEICAO.map((t) => (
            <button key={t.value} className={`chip ${tipo === t.value ? 'ativa' : ''}`} onClick={() => setTipo(t.value)}>
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
        <textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Ex.: 2 ovos mexidos, 1 fatia de pão integral e café sem açúcar — ou só anexe uma foto do prato 📷"
        />

        <div className="media-picker">
          {ditadoDisponivel() && (
            <button type="button" className={ditando ? 'gravando' : ''} onClick={alternarDitado} title="Ditar">
              {ditando ? <IconeParar size={17} /> : <IconeMicrofone size={17} />}
            </button>
          )}
          <MediaPicker
            compacto
            aoAdicionar={(ref) => {
              setMidiasPendentes((m) => [...m, ref]);
              // Regra: chegou foto de comida → o Coach analisa na hora (a descrição continua editável)
              if (ref.tipo === 'foto') analisarFotoPendente(ref);
            }}
          />
        </div>
        <MediaGallery
          midias={midiasPendentes}
          aoRemover={(ref) => {
            excluirMidias([ref]);
            setMidiasPendentes((m) => m.filter((x) => x.id !== ref.id));
          }}
        />
        {analisando && <p className="leitura-balanca">🤖 Olhando seu prato... a descrição chega em instantes.</p>}
        {temFotoPendente && !analisando && (
          <button className="destaque" onClick={() => analisarFotoPendente()}>
            🔍 Analisar a foto de novo
          </button>
        )}

        <div className="botoes">
          <button className="primario" onClick={adicionar}><IconeAdicionar size={17} /> Registrar</button>
          <button onClick={pedirSugestoes} disabled={carregando}>
            {carregando ? '🤖 Pensando...' : '🤖 Me sugere algo'}
          </button>
        </div>
        {erro && <p className="erro">{erro}</p>}
      </div>

      {sugestoes && (
        <div className="cartao">
          <h2>🍳 Sugestões do Coach</h2>
          {sugestoes.map((s, i) => (
            <details key={i} className="sugestao">
              <summary>
                <strong>{s.nome}</strong>
                <small> {Math.round(s.calorias)} kcal · P {Math.round(s.proteinas_g)}g · C {Math.round(s.carboidratos_g)}g · G {Math.round(s.gorduras_g)}g</small>
              </summary>
              <p><em>{s.motivo}</em></p>
              <p><strong>Ingredientes:</strong> {s.ingredientes.join(', ')}</p>
              <p><strong>Preparo:</strong> {s.preparo}</p>
              <button
                className="primario"
                onClick={() => {
                  inserirRegistro({
                    id: uid(),
                    tipo,
                    descricao: s.nome,
                    hora: horaAgora(),
                    calorias: s.calorias,
                    proteinas_g: s.proteinas_g,
                    carboidratos_g: s.carboidratos_g,
                    gorduras_g: s.gorduras_g,
                  });
                  setSugestoes(null);
                }}
              >
                <IconeConcluido size={15} /> Comi essa
              </button>
            </details>
          ))}
        </div>
      )}

      <div className="cartao">
        <h2>Registros de hoje</h2>
        {dia.registros.length === 0 && (
          <div className="estado-vazio">
            <span className="icone-vazio">☕</span>
            <p>Nada registrado ainda. Bora começar pelo café?</p>
          </div>
        )}
        {TIPOS_REFEICAO.map((t) => {
          const doTipo = dia.registros.filter((r) => r.tipo === t.value);
          if (!doTipo.length) return null;
          return (
            <div key={t.value} className="grupo-refeicao">
              <h3>{t.emoji} {t.label}</h3>
              {doTipo.map((r) => (
                <div key={r.id} className="registro-bloco">
                  <div className="registro">
                    <span>
                      {r.hora} — {r.descricao}
                      {typeof r.calorias === 'number' && (
                        <em className="kcal-chip"> ~{Math.round(r.calorias)} kcal</em>
                      )}
                    </span>
                    <button className="mini" onClick={() => remover(r.id)}>✕</button>
                  </div>
                  <MediaGallery midias={r.midias} />
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {dia.registros.length > 0 && (
        <div className="cartao total-dia">
          <h2>🔢 Total do dia</h2>
          {totais.itensComEstimativa > 0 ? (
            <p className="total-numeros">
              <strong>{Math.round(totais.calorias)} kcal</strong> · P {Math.round(totais.proteinas_g)}g · C{' '}
              {Math.round(totais.carboidratos_g)}g · G {Math.round(totais.gorduras_g)}g
            </p>
          ) : (
            <p className="vazio">Ainda sem estimativas — use o botão abaixo.</p>
          )}
          {meta && (
            <>
              <div className="barra-meta">
                <div
                  className={`barra-meta-cheia ${pctMeta > 100 ? 'estourou' : ''}`}
                  style={{ width: `${Math.min(pctMeta, 100)}%` }}
                />
              </div>
              <p className="meta-texto">
                Meta estimada: <strong>~{meta.kcal} kcal</strong> e <strong>{meta.proteinas_g}g de proteína</strong>{' '}
                ({OBJETIVO_LABEL(perfil.objetivo)} · {meta.descricao}) — {pctMeta}% atingido
              </p>
            </>
          )}
          {!meta && (
            <p className="meta-texto">💡 Preencha sexo, nascimento, peso e altura no Perfil para eu calcular sua meta diária.</p>
          )}
          {totais.itensSemEstimativa > 0 && (
            <button className="destaque" onClick={estimarDia} disabled={estimando}>
              {estimando
                ? '🤖 Calculando...'
                : `🤖 Estimar calorias (${totais.itensSemEstimativa} registro${totais.itensSemEstimativa > 1 ? 's' : ''} sem cálculo)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
