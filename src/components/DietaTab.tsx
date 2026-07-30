import { useState } from 'react';
import type { DadosPerfil, ItemListaCompras, OpcaoRefeicao, Perfil, SlotRefeicaoAlimentar, TipoRefeicao } from '../types';
import { DIAS_SEMANA, TIPOS_REFEICAO } from '../types';
import { uid, hojeISO, horaAgora } from '../storage';
import { diaSemanaHoje, metaDiaria } from '../calc';
import { gerarPlanoAlimentar, type MetaPorDiaSemana } from '../api';
import { acompanharJobIA } from '../jobs';
import { IconeConcluido, IconeExcluir, IconeMusculacao, IconeSono, ICONE_REFEICAO } from './Icones';
import { ChefHat, ShoppingBasket, CalendarDays, TrendingUp, Info, ClipboardList, RefreshCw, Pill } from 'lucide-react';
import Markdown from './Markdown';

interface Props {
  perfil: Perfil;
  dados: DadosPerfil;
  atualizar: (m: (d: DadosPerfil) => DadosPerfil) => void;
  recarregarDados: () => Promise<void>;
}

const REFEICOES_SELECIONAVEIS = TIPOS_REFEICAO.filter((t) => t.value !== 'suplemento');
const PADRAO_SELECIONADO: TipoRefeicao[] = ['cafe', 'almoco', 'jantar'];

function textoRepeticao(semanas: number): string {
  if (semanas === 1) return 'A mesma semana-modelo se repete durante o período todo.';
  if (semanas === 2) return 'Semana 1 = Banco A · Semana 2 = Banco B.';
  if (semanas === 3) return 'Semanas 1 e 3 = Banco A · Semana 2 = Banco B.';
  return 'Semanas 1 e 3 = Banco A · Semanas 2 e 4 = Banco B.';
}

// Agrupa mantendo a ordem em que as categorias aparecem (a lista já vem ordenada por categoria
// do servidor, então a primeira aparição de cada uma já define a ordem final de exibição).
function agruparPorCategoria(itens: ItemListaCompras[]): [string, ItemListaCompras[]][] {
  const grupos = new Map<string, ItemListaCompras[]>();
  for (const item of itens) {
    const categoria = item.categoria ?? 'Outros';
    const lista = grupos.get(categoria);
    if (lista) lista.push(item);
    else grupos.set(categoria, [item]);
  }
  return [...grupos.entries()];
}

export default function DietaTab({ perfil, dados, atualizar, recarregarDados }: Props) {
  const [semanas, setSemanas] = useState(1);
  const [tiposSelecionados, setTiposSelecionados] = useState<TipoRefeicao[]>(PADRAO_SELECIONADO);
  const [observacoes, setObservacoes] = useState('');
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState('');
  const [mensagemFundo, setMensagemFundo] = useState('');
  const [modo, setModo] = useState<'cardapio' | 'compras' | 'preparo'>('cardapio');
  const [semanaModeloVista, setSemanaModeloVista] = useState<'A' | 'B'>('A');
  const [diaVisto, setDiaVisto] = useState(diaSemanaHoje());
  // As 5 combinações de cada refeição se revezam automaticamente ao longo dos dias da semana
  // (dia 1 usa a combinação 1, dia 2 a combinação 2, ...) — isso é o que dá variedade real sem
  // depender do aluno escolher toda vez. Esse mapa só guarda uma TROCA manual pontual, por dia
  // específico (chave inclui o dia), pra quem quiser ver outra opção num dia sem mexer no resto.
  const [opcaoSelecionada, setOpcaoSelecionada] = useState<Record<string, number>>({});

  const plano = dados.planosAlimentares[0] ?? null;

  function alternarTipo(tipo: TipoRefeicao) {
    setTiposSelecionados((atual) => (atual.includes(tipo) ? atual.filter((t) => t !== tipo) : [...atual, tipo]));
  }

  async function gerar() {
    if (!tiposSelecionados.length) return;
    setGerando(true);
    setErro('');
    try {
      const metasPorDiaSemana: MetaPorDiaSemana[] = DIAS_SEMANA.map((diaSemana) => {
        const treinoNesteDia = (perfil.diasMusculacao?.includes(diaSemana) ?? false) || (perfil.diasCorrida?.includes(diaSemana) ?? false);
        return { diaSemana, treinoNesteDia, meta: metaDiaria(perfil, dados.sessoes, dados.atividadesDiarias, treinoNesteDia) };
      });
      const sessoesRecentes = [...dados.sessoes]
        .sort((a, b) => b.data.localeCompare(a.data))
        .slice(0, 8)
        .map((s) => ({ data: s.data.slice(0, 10), nome: s.nomeTreino }));
      const atividadeRecente = [...dados.atividadesDiarias].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 5);

      // Plano alimentar demora — roda em background no servidor (sobrevive à tela bloqueada/app
      // em segundo plano) em vez de segurar essa chamada esperando a IA terminar. A montagem do
      // plano (banco de receitas por refeição, lista de compras) acontece no servidor.
      const { jobId } = await gerarPlanoAlimentar(perfil, semanas, tiposSelecionados, metasPorDiaSemana, observacoes, sessoesRecentes, atividadeRecente);
      setGerando(false);
      setMensagemFundo('Gerando seu plano alimentar em segundo plano — pode sair da tela, eu aviso quando terminar.');
      acompanharJobIA(
        jobId,
        async () => {
          await recarregarDados();
          setModo('cardapio');
          setSemanaModeloVista('A');
          setDiaVisto(diaSemanaHoje());
          setOpcaoSelecionada({});
          setMensagemFundo('');
        },
        (msg) => {
          setErro(msg);
          setMensagemFundo('');
        },
      );
    } catch (e) {
      setErro((e as Error).message);
      setGerando(false);
    }
  }

  function comiIsso(tipo: TipoRefeicao, opcao: OpcaoRefeicao) {
    const hoje = hojeISO();
    atualizar((d) => ({
      ...d,
      dias: {
        ...d.dias,
        [hoje]: {
          data: hoje,
          registros: [
            ...(d.dias[hoje]?.registros ?? []),
            {
              id: uid(),
              tipo,
              descricao: opcao.nomeSugerido,
              hora: horaAgora(),
              calorias: opcao.calorias,
              proteinas_g: opcao.proteinas_g,
              carboidratos_g: opcao.carboidratos_g,
              gorduras_g: opcao.gorduras_g,
              fibras_g: opcao.fibras_g,
            },
          ],
        },
      },
    }));
  }

  const semanaModeloBExiste = plano?.diasModelo.some((d) => d.semanaModelo === 'B') ?? false;
  const diaAtual = plano?.diasModelo.find((d) => d.semanaModelo === semanaModeloVista && d.diaSemana === diaVisto) ?? null;
  const bancoAtual = plano?.bancos.find((b) => b.semanaModelo === semanaModeloVista) ?? null;

  interface LinhaRefeicao {
    tipo: TipoRefeicao;
    slot: SlotRefeicaoAlimentar;
    opcao: OpcaoRefeicao;
    chave: string;
  }

  // Rotação automática: o dia da semana decide qual das ~5 combinações aparece (dia 0 = combinação
  // 0, dia 1 = combinação 1, ..., voltando pra 0 depois da última) — é isso que dá variedade real
  // ao longo da semana sem exigir que o aluno escolha toda vez. Uma troca manual pontual (por dia
  // específico) pode sobrescrever a rotação via "opcaoSelecionada".
  function linhaDoDia(tipo: TipoRefeicao, diaSemana: string): LinhaRefeicao | null {
    const slot = bancoAtual?.slots.find((s) => s.tipo === tipo);
    if (!slot || !slot.opcoes.length) return null;
    const chave = `${semanaModeloVista}|${diaSemana}|${tipo}`;
    const padrao = DIAS_SEMANA.indexOf(diaSemana) % slot.opcoes.length;
    const idx = Math.min(opcaoSelecionada[chave] ?? padrao, slot.opcoes.length - 1);
    return { tipo, slot, opcao: slot.opcoes[idx], chave };
  }

  const linhasDoDia: LinhaRefeicao[] = diaAtual
    ? (plano?.tiposRefeicaoIncluidos ?? [])
        .map((tipo) => linhaDoDia(tipo, diaVisto))
        .filter((l): l is LinhaRefeicao => l !== null)
        .sort((a, b) => (a.slot.horarioSugerido || '').localeCompare(b.slot.horarioSugerido || ''))
    : [];

  const totalDia = diaAtual
    ? linhasDoDia.reduce(
        (acc, l) => ({
          calorias: acc.calorias + l.opcao.calorias,
          proteinas_g: acc.proteinas_g + l.opcao.proteinas_g,
          carboidratos_g: acc.carboidratos_g + l.opcao.carboidratos_g,
          gorduras_g: acc.gorduras_g + l.opcao.gorduras_g,
        }),
        { calorias: 0, proteinas_g: 0, carboidratos_g: 0, gorduras_g: 0 },
      )
    : null;

  return (
    <div>
      <div className="cartao">
        <h2><ChefHat size={19} /> Plano Alimentar com o Coach</h2>
        <p className="meta-texto">Um nutrólogo virtual monta seu cardápio, lista de compras e meal prep — integrado ao seu treino, sono e objetivo.</p>

        <label>Duração do plano</label>
        <div className="chips-tipo">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} className={`chip ${semanas === n ? 'ativa' : ''}`} onClick={() => setSemanas(n)}>
              {n === 1 ? '1 semana' : `${n} semanas`}
            </button>
          ))}
        </div>

        <label>Quais refeições incluir?</label>
        <div className="chips-tipo">
          {REFEICOES_SELECIONAVEIS.map((t) => {
            const Icone = ICONE_REFEICAO[t.value];
            const marcado = tiposSelecionados.includes(t.value);
            return (
              <button key={t.value} className={`chip ${marcado ? 'ativa' : ''}`} onClick={() => alternarTipo(t.value)}>
                {marcado ? '✓ ' : ''}<Icone size={15} /> {t.label}
              </button>
            );
          })}
        </div>

        <label>Observações (opcional)</label>
        <textarea
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder="Ex.: não gosto de peixe, prefiro marmita pronta no almoço de trabalho..."
        />

        <div className="botoes">
          <button className="primario grande" onClick={gerar} disabled={gerando || !tiposSelecionados.length}>
            {gerando ? <><ChefHat size={17} /> Iniciando geração...</> : <><ChefHat size={17} /> Gerar plano alimentar</>}
          </button>
        </div>
        {!tiposSelecionados.length && <p className="meta-texto"><Info size={14} /> Selecione pelo menos uma refeição.</p>}
        {mensagemFundo && <p className="meta-texto"><ChefHat size={14} /> {mensagemFundo}</p>}
        {erro && <p className="erro">{erro}</p>}
      </div>

      {plano && (
        <div className="cartao">
          <h2><CalendarDays size={19} /> {plano.nome}</h2>
          <p className="meta-texto">
            {plano.semanas === 1 ? '1 semana' : `${plano.semanas} semanas`} · {textoRepeticao(plano.semanas)}
          </p>
          <div className="avaliacao-inicial"><Markdown texto={plano.avaliacaoInicial} /></div>
          <details className="sugestao">
            <summary><strong><TrendingUp size={15} /> Estratégia do plano</strong></summary>
            <Markdown texto={plano.estrategia} />
          </details>

          <div className="chips-tipo modo-treino">
            <button className={`chip ${modo === 'cardapio' ? 'ativa' : ''}`} onClick={() => setModo('cardapio')}>
              <CalendarDays size={15} /> Cardápio
            </button>
            <button className={`chip ${modo === 'compras' ? 'ativa' : ''}`} onClick={() => setModo('compras')}>
              <ShoppingBasket size={15} /> Lista de Compras
            </button>
            <button className={`chip ${modo === 'preparo' ? 'ativa' : ''}`} onClick={() => setModo('preparo')}>
              <ClipboardList size={15} /> Meal Prep
            </button>
          </div>

          {modo === 'cardapio' && (
            <>
              {semanaModeloBExiste && (
                <div className="pills-semana">
                  {(['A', 'B'] as const).map((s) => (
                    <button key={s} className={`pill-semana ${semanaModeloVista === s ? 'ativa' : ''}`} onClick={() => setSemanaModeloVista(s)}>
                      Banco {s}
                    </button>
                  ))}
                </div>
              )}
              <div className="pills-semana">
                {DIAS_SEMANA.map((dia) => (
                  <button key={dia} className={`pill-semana ${diaVisto === dia ? 'ativa' : ''}`} onClick={() => setDiaVisto(dia)}>
                    {dia.slice(0, 3)}
                  </button>
                ))}
              </div>

              {diaAtual && totalDia && (
                <>
                  <p className="meta-texto">
                    {diaAtual.treinoNesteDia ? <><IconeMusculacao size={14} /> Dia de treino — meta mais alta</> : <><IconeSono size={14} /> Dia de descanso — meta mais enxuta</>}
                  </p>
                  {diaAtual.metaDia && (
                    <div className="macro-resumo">
                      <div className="macro-linha-titulo">
                        <strong>Calorias</strong>
                        <span>{Math.round(totalDia.calorias)}/{diaAtual.metaDia.kcal} kcal</span>
                      </div>
                      <div className="barra-meta">
                        <div className="barra-meta-cheia" style={{ width: `${Math.min(100, Math.round((totalDia.calorias / diaAtual.metaDia.kcal) * 100))}%` }} />
                      </div>
                      <div className="macro-linha-titulo">
                        <strong>Proteína</strong>
                        <span>{Math.round(totalDia.proteinas_g)}/{diaAtual.metaDia.proteinas_g}g</span>
                      </div>
                      <div className="barra-meta">
                        <div className="barra-meta-cheia" style={{ width: `${Math.min(100, Math.round((totalDia.proteinas_g / diaAtual.metaDia.proteinas_g) * 100))}%` }} />
                      </div>
                      <div className="macro-linha-titulo">
                        <strong>Carboidratos</strong>
                        <span>{Math.round(totalDia.carboidratos_g)}/{diaAtual.metaDia.carboidratos_g}g</span>
                      </div>
                      <div className="barra-meta">
                        <div className="barra-meta-cheia" style={{ width: `${Math.min(100, Math.round((totalDia.carboidratos_g / diaAtual.metaDia.carboidratos_g) * 100))}%` }} />
                      </div>
                      <div className="macro-linha-titulo">
                        <strong>Gordura</strong>
                        <span>{Math.round(totalDia.gorduras_g)}/{diaAtual.metaDia.gorduras_g}g</span>
                      </div>
                      <div className="barra-meta">
                        <div className="barra-meta-cheia" style={{ width: `${Math.min(100, Math.round((totalDia.gorduras_g / diaAtual.metaDia.gorduras_g) * 100))}%` }} />
                      </div>
                    </div>
                  )}

                  {linhasDoDia.map(({ tipo, slot, opcao, chave }) => {
                    const Icone = ICONE_REFEICAO[tipo];
                    const rotulo = TIPOS_REFEICAO.find((t) => t.value === tipo)?.label ?? tipo;
                    const temPreparo = !!(
                      opcao.modoPreparo?.length ||
                      opcao.tempoPreparoMin ||
                      opcao.rendimento ||
                      opcao.dificuldade ||
                      opcao.armazenamento ||
                      opcao.congelamento ||
                      opcao.reaquecimento ||
                      opcao.substituicoes
                    );
                    return (
                      <div key={tipo} className="refeicao-banco-cartao">
                        <div className="refeicao-banco-cabecalho">
                          <p className="detalhes-dia">
                            <Icone size={14} /> <strong>{rotulo}{slot.horarioSugerido ? ` · ${slot.horarioSugerido}` : ''}</strong>
                          </p>
                          {slot.opcoes.length > 1 && (
                            <button
                              className="mini trocar-opcao"
                              title="Ver outra combinação pra hoje"
                              onClick={() => {
                                const atual = slot.opcoes.indexOf(opcao);
                                const proximo = (atual + 1) % slot.opcoes.length;
                                setOpcaoSelecionada((s) => ({ ...s, [chave]: proximo }));
                              }}
                            >
                              <RefreshCw size={12} /> Trocar
                            </button>
                          )}
                        </div>
                        {slot.objetivoNutricional && <p className="meta-texto">{slot.objetivoNutricional}</p>}

                        <p className="nome-prato">{opcao.nomeSugerido}</p>
                        {opcao.observacao && <p className="sugestao-motivo"><Markdown texto={opcao.observacao} inline /></p>}
                        {opcao.itens.map((item) => (
                          <p key={item.id} className="item-refeicao-linha">
                            <span>{item.nome} — {item.quantidade} {item.unidade}</span>
                            <span>{Math.round(item.calorias)} kcal</span>
                          </p>
                        ))}
                        <p className="meta-texto">
                          {Math.round(opcao.calorias)} kcal · P {Math.round(opcao.proteinas_g)}g · C {Math.round(opcao.carboidratos_g)}g · G {Math.round(opcao.gorduras_g)}g
                          {' '}· Fibras {Math.round(opcao.fibras_g)}g{typeof opcao.sodio_mg === 'number' ? ` · Sódio ${Math.round(opcao.sodio_mg)}mg` : ''}
                        </p>

                        {temPreparo && (
                          <details className="sugestao">
                            <summary><strong>Ver preparo</strong>{opcao.tempoPreparoMin ? <small> · ~{opcao.tempoPreparoMin} min</small> : null}</summary>
                            {(opcao.rendimento || opcao.dificuldade) && (
                              <p className="meta-texto">
                                {opcao.rendimento ? `Rendimento: ${opcao.rendimento}` : ''}
                                {opcao.rendimento && opcao.dificuldade ? ' · ' : ''}
                                {opcao.dificuldade ? `Dificuldade: ${opcao.dificuldade}` : ''}
                              </p>
                            )}
                            {!!opcao.modoPreparo?.length && (
                              <ol className="lista-compacta-exercicios">
                                {opcao.modoPreparo.map((passo, i) => <li key={i}>{passo}</li>)}
                              </ol>
                            )}
                            {opcao.substituicoes && <p className="meta-texto"><strong>Substituições:</strong> {opcao.substituicoes}</p>}
                            {opcao.armazenamento && <p className="meta-texto"><strong>Armazenamento:</strong> {opcao.armazenamento}</p>}
                            {opcao.congelamento && <p className="meta-texto"><strong>Congelamento:</strong> {opcao.congelamento}</p>}
                            {opcao.reaquecimento && <p className="meta-texto"><strong>Reaquecimento:</strong> {opcao.reaquecimento}</p>}
                          </details>
                        )}

                        <button className="mini" onClick={() => comiIsso(tipo, opcao)}><IconeConcluido size={13} /> Comi isso</button>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}

          {modo === 'compras' && (
            <>
              <div className="resumo-lista-compras">
                <span className="resumo-lista-compras-num">{plano.listaCompras.length}</span>
                <span className="meta-texto">itens · quantidade total pro período inteiro (receita principal de cada refeição, já somando as repetições das semanas-modelo)</span>
              </div>
              {agruparPorCategoria(plano.listaCompras).map(([categoria, itens]) => (
                <div key={categoria} className="grupo-categoria-compras">
                  <h3 className="rotulo-secao-compras">{categoria}</h3>
                  {itens.map((i) => (
                    <p key={i.id} className="lista-compras-item">
                      <span>{i.nome}</span>
                      <span>{i.quantidadeTotal} {i.unidade}</span>
                    </p>
                  ))}
                </div>
              ))}
            </>
          )}

          {modo === 'preparo' && (
            plano.planejamentoPreparoSemanal
              ? <Markdown texto={plano.planejamentoPreparoSemanal} />
              : <p className="meta-texto">Este plano não trouxe um planejamento de preparo semanal.</p>
          )}

          {plano.estrategiaSuplementacao && (
            <details className="sugestao">
              <summary><strong><Pill size={15} /> Suplementação</strong></summary>
              <Markdown texto={plano.estrategiaSuplementacao} />
            </details>
          )}

          {plano.recomendacoesGerais && (
            <details className="sugestao">
              <summary><strong><Info size={15} /> Recomendações gerais</strong></summary>
              <Markdown texto={plano.recomendacoesGerais} />
            </details>
          )}

          <div className="botoes">
            <button
              className="perigo"
              onClick={() => {
                if (confirm('Apagar este plano e gerar outro?')) {
                  atualizar((d) => ({ ...d, planosAlimentares: [] }));
                }
              }}
            >
              <IconeExcluir size={15} /> Apagar plano
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
