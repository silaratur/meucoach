import { useState } from 'react';
import type { Perfil } from '../types';
import { DIAS_SEMANA, NIVEIS_EXPERIENCIA, OBJETIVOS } from '../types';
import { IconeComecar, IconeMusculacao } from './Icones';

interface Props {
  perfil: Perfil;
  aoFinalizar: (atualizacoes: Partial<Perfil>) => void;
}

const TOTAL_ETAPAS = 3;

// Primeira experiência de quem acabou de criar conta: só as 2-3 perguntas que de fato mudam
// o que o Coach recomenda (objetivo, nível, dias) — o resto (peso, altura, restrições etc.)
// fica pro formulário completo do Perfil, sem bloquear a pessoa antes de ela ver o app valendo.
export default function OnboardingWizard({ perfil, aoFinalizar }: Props) {
  const [etapa, setEtapa] = useState(0);
  const [objetivo, setObjetivo] = useState<Perfil['objetivo']>(perfil.objetivo);
  const [nivelExperiencia, setNivelExperiencia] = useState(perfil.nivelExperiencia);
  const [diasMusculacao, setDiasMusculacao] = useState<string[]>(perfil.diasMusculacao ?? []);

  function alternarDia(dia: string) {
    setDiasMusculacao((prev) => (prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia]));
  }

  function concluir() {
    aoFinalizar({
      objetivo,
      nivelExperiencia,
      diasMusculacao,
      frequenciaSemana: diasMusculacao.length || perfil.frequenciaSemana,
    });
  }

  const primeiroNome = perfil.nome.split(' ')[0];

  return (
    <div className="app">
      <header className="topo">
        <h1><IconeMusculacao size={20} /> Oi, {primeiroNome}!</h1>
        <button className="chip" onClick={concluir}>Pular</button>
      </header>
      <main className="conteudo">
        <div className="cartao onboarding">
          <div className="onboarding-pontos">
            {Array.from({ length: TOTAL_ETAPAS }, (_, i) => (
              <span key={i} className={`onboarding-ponto ${i === etapa ? 'ativo' : i < etapa ? 'feito' : ''}`} />
            ))}
          </div>

          {etapa === 0 && (
            <div className="aba-conteudo">
              <h2>Qual é o seu objetivo principal?</h2>
              <p className="meta-texto">Isso ajusta sua meta calórica e o tipo de treino que o Coach monta pra você.</p>
              <div className="chips-tipo onboarding-chips">
                {OBJETIVOS.map((o) => (
                  <button key={o.value} type="button" className={`chip ${objetivo === o.value ? 'ativa' : ''}`} onClick={() => setObjetivo(o.value)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {etapa === 1 && (
            <div className="aba-conteudo">
              <h2>Qual sua experiência com musculação?</h2>
              <p className="meta-texto">O Coach usa isso pra calibrar a progressão de carga e a complexidade dos exercícios.</p>
              <div className="chips-tipo onboarding-chips">
                {NIVEIS_EXPERIENCIA.map((n) => (
                  <button key={n.value} type="button" className={`chip ${nivelExperiencia === n.value ? 'ativa' : ''}`} onClick={() => setNivelExperiencia(n.value)}>
                    {n.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {etapa === 2 && (
            <div className="aba-conteudo">
              <h2>Em quais dias você costuma treinar?</h2>
              <p className="meta-texto">Sem certeza ainda? Pode pular — dá pra ajustar isso depois no seu perfil.</p>
              <div className="chips-tipo onboarding-chips">
                {DIAS_SEMANA.map((d) => (
                  <button key={d} type="button" className={`chip ${diasMusculacao.includes(d) ? 'ativa' : ''}`} onClick={() => alternarDia(d)}>
                    {d.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="botoes onboarding-botoes">
            {etapa > 0 && <button className="secundario" onClick={() => setEtapa((e) => e - 1)}>Voltar</button>}
            {etapa < TOTAL_ETAPAS - 1 ? (
              <button className="primario grande" onClick={() => setEtapa((e) => e + 1)}>Continuar</button>
            ) : (
              <button className="primario grande" onClick={concluir}><IconeComecar size={17} /> Ir para o app</button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
