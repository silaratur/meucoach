import { useState } from 'react';
import type { SessaoLogin } from '../auth';
import { criarConta, entrar, listarSessoes } from '../auth';
import { IconeAdicionar, IconeChave, IconePerfil } from './Icones';

interface Props {
  aoEntrar: (s: SessaoLogin, novaConta?: boolean) => void;
  modoInicial?: Modo;
}

type Modo = 'lista' | 'entrar' | 'criar';

export default function LoginTab({ aoEntrar, modoInicial }: Props) {
  const sessoes = listarSessoes();
  const [modo, setModo] = useState<Modo>(modoInicial ?? (sessoes.length ? 'lista' : 'criar'));
  const [nome, setNome] = useState('');
  const [pin, setPin] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  async function fazerEntrar() {
    if (!nome.trim() || pin.length < 4) {
      setErro('Preencha o nome e o PIN (mínimo 4 números).');
      return;
    }
    setCarregando(true);
    setErro('');
    try {
      aoEntrar(await entrar(nome.trim(), pin));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  async function fazerCriar() {
    if (!nome.trim() || pin.length < 4) {
      setErro('Preencha o nome e escolha um PIN de 4 a 6 números.');
      return;
    }
    setCarregando(true);
    setErro('');
    try {
      aoEntrar(await criarConta(nome.trim(), pin), true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="cartao">
      {modo === 'lista' && (
        <>
          <h2>Quem vai treinar hoje?</h2>
          <div className="lista-perfis">
            {sessoes.map((s) => (
              <button key={s.id} className="item-perfil" onClick={() => aoEntrar(s)}>
                <strong><IconePerfil size={17} /> {s.nome}</strong>
                <small>Continuar neste aparelho</small>
              </button>
            ))}
          </div>
          <div className="botoes">
            <button onClick={() => { setModo('entrar'); setErro(''); }}><IconeChave size={16} /> Entrar com outra conta</button>
            <button className="primario" onClick={() => { setModo('criar'); setErro(''); }}><IconeAdicionar size={16} /> Criar conta</button>
          </div>
        </>
      )}

      {modo !== 'lista' && (
        <>
          <h2>{modo === 'criar' ? <><IconeAdicionar size={19} /> Criar conta</> : <><IconeChave size={19} /> Entrar</>}</h2>
          <p className="meta-texto">
            {modo === 'criar'
              ? 'Escolha um nome e um PIN numérico — use esse mesmo PIN para acessar de qualquer celular ou computador, e seus dados estarão sempre lá.'
              : 'Digite o nome e o PIN que você usou ao criar sua conta.'}
          </p>

          <label>Nome</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Como te chamo?" autoFocus />

          <label>PIN (4 a 6 números)</label>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
          />

          <div className="botoes">
            <button
              className="primario grande"
              onClick={modo === 'criar' ? fazerCriar : fazerEntrar}
              disabled={carregando}
            >
              {carregando ? 'Aguarde...' : modo === 'criar' ? <><IconeAdicionar size={17} /> Criar conta</> : <><IconeChave size={17} /> Entrar</>}
            </button>
            {sessoes.length > 0 && (
              <button onClick={() => { setModo('lista'); setErro(''); }}>Voltar</button>
            )}
            {modo === 'entrar' && (
              <button onClick={() => { setModo('criar'); setErro(''); }}>Não tenho conta ainda</button>
            )}
            {modo === 'criar' && sessoes.length === 0 && (
              <button onClick={() => { setModo('entrar'); setErro(''); }}>Já tenho conta</button>
            )}
          </div>
          {erro && <p className="erro">{erro}</p>}
        </>
      )}
    </div>
  );
}
