import { useEffect, useState } from 'react';
import type { Perfil } from '../types';
import { OBJETIVOS, SUPLEMENTOS_COMUNS } from '../types';
import { idadeDe } from '../calc';
import { aplicarTema } from '../theme';
import { IconeExcluir, IconeSalvar, IconePerfil } from './Icones';
import { Moon, Sun, LogOut, Heart, Copy, Check } from 'lucide-react';

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
    <ApoioCard />
    </>
  );
}
