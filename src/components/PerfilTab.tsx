import { useEffect, useState } from 'react';
import type { Perfil } from '../types';
import { EQUIPAMENTOS_COZINHA_COMUNS, OBJETIVOS, ORCAMENTOS_ALIMENTARES, SUPLEMENTOS_COMUNS, TEMPOS_COZINHAR } from '../types';
import { idadeDe } from '../calc';
import { aplicarTema } from '../theme';
import { IconeExcluir, IconeSalvar, IconePerfil } from './Icones';
import { Moon, Sun, LogOut, Heart, Copy, Check, Bell, BellOff, HelpCircle } from 'lucide-react';
import { ativarLembretes, desativarLembretes, inscricaoAtiva, permissaoPush, suportaPush, testarLembrete } from '../push';
import { sairDeTodosAparelhos } from '../api';

interface Props {
  perfil: Perfil;
  aoSalvar: (p: Perfil) => void;
  aoSair: () => void;
  aoExcluirConta: () => Promise<void> | void;
}

// Doação opcional via Pix pro desenvolvedor — o app é gratuito, mas as chamadas de IA (foto de
// refeição, geração de treino, coach) têm custo real. Sem checkout, sem cobrança automática:
// só a chave exibida pra quem quiser ajudar, do próprio banco.
const PIX_CHAVE = '02563586720';
const PIX_CHAVE_FORMATADA = '025.635.867-20';
const PIX_NOME = 'Marcelo V Silveira';

function AjudaCard() {
  return (
    <div className="cartao">
      <h2><HelpCircle size={19} /> Ajuda &amp; perguntas frequentes</h2>
      <details className="landing-faq-item">
        <summary>Meus dados estão seguros?</summary>
        <p>Sim — protegidos por PIN (que nem a gente vê) e cada conta só acessa os próprios dados, nunca os de outra pessoa.</p>
      </details>
      <details className="landing-faq-item">
        <summary>Por que às vezes demora pra gerar meu treino ou dieta?</summary>
        <p>Planos de várias semanas exigem mais elaboração da IA. Pode sair da tela e continuar usando o app — a gente avisa por notificação quando ficar pronto.</p>
      </details>
      <details className="landing-faq-item">
        <summary>Posso usar em mais de um aparelho?</summary>
        <p>Sim, basta entrar com o mesmo nome e PIN em qualquer aparelho — os dados são os mesmos em todos.</p>
      </details>
      <details className="landing-faq-item">
        <summary>O app funciona sem internet?</summary>
        <p>Não totalmente: é preciso conexão para salvar seus dados no servidor e para as funções que usam IA. Sem internet, o que você registrar pode não ser salvo.</p>
      </details>
      <details className="landing-faq-item">
        <summary>Como cancelo minha conta?</summary>
        <p>Mais abaixo nesta tela, em "Excluir minha conta e todos os dados". A ação é permanente e apaga tudo.</p>
      </details>
    </div>
  );
}

function ApoioCard() {
  const [copiado, setCopiado] = useState(false);

  async function copiarChave() {
    try {
      await navigator.clipboard.writeText(PIX_CHAVE);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // clipboard indisponível (ex.: sem HTTPS/permissão) — a chave já está visível na tela.
    }
  }

  return (
    <div className="cartao">
      <h2><Heart size={19} /> Apoie o desenvolvedor</h2>
      <p>
        O Meu Coach é gratuito. As análises de IA (foto de refeição, geração de treino, coach)
        têm custo real pra manter no ar — se o app te ajuda, uma doação via Pix é bem-vinda,
        mas nunca obrigatória.
      </p>
      <div className="apoio-pix">
        <div>
          <label>Chave Pix (CPF)</label>
          <strong>{PIX_CHAVE_FORMATADA}</strong>
          <small>{PIX_NOME}</small>
        </div>
        <button type="button" className="secundario" onClick={copiarChave}>
          {copiado ? <><Check size={15} /> Copiado!</> : <><Copy size={15} /> Copiar chave</>}
        </button>
      </div>
    </div>
  );
}

// Lembrete diário: avisa (notificação push) quem ainda não registrou nada às 19:30, 3h antes do
// relatório automático das 22:30 — fecha o loop do "coach que acompanha todo dia" mesmo com o
// app fechado. Estado da inscrição mora no navegador (Push API), não no perfil salvo no servidor.
function LembretesCard() {
  const [inscrito, setInscrito] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const suportado = suportaPush();
  const bloqueadoPeloNavegador = suportado && permissaoPush() === 'denied';

  useEffect(() => {
    if (suportado) inscricaoAtiva().then(setInscrito);
  }, [suportado]);

  async function alternar() {
    setCarregando(true);
    setMensagem('');
    try {
      if (inscrito) {
        await desativarLembretes();
        setInscrito(false);
      } else {
        const ok = await ativarLembretes();
        setInscrito(ok);
        if (!ok) setMensagem('Permissão de notificação negada — ative nas configurações do navegador pra usar os lembretes.');
      }
    } catch (e) {
      setMensagem((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  async function testar() {
    setTestando(true);
    setMensagem('');
    try {
      await testarLembrete();
      setMensagem('Notificação de teste enviada — confira se ela chegou.');
    } catch (e) {
      setMensagem((e as Error).message);
    } finally {
      setTestando(false);
    }
  }

  if (!suportado) return null;

  return (
    <div className="cartao">
      <h2><Bell size={19} /> Lembrete diário</h2>
      <p>
        Se às 19h30 você ainda não tiver registrado nada no dia, o Meu Coach manda uma notificação
        — 3h antes do relatório automático das 22h30, pra não deixar passar em branco.
      </p>
      <div className="botoes">
        <button type="button" className={inscrito ? 'secundario' : 'primario'} onClick={alternar} disabled={carregando || bloqueadoPeloNavegador}>
          {inscrito ? <><BellOff size={15} /> Desativar lembretes</> : <><Bell size={15} /> Ativar lembretes</>}
        </button>
        {inscrito && (
          <button type="button" className="secundario" onClick={testar} disabled={testando}>
            {testando ? 'Enviando...' : 'Testar agora'}
          </button>
        )}
      </div>
      {bloqueadoPeloNavegador && <p className="meta-texto">Notificações bloqueadas pro Meu Coach neste navegador — precisa liberar nas configurações do site pra ativar.</p>}
      {mensagem && <p className="meta-texto">{mensagem}</p>}
    </div>
  );
}

export default function PerfilTab({ perfil, aoSalvar, aoSair, aoExcluirConta }: Props) {
  const [form, setForm] = useState<Perfil>(perfil);
  const [excluindo, setExcluindo] = useState(false);
  // Texto do campo de descanso separado do valor numérico salvo: assim dá pra apagar tudo e
  // digitar de novo sem o campo "saltar" pra um valor padrão a cada tecla apertada — o padrão
  // só é aplicado quando o campo perde o foco (onBlur), não durante a digitação.
  const [descansoTexto, setDescansoTexto] = useState(String(perfil.descansoPadraoSeg));
  const [incrementoTexto, setIncrementoTexto] = useState(String(perfil.incrementoCargaKg ?? 2.5));

  // Se o perfil global mudar (ex.: peso atualizado pela aba Evolução), reflete aqui.
  useEffect(() => setForm(perfil), [perfil]);
  useEffect(() => setDescansoTexto(String(perfil.descansoPadraoSeg)), [perfil.descansoPadraoSeg]);
  useEffect(() => setIncrementoTexto(String(perfil.incrementoCargaKg ?? 2.5)), [perfil.incrementoCargaKg]);

  function set<K extends keyof Perfil>(campo: K, valor: Perfil[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  function salvar() {
    if (!form.nome.trim()) {
      alert('Dê um nome para o perfil.');
      return;
    }
    // Orçamento/tempo são seleção única (sempre deveriam ter um valor) e equipamentos sempre tem
    // ao menos o básico — preenche um padrão sensato se a pessoa nunca tocou no campo, em vez de
    // salvar vazio e deixar o gerador de dieta sem essa informação.
    aoSalvar({
      ...form,
      idade: idadeDe(form.nascimento) ?? form.idade,
      orcamentoAlimentar: form.orcamentoAlimentar || 'Moderado',
      tempoParaCozinhar: form.tempoParaCozinhar || TEMPOS_COZINHAR[1],
      equipamentosCozinha: form.equipamentosCozinha || 'Fogão',
    });
  }

  // ---- suplementos: checklist + campo livre ----
  const listaSups = (form.suplementos ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const supsMarcados = SUPLEMENTOS_COMUNS.filter((s) => listaSups.some((x) => x.toLowerCase() === s.toLowerCase()));
  const supsOutros = listaSups
    .filter((x) => !SUPLEMENTOS_COMUNS.some((s) => s.toLowerCase() === x.toLowerCase()))
    .join(', ');

  function montarSuplementos(marcados: string[], outros: string) {
    set('suplementos', [...marcados, outros.trim()].filter(Boolean).join(', '));
  }

  function alternarSup(nome: string) {
    const novo = supsMarcados.includes(nome) ? supsMarcados.filter((s) => s !== nome) : [...supsMarcados, nome];
    montarSuplementos(novo, supsOutros);
  }

  // ---- equipamentos de cozinha: checklist + campo livre (mesmo padrão dos suplementos) ----
  const listaEquip = (form.equipamentosCozinha ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const equipMarcados = EQUIPAMENTOS_COZINHA_COMUNS.filter((e) => listaEquip.some((x) => x.toLowerCase() === e.toLowerCase()));
  const equipOutros = listaEquip
    .filter((x) => !EQUIPAMENTOS_COZINHA_COMUNS.some((e) => e.toLowerCase() === x.toLowerCase()))
    .join(', ');

  function montarEquipamentos(marcados: string[], outros: string) {
    set('equipamentosCozinha', [...marcados, outros.trim()].filter(Boolean).join(', '));
  }

  function alternarEquip(nome: string) {
    const novo = equipMarcados.includes(nome) ? equipMarcados.filter((e) => e !== nome) : [...equipMarcados, nome];
    montarEquipamentos(novo, equipOutros);
  }

  // Tema é aplicado e salvo imediatamente (não espera o botão "Salvar" geral), pra não
  // arrastar junto edições de outros campos ainda não confirmadas pela pessoa.
  function trocarTema(tema: NonNullable<Perfil['tema']>) {
    aplicarTema(tema);
    setForm((f) => ({ ...f, tema }));
    aoSalvar({ ...perfil, tema });
  }

  return (
    <>
    <div className="cartao">
      <h2><IconePerfil size={19} /> Seu perfil</h2>

      <h3 className="rotulo-secao">Dados pessoais</h3>
      <label>Tema do aplicativo</label>
      <div className="chips-tipo">
        <button type="button" className={`chip ${(form.tema ?? 'escuro') === 'escuro' ? 'ativa' : ''}`} onClick={() => trocarTema('escuro')}>
          <Moon size={15} /> Escuro
        </button>
        <button type="button" className={`chip ${form.tema === 'claro' ? 'ativa' : ''}`} onClick={() => trocarTema('claro')}>
          <Sun size={15} /> Claro
        </button>
      </div>

      <label>Nome</label>
      <input value={form.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Como te chamo?" />

      <div className="linha">
        <div>
          <label>Sexo</label>
          <select value={form.sexo ?? ''} onChange={(e) => set('sexo', (e.target.value || undefined) as Perfil['sexo'])}>
            <option value="">—</option>
            <option value="M">Masculino</option>
            <option value="F">Feminino</option>
          </select>
        </div>
        <div>
          <label>Data de nascimento{idadeDe(form.nascimento) ? ` (${idadeDe(form.nascimento)} anos)` : ''}</label>
          <input type="date" value={form.nascimento ?? ''} onChange={(e) => set('nascimento', e.target.value || undefined)} />
        </div>
      </div>

      <div className="linha">
        <div>
          <label>Peso (kg)</label>
          <input type="number" step="0.1" value={form.pesoKg ?? ''} onChange={(e) => set('pesoKg', e.target.value ? +e.target.value : undefined)} />
        </div>
        <div>
          <label>Altura (cm)</label>
          <input type="number" value={form.alturaCm ?? ''} onChange={(e) => set('alturaCm', e.target.value ? +e.target.value : undefined)} />
        </div>
      </div>

      <label>Objetivo</label>
      <select value={form.objetivo} onChange={(e) => set('objetivo', e.target.value as Perfil['objetivo'])}>
        {OBJETIVOS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <h3 className="rotulo-secao">Preferências alimentares</h3>
      <label>Restrições e alergias</label>
      <textarea value={form.restricoes ?? ''} onChange={(e) => set('restricoes', e.target.value)} placeholder="Ex.: intolerância a lactose, não como carne vermelha..." />

      <label>Preferências alimentares</label>
      <textarea value={form.preferencias ?? ''} onChange={(e) => set('preferencias', e.target.value)} placeholder="Ex.: adoro frango, prefiro comida rápida de preparar..." />

      <label>O que tem na geladeira / despensa</label>
      <textarea value={form.geladeira ?? ''} onChange={(e) => set('geladeira', e.target.value)} placeholder="Ex.: ovos, frango, arroz, banana, aveia, batata-doce..." />

      <label>Orçamento para alimentação</label>
      <div className="chips-tipo">
        {ORCAMENTOS_ALIMENTARES.map((o) => (
          <button key={o} type="button" className={`chip ${(form.orcamentoAlimentar ?? 'Moderado') === o ? 'ativa' : ''}`} onClick={() => set('orcamentoAlimentar', o)}>
            {o}
          </button>
        ))}
      </div>

      <label>Tempo disponível para cozinhar</label>
      <div className="chips-tipo">
        {TEMPOS_COZINHAR.map((t) => (
          <button key={t} type="button" className={`chip ${(form.tempoParaCozinhar ?? TEMPOS_COZINHAR[1]) === t ? 'ativa' : ''}`} onClick={() => set('tempoParaCozinhar', t)}>
            {t}
          </button>
        ))}
      </div>

      <label>Equipamentos de cozinha disponíveis</label>
      <div className="chips-tipo">
        {EQUIPAMENTOS_COZINHA_COMUNS.map((e) => (
          <button key={e} type="button" className={`chip ${equipMarcados.includes(e) ? 'ativa' : ''}`} onClick={() => alternarEquip(e)}>
            {equipMarcados.includes(e) ? '✓ ' : ''}{e}
          </button>
        ))}
      </div>
      <input
        value={equipOutros}
        onChange={(e) => montarEquipamentos(equipMarcados, e.target.value)}
        placeholder="Outros equipamentos (ex.: churrasqueira elétrica, sanduicheira...)"
      />

      <label>Suplementos que costuma tomar</label>
      <div className="chips-tipo">
        {SUPLEMENTOS_COMUNS.map((s) => (
          <button
            key={s}
            type="button"
            className={`chip ${supsMarcados.includes(s) ? 'ativa' : ''}`}
            onClick={() => alternarSup(s)}
          >
            {supsMarcados.includes(s) ? '✓ ' : ''}{s}
          </button>
        ))}
      </div>
      <input
        value={supsOutros}
        onChange={(e) => montarSuplementos(supsMarcados, e.target.value)}
        placeholder="Outros (ex.: creatina 5g/dia, ZMA...)"
      />

      <h3 className="rotulo-secao">Preferências de treino</h3>
      <label>Descanso padrão entre séries (segundos)</label>
      <input
        type="number"
        value={descansoTexto}
        onChange={(e) => setDescansoTexto(e.target.value)}
        onBlur={() => {
          const n = parseInt(descansoTexto, 10);
          const valido = Number.isFinite(n) && n > 0 ? n : 90;
          set('descansoPadraoSeg', valido);
          setDescansoTexto(String(valido));
        }}
      />

      <label>Menor incremento de carga disponível (kg)</label>
      <input
        type="number"
        step="0.25"
        value={incrementoTexto}
        onChange={(e) => setIncrementoTexto(e.target.value)}
        onBlur={() => {
          const n = parseFloat(incrementoTexto.replace(',', '.'));
          const valido = Number.isFinite(n) && n > 0 ? n : 2.5;
          set('incrementoCargaKg', valido);
          setIncrementoTexto(String(valido));
        }}
      />

      <div className="botoes">
        <button className="primario" onClick={salvar}><IconeSalvar size={16} /> Salvar</button>
      </div>

      <div className="botoes conta-acoes">
        <button className="secundario" onClick={() => { if (confirm('Sair deste aparelho? Seus dados continuam salvos — é só entrar de novo com seu nome e PIN.')) aoSair(); }}>
          <LogOut size={16} /> Sair deste aparelho
        </button>
        <button
          className="secundario"
          onClick={async () => {
            if (!confirm('Sair de TODOS os aparelhos onde essa conta está logada? Útil se perdeu o celular ou desconfia que alguém mais tem acesso — você (e qualquer outro aparelho) vai precisar entrar de novo com nome e PIN.')) return;
            try {
              await sairDeTodosAparelhos();
            } catch {
              // o próprio token usado nesta chamada já foi invalidado no servidor — segue com o logout local mesmo se a resposta falhar em chegar.
            }
            aoSair();
          }}
        >
          <LogOut size={16} /> Sair de todos os aparelhos
        </button>
      </div>

      <div className="zona-perigo">
        <button
          className="link-perigo"
          disabled={excluindo}
          onClick={async () => {
            if (!confirm(`Excluir a conta de ${form.nome} e TODOS os dados (refeições, treinos, fotos, evolução)? Isso não pode ser desfeito.`)) return;
            setExcluindo(true);
            try {
              await aoExcluirConta();
            } finally {
              setExcluindo(false);
            }
          }}
        >
          {excluindo ? 'Excluindo...' : <><IconeExcluir size={13} /> Excluir minha conta e todos os dados</>}
        </button>
      </div>
    </div>
    <LembretesCard />
    <AjudaCard />
    <ApoioCard />
    </>
  );
}
