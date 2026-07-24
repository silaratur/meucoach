import { useState } from 'react';
import type { DadosPerfil, DiaModeloAlimentar, ItemRefeicao, Perfil, PlanoAlimentar, ReceitaPlano, RefeicaoPlano, TipoRefeicao } from '../types';
import { DIAS_SEMANA, TIPOS_REFEICAO } from '../types';
import { uid, hojeISO, horaAgora } from '../storage';
import { diaSemanaHoje, metaDiaria } from '../calc';
import { gerarPlanoAlimentar, type DiaModeloAlimentarIA, type MetaPorDiaSemana } from '../api';
import { IconeConcluido, IconeExcluir, IconeMusculacao, IconeSono, ICONE_REFEICAO } from './Icones';
import { ChefHat, ShoppingBasket, CalendarDays, TrendingUp, Info } from 'lucide-react';
import Markdown from './Markdown';

interface Props {
  perfil: Perfil;
  dados: DadosPerfil;
  atualizar: (m: (d: DadosPerfil) => DadosPerfil) => void;
}

const REFEICOES_SELECIONAVEIS = TIPOS_REFEICAO.filter((t) => t.value !== 'suplemento');
const PADRAO_SELECIONADO: TipoRefeicao[] = ['cafe', 'almoco', 'jantar'];

function normalizarNome(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function somaItens(itens: ItemRefeicao[], campo: 'calorias' | 'proteinas_g' | 'carboidratos_g' | 'gorduras_g'): number {
  return itens.reduce((acc, i) => acc + i[campo], 0);
}

// Soma determinística das quantidades a partir do que a IA já gera de forma confiável (itens por
// refeição) — pedir pra IA mesma somar tudo isso (testado ao vivo) é pouco confiável, ela "desiste"
// no meio da agregação. Agrupa por nome+unidade normalizados e aplica o multiplicador de repetição
// de cada semana-modelo (A repete em semanas ímpares, B em pares).
function construirListaCompras(diasModelo: DiaModeloAlimentarIA[], semanas: number): { nome: string; quantidadeTotal: number; unidade: string }[] {
  const repeticoesA = Math.ceil(semanas / 2);
  const repeticoesB = Math.floor(semanas / 2);
  const totais = new Map<string, { nome: string; unidade: string; quantidade: number }>();
  for (const dia of diasModelo) {
    const mult = dia.semanaModelo === 'B' ? repeticoesB : repeticoesA;
    for (const refeicao of dia.refeicoes) {
      for (const item of refeicao.itens) {
        const chave = `${normalizarNome(item.nome)}|${normalizarNome(item.unidade)}`;
        const atual = totais.get(chave);
        if (atual) atual.quantidade += item.quantidade * mult;
        else totais.set(chave, { nome: item.nome, unidade: item.unidade, quantidade: item.quantidade * mult });
      }
    }
  }
  return [...totais.values()]
    .map((t) => ({ nome: t.nome, quantidadeTotal: Math.round(t.quantidade * 10) / 10, unidade: t.unidade }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function textoRepeticao(semanas: number): string {
  if (semanas === 1) return 'A mesma semana-modelo se repete durante o período todo.';
  if (semanas === 2) return 'Semana 1 = Cardápio A · Semana 2 = Cardápio B.';
  if (semanas === 3) return 'Semanas 1 e 3 = Cardápio A · Semana 2 = Cardápio B.';
  return 'Semanas 1 e 3 = Cardápio A · Semanas 2 e 4 = Cardápio B.';
}

export default function DietaTab({ perfil, dados, atualizar }: Props) {
  const [semanas, setSemanas] = useState(1);
  const [tiposSelecionados, setTiposSelecionados] = useState<TipoRefeicao[]>(PADRAO_SELECIONADO);
  const [observacoes, setObservacoes] = useState('');
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState('');
  const [modo, setModo] = useState<'cardapio' | 'compras' | 'receitas'>('cardapio');
  const [semanaModeloVista, setSemanaModeloVista] = useState<'A' | 'B'>('A');
  const [diaVisto, setDiaVisto] = useState(diaSemanaHoje());

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

      const resp = await gerarPlanoAlimentar(perfil, semanas, tiposSelecionados, metasPorDiaSemana, observacoes, sessoesRecentes, atividadeRecente);

      // Receitas primeiro, pra poder resolver receitaNome -> receitaId dos itens (casamento por
      // nome normalizado — a IA não é confiável pra manter ids consistentes num JSON grande).
      const receitas: ReceitaPlano[] = resp.receitas.map((r) => ({ id: uid(), nome: r.nome, tempoPreparoMin: r.tempoPreparoMin, ingredientes: r.ingredientes, modoPreparo: r.modoPreparo }));
      const receitaIdPorNome = new Map(receitas.map((r) => [normalizarNome(r.nome), r.id]));

      const diasModelo: DiaModeloAlimentar[] = resp.diasModelo.map((d) => {
        const metaInfo = metasPorDiaSemana.find((m) => m.diaSemana === d.diaSemana);
        return {
          id: uid(),
          semanaModelo: d.semanaModelo,
          diaSemana: d.diaSemana,
          metaDia: metaInfo?.meta ?? null,
          treinoNesteDia: metaInfo?.treinoNesteDia ?? false,
          refeicoes: d.refeicoes.map((r) => ({
            id: uid(),
            tipo: r.tipo,
            nomeSugerido: r.nomeSugerido,
            horarioSugerido: r.horarioSugerido || undefined,
            observacao: r.observacao || undefined,
            itens: r.itens.map((i) => ({
              id: uid(),
              nome: i.nome,
              quantidade: i.quantidade,
              unidade: i.unidade,
              calorias: i.calorias,
              proteinas_g: i.proteinas_g,
              carboidratos_g: i.carboidratos_g,
              gorduras_g: i.gorduras_g,
              receitaId: i.receitaNome ? receitaIdPorNome.get(normalizarNome(i.receitaNome)) : undefined,
            })),
          })),
        };
      });

      const novo: PlanoAlimentar = {
        id: uid(),
        nome: resp.nome,
        semanas: resp.semanas ?? semanas,
        tiposRefeicaoIncluidos: tiposSelecionados,
        avaliacaoInicial: resp.avaliacaoInicial,
        estrategia: resp.estrategia,
        diasModelo,
        receitas,
        listaCompras: construirListaCompras(resp.diasModelo, resp.semanas ?? semanas).map((i) => ({ id: uid(), ...i })),
        recomendacoesGerais: resp.recomendacoesGerais,
        criadoEm: new Date().toISOString(),
      };
      atualizar((d) => ({ ...d, planosAlimentares: [novo] }));
      setModo('cardapio');
      setSemanaModeloVista('A');
      setDiaVisto(diaSemanaHoje());
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setGerando(false);
    }
  }

  function comiIsso(refeicao: RefeicaoPlano) {
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
              tipo: refeicao.tipo,
              descricao: refeicao.nomeSugerido,
              hora: horaAgora(),
              calorias: somaItens(refeicao.itens, 'calorias'),
              proteinas_g: somaItens(refeicao.itens, 'proteinas_g'),
              carboidratos_g: somaItens(refeicao.itens, 'carboidratos_g'),
              gorduras_g: somaItens(refeicao.itens, 'gorduras_g'),
            },
          ],
        },
      },
    }));
  }

  const semanaModeloBExiste = plano?.diasModelo.some((d) => d.semanaModelo === 'B') ?? false;
  const diaAtual = plano?.diasModelo.find((d) => d.semanaModelo === semanaModeloVista && d.diaSemana === diaVisto) ?? null;
  const totalDia = diaAtual
    ? {
        calorias: diaAtual.refeicoes.reduce((acc, r) => acc + somaItens(r.itens, 'calorias'), 0),
        proteinas_g: diaAtual.refeicoes.reduce((acc, r) => acc + somaItens(r.itens, 'proteinas_g'), 0),
        carboidratos_g: diaAtual.refeicoes.reduce((acc, r) => acc + somaItens(r.itens, 'carboidratos_g'), 0),
        gorduras_g: diaAtual.refeicoes.reduce((acc, r) => acc + somaItens(r.itens, 'gorduras_g'), 0),
      }
    : null;

  return (
    <div>
      <div className="cartao">
        <h2><ChefHat size={19} /> Plano Alimentar com o Coach</h2>
        <p className="meta-texto">Um nutrólogo virtual monta seu cardápio, lista de compras e receitas — integrado ao seu treino, sono e objetivo.</p>

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
            {gerando ? <><ChefHat size={17} /> Montando seu plano... (pode levar até um minuto)</> : <><ChefHat size={17} /> Gerar plano alimentar</>}
          </button>
        </div>
        {!tiposSelecionados.length && <p className="meta-texto"><Info size={14} /> Selecione pelo menos uma refeição.</p>}
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
            <button className={`chip ${modo === 'receitas' ? 'ativa' : ''}`} onClick={() => setModo('receitas')}>
              <ChefHat size={15} /> Receitas
            </button>
          </div>

          {modo === 'cardapio' && (
            <>
              {semanaModeloBExiste && (
                <div className="pills-semana">
                  {(['A', 'B'] as const).map((s) => (
                    <button key={s} className={`pill-semana ${semanaModeloVista === s ? 'ativa' : ''}`} onClick={() => setSemanaModeloVista(s)}>
                      Cardápio {s}
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

                  {diaAtual.refeicoes.map((r) => {
                    const Icone = ICONE_REFEICAO[r.tipo];
                    const rotulo = TIPOS_REFEICAO.find((t) => t.value === r.tipo)?.label ?? r.tipo;
                    const receitasDaRefeicao = [...new Set(r.itens.map((i) => i.receitaId).filter((x): x is string => !!x))]
                      .map((id) => plano.receitas.find((rec) => rec.id === id))
                      .filter((rec): rec is ReceitaPlano => !!rec);
                    return (
                      <div key={r.id} className="dia-corrida">
                        <p className="detalhes-dia">
                          <Icone size={14} /> <strong>{rotulo}{r.horarioSugerido ? ` · ${r.horarioSugerido}` : ''}</strong>
                        </p>
                        <p className="detalhes-dia"><strong>{r.nomeSugerido}</strong></p>
                        {r.observacao && <p className="sugestao-motivo"><Markdown texto={r.observacao} inline /></p>}
                        {r.itens.map((item) => (
                          <p key={item.id} className="item-refeicao-linha">
                            <span>{item.nome} — {item.quantidade} {item.unidade}</span>
                            <span>{Math.round(item.calorias)} kcal</span>
                          </p>
                        ))}
                        {receitasDaRefeicao.map((rec) => (
                          <details key={rec.id} className="sugestao">
                            <summary><strong>Ver receita: {rec.nome}</strong> <small>~{rec.tempoPreparoMin} min</small></summary>
                            <p><strong>Ingredientes:</strong> {rec.ingredientes.map((i) => `${i.nome} (${i.quantidade} ${i.unidade})`).join(', ')}</p>
                            <ol className="lista-compacta-exercicios">
                              {rec.modoPreparo.map((passo, i) => <li key={i}>{passo}</li>)}
                            </ol>
                          </details>
                        ))}
                        <button className="mini" onClick={() => comiIsso(r)}><IconeConcluido size={13} /> Comi isso</button>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}

          {modo === 'compras' && (
            <>
              <p className="meta-texto">Quantidade total para o período inteiro do plano, já somando as repetições das semanas-modelo.</p>
              {plano.listaCompras.map((i) => (
                <p key={i.id} className="lista-compras-item">
                  <span>{i.nome}</span>
                  <span>{i.quantidadeTotal} {i.unidade}</span>
                </p>
              ))}
            </>
          )}

          {modo === 'receitas' && (
            <>
              {plano.receitas.length === 0 && <p className="meta-texto">Nenhuma receita necessária — todas as refeições deste plano são simples de montar.</p>}
              {plano.receitas.map((rec) => (
                <details key={rec.id} className="sugestao">
                  <summary><strong>{rec.nome}</strong> <small>~{rec.tempoPreparoMin} min</small></summary>
                  <p><strong>Ingredientes:</strong> {rec.ingredientes.map((i) => `${i.nome} (${i.quantidade} ${i.unidade})`).join(', ')}</p>
                  <ol className="lista-compacta-exercicios">
                    {rec.modoPreparo.map((passo, i) => <li key={i}>{passo}</li>)}
                  </ol>
                </details>
              ))}
            </>
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
