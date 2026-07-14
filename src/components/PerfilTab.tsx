import { useEffect, useState } from 'react';
import type { Perfil } from '../types';
import { OBJETIVOS, SUPLEMENTOS_COMUNS } from '../types';
import { idadeDe } from '../calc';
import { aplicarTema } from '../theme';
import { cancelarAssinatura, iniciarAssinatura, obterAssinatura } from '../storage';
import type { StatusAssinatura } from '../storage';
import { IconeExcluir, IconeSalvar, IconePerfil } from './Icones';
import { Moon, Sun, LogOut, CreditCard } from 'lucide-react';

interface Props {
  perfil: Perfil;
  aoSalvar: (p: Perfil) => void;
  aoSair: () => void;
  aoExcluirConta: () => Promise<void> | void;
}

const ROTULOS_STATUS_ASSINATURA: Record<StatusAssinatura['status'], string> = {
  ativa: 'Ativa',
  isenta: 'Cortesia',
  atrasada: 'Pagamento atrasado',
  cancelada: 'Cancelada',
  inativa: 'Sem assinatura',
};

// Status e ações da assinatura mensal (Mercado Pago) — independente do form de Perfil acima
// (não faz parte do objeto Perfil por design: o status nunca deve ser algo que o cliente
// possa reescrever via "Salvar perfil", só o servidor decide isso via webhook do Mercado Pago).
function AssinaturaCard({ temEmail }: { temEmail: boolean }) {
  const [status, setStatus] = useState<StatusAssinatura | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');

  function carregar() {
    obterAssinatura()
      .then(setStatus)
      .catch((e) => setErro((e as Error).message))
      .finally(() => setCarregando(false));
  }

  useEffect(() => {
    carregar();
    // Voltando do checkout do Mercado Pago: o webhook pode levar alguns segundos pra chegar —
    // reconsulta o status algumas vezes antes de desistir, em vez de deixar a tela parada.
    const params = new URLSearchParams(window.location.search);
    if (params.get('assinatura') === 'retorno') {
      window.history.replaceState({}, '', window.location.pathname);
      let tentativas = 0;
      const intervalo = setInterval(() => {
        tentativas++;
        carregar();
        if (tentativas >= 5) clearInterval(intervalo);
      }, 3000);
      return () => clearInterval(intervalo);
    }
  }, []);

  async function assinar() {
    setErro('');
    setProcessando(true);
    try {
      const { initPoint } = await iniciarAssinatura();
      window.location.href = initPoint;
    } catch (e) {
      setErro((e as Error).message);
      setProcessando(false);
    }
  }

  async function cancelar() {
    if (
      !confirm(
        'Cancelar sua assinatura? Você perde acesso às funções de IA (foto de refeição, geração de treino, coach) ao final do período já pago.',
      )
    )
      return;
    setErro('');
    setProcessando(true);
    try {
      await cancelarAssinatura();
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setProcessando(false);
    }
  }

  return (
    <div className="cartao">
      <h2><CreditCard size={19} /> Assinatura</h2>
      {carregando && <p className="vazio">Carregando...</p>}
      {!carregando && status && (
        <>
          <p>
            Status: <strong>{ROTULOS_STATUS_ASSINATURA[status.status]}</strong>
            {status.validaAte && (status.status === 'ativa' || status.status === 'atrasada') && (
              <> — próxima cobrança em {new Date(status.validaAte).toLocaleDateString('pt-BR')}</>
            )}
          </p>
          {(status.status === 'inativa' || status.status === 'cancelada') && (
            <>
              {!temEmail && <p className="erro">Preencha e salve seu e-mail acima antes de assinar.</p>}
              <button className="primario" onClick={assinar} disabled={processando || !temEmail}>
                {processando ? 'Abrindo checkout...' : 'Assinar (mensal)'}
              </button>
            </>
          )}
          {status.status === 'atrasada' && (
            <p className="erro">Pagamento pendente — regularize pelo Mercado Pago pra não perder o acesso.</p>
          )}
          {status.status === 'ativa' && (
            <button className="secundario" onClick={cancelar} disabled={processando}>
              {processando ? 'Cancelando...' : 'Cancelar assinatura'}
            </button>
          )}
        </>
      )}
      {erro && <p className="erro">{erro}</p>}
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

  // Se o perfil global mudar (ex.: peso atualizado pela aba Evolução), reflete aqui.
  useEffect(() => setForm(perfil), [perfil]);
  useEffect(() => setDescansoTexto(String(perfil.descansoPadraoSeg)), [perfil.descansoPadraoSeg]);

  function set<K extends keyof Perfil>(campo: K, valor: Perfil[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  function salvar() {
    if (!form.nome.trim()) {
      alert('Dê um nome para o perfil.');
      return;
    }
    aoSalvar({ ...form, idade: idadeDe(form.nascimento) ?? form.idade });
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

      <label>E-mail (usado só pra assinatura)</label>
      <input
        type="email"
        value={form.email ?? ''}
        onChange={(e) => set('email', e.target.value || undefined)}
        placeholder="seu@email.com"
      />

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

      <label>Restrições e alergias</label>
      <textarea value={form.restricoes ?? ''} onChange={(e) => set('restricoes', e.target.value)} placeholder="Ex.: intolerância a lactose, não como carne vermelha..." />

      <label>Preferências alimentares</label>
      <textarea value={form.preferencias ?? ''} onChange={(e) => set('preferencias', e.target.value)} placeholder="Ex.: adoro frango, prefiro comida rápida de preparar..." />

      <label>O que tem na geladeira / despensa</label>
      <textarea value={form.geladeira ?? ''} onChange={(e) => set('geladeira', e.target.value)} placeholder="Ex.: ovos, frango, arroz, banana, aveia, batata-doce..." />

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

      <div className="botoes">
        <button className="primario" onClick={salvar}><IconeSalvar size={16} /> Salvar</button>
      </div>

      <div className="botoes conta-acoes">
        <button className="secundario" onClick={() => { if (confirm('Sair deste aparelho? Seus dados continuam salvos — é só entrar de novo com seu nome e PIN.')) aoSair(); }}>
<LogOut size={16} /> Sair deste aparelho
        </button>
        <button
          className="perigo"
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
          {excluindo ? 'Excluindo...' : <><IconeExcluir size={15} /> Excluir minha conta</>}
        </button>
      </div>
    </div>
    <AssinaturaCard temEmail={!!perfil.email} />
    </>
  );
}
