import { useEffect, useState } from 'react';
import type { DadosPerfil, Perfil } from './types';
import type { SessaoLogin } from './auth';
import { definirPerfilAtivo, esquecerNesteAparelho, perfilAtivoId, tokenDe } from './auth';
import { buscarPerfilEDados, excluirContaRemota, salvarDadosRemoto, salvarPerfilRemoto } from './storage';
import { aoNaoAutorizado, definirToken } from './session';
import { aplicarTema } from './theme';
import { IconeCoach, IconeEvolucao, IconeMusculacao, IconePerfil, IconeRefeicao } from './components/Icones';
import PerfilTab from './components/PerfilTab';
import LoginTab from './components/LoginTab';
import DiarioTab from './components/DiarioTab';
import TreinoTab from './components/TreinoTab';
import CoachTab from './components/CoachTab';
import EvolucaoTab from './components/EvolucaoTab';
import OnboardingWizard from './components/OnboardingWizard';

type Aba = 'hoje' | 'treino' | 'evolucao' | 'coach' | 'perfil';

export default function App() {
  const [ativoId, setAtivoId] = useState<string | null>(() => perfilAtivoId());
  const [aba, setAba] = useState<Aba>('hoje');
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [dados, setDados] = useState<DadosPerfil | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erroCarregar, setErroCarregar] = useState('');
  // Conta recém-criada: mostra o assistente de 3 perguntas antes do app normal, em vez de
  // já jogar a pessoa no formulário de perfil completo (~15 campos).
  const [mostrarOnboarding, setMostrarOnboarding] = useState(false);

  // Se o servidor recusar o token (expirado/inválido), volta para a tela de login.
  useEffect(() => {
    aoNaoAutorizado(() => {
      if (ativoId) esquecerNesteAparelho(ativoId);
      setAtivoId(null);
    });
  }, [ativoId]);

  // Sempre que a pessoa ativa muda, busca o perfil e os dados dela no servidor —
  // assim funciona igual em qualquer aparelho.
  useEffect(() => {
    let cancelado = false;
    if (!ativoId) {
      definirToken(null);
      setPerfil(null);
      setDados(null);
      return;
    }
    const token = tokenDe(ativoId);
    if (!token) {
      setAtivoId(null);
      return;
    }
    definirToken(token);
    setCarregando(true);
    setErroCarregar('');
    buscarPerfilEDados()
      .then(({ perfil, dados }) => {
        if (cancelado) return;
        setPerfil(perfil);
        setDados(dados);
        aplicarTema(perfil.tema ?? 'escuro');
      })
      .catch((e) => {
        if (cancelado) return;
        setErroCarregar((e as Error).message);
      })
      .finally(() => !cancelado && setCarregando(false));
    return () => {
      cancelado = true;
    };
  }, [ativoId]);

  function aoEntrar(s: SessaoLogin, novaConta?: boolean) {
    definirPerfilAtivo(s.id);
    setAtivoId(s.id);
    setAba('hoje');
    if (novaConta) setMostrarOnboarding(true);
  }

  function aoFinalizarOnboarding(atualizacoes: Partial<Perfil>) {
    if (perfil) atualizarPerfil({ ...perfil, ...atualizacoes });
    setMostrarOnboarding(false);
  }

  function trocarConta() {
    definirPerfilAtivo(null);
    setAtivoId(null);
  }

  function sairDesteAparelho() {
    if (ativoId) esquecerNesteAparelho(ativoId);
    setAtivoId(null);
  }

  async function excluirConta() {
    await excluirContaRemota();
    if (ativoId) esquecerNesteAparelho(ativoId);
    setAtivoId(null);
  }

  function atualizarDados(mudanca: (d: DadosPerfil) => DadosPerfil) {
    if (!dados) return;
    const novo = mudanca(dados);
    setDados(novo);
    salvarDadosRemoto(novo).catch((e) => console.error('Falha ao sincronizar dados:', e));
  }

  function atualizarPerfil(p: Perfil) {
    setPerfil(p);
    salvarPerfilRemoto(p).catch((e) => console.error('Falha ao sincronizar perfil:', e));
  }

  // Sem sessão ativa: login / criação de conta
  if (!ativoId || !perfil || !dados) {
    return (
      <div className="app">
        <header className="topo">
          <h1>💪 Meu Coach</h1>
          <p className="sub">Seu personal e nutricionista de bolso</p>
        </header>
        <main className="conteudo">
          {carregando && <p className="vazio">Carregando seus dados...</p>}
          {!carregando && erroCarregar && <p className="erro">{erroCarregar}</p>}
          {!carregando && <LoginTab aoEntrar={aoEntrar} />}
        </main>
      </div>
    );
  }

  if (mostrarOnboarding) {
    return <OnboardingWizard perfil={perfil} aoFinalizar={aoFinalizarOnboarding} />;
  }

  return (
    <div className="app">
      <header className="topo">
        <h1>💪 Meu Coach</h1>
        <button className="chip" onClick={trocarConta} title="Trocar de pessoa">
          👤 {perfil.nome}
        </button>
      </header>

      <main className="conteudo">
        <div key={aba} className="aba-conteudo">
          {aba === 'hoje' && <DiarioTab perfil={perfil} dados={dados} atualizar={atualizarDados} />}
          {aba === 'treino' && (
            <TreinoTab perfil={perfil} dados={dados} atualizar={atualizarDados} aoAtualizarPerfil={atualizarPerfil} />
          )}
          {aba === 'evolucao' && (
            <EvolucaoTab
              perfil={perfil}
              dados={dados}
              atualizar={atualizarDados}
              aoMudarPeso={(pesoKg) => atualizarPerfil({ ...perfil, pesoKg })}
            />
          )}
          {aba === 'coach' && <CoachTab perfil={perfil} dados={dados} atualizar={atualizarDados} />}
          {aba === 'perfil' && (
            <PerfilTab
              perfil={perfil}
              aoSalvar={atualizarPerfil}
              aoSair={sairDesteAparelho}
              aoExcluirConta={excluirConta}
            />
          )}
        </div>
      </main>

      <nav className="abas">
        <button className={aba === 'hoje' ? 'ativa' : ''} onClick={() => setAba('hoje')}>
          <IconeRefeicao size={22} strokeWidth={2} /><span>Hoje</span>
        </button>
        <button className={aba === 'treino' ? 'ativa' : ''} onClick={() => setAba('treino')}>
          <IconeMusculacao size={22} strokeWidth={2} /><span>Treino</span>
        </button>
        <button className={aba === 'evolucao' ? 'ativa' : ''} onClick={() => setAba('evolucao')}>
          <IconeEvolucao size={22} strokeWidth={2} /><span>Evolução</span>
        </button>
        <button className={aba === 'coach' ? 'ativa' : ''} onClick={() => setAba('coach')}>
          <IconeCoach size={22} strokeWidth={2} /><span>Coach</span>
        </button>
        <button className={aba === 'perfil' ? 'ativa' : ''} onClick={() => setAba('perfil')}>
          <IconePerfil size={22} strokeWidth={2} /><span>Perfil</span>
        </button>
      </nav>
    </div>
  );
}
