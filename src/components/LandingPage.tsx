// Página de vendas pública, mostrada antes do login pra visitante novo (ver App.tsx —
// só aparece quando não há sessão salva neste aparelho). Sem depoimentos de clientes por
// decisão explícita: hoje o app tem poucos usuários reais engajados, e atribuir citação a
// alguém que não existe (ou que não autorizou) é falso e ilegal em publicidade — a página
// usa bullets de confiança (garantias, política de cancelamento) no lugar disso.
import { IconeRefeicao, IconeMusculacao, IconeEvolucao, IconeCoach, IconeConcluido } from './Icones';

interface Props {
  aoComecar: () => void;
  aoJaTenhoConta: () => void;
}

const RECURSOS = [
  {
    Icone: IconeRefeicao,
    titulo: 'Tire uma foto, pronto',
    texto: 'Fotografe o prato e receba na hora calorias, proteína, carboidrato, gordura e fibras — sem precisar pesar nem adivinhar.',
  },
  {
    Icone: IconeMusculacao,
    titulo: 'Treino sob medida',
    texto: 'Diga onde treina e o que tem disponível — o Coach monta a ficha, ajusta a carga a cada série e te guia por voz durante o treino.',
  },
  {
    Icone: IconeEvolucao,
    titulo: 'Evolução de verdade',
    texto: 'Peso, medidas, treinos feitos — tudo num só lugar, com gráficos que mostram se você está indo na direção certa.',
  },
  {
    Icone: IconeCoach,
    titulo: 'Um Coach que conversa',
    texto: 'Pergunte, ajuste, peça sugestão de refeição — o Coach responde na hora, como um personal de verdade responderia.',
  },
];

const PASSOS = [
  { numero: '1', titulo: 'Crie sua conta', texto: 'Nome e PIN — sem burocracia, sem precisar decorar senha.' },
  { numero: '2', titulo: 'Conte seus objetivos', texto: 'Perda de peso, hipertrofia, saúde geral — 3 perguntas rápidas pra começar.' },
  { numero: '3', titulo: 'Comece hoje', texto: 'Registre sua primeira refeição ou peça um treino — o Coach assume a partir daí.' },
];

const CONFIANCA = [
  '7 dias completos pra testar sem gastar nada',
  'Cancele quando quiser, direto pelo app',
  'Seus dados são só seus — protegidos e nunca compartilhados',
  'Suporte e Coach 100% em português',
];

const FAQ = [
  {
    p: 'Preciso saber cozinhar ou já treinar bem?',
    r: 'Não. O Coach se adapta ao seu nível, desde quem nunca pisou numa academia até quem já treina há anos.',
  },
  {
    p: 'Funciona só na academia?',
    r: 'Funciona em casa, na rua ou na academia — você escolhe onde e o Coach adapta o treino ao que você tem disponível.',
  },
  {
    p: 'Como cancelo?',
    r: 'Direto no seu Perfil, dentro do app, a qualquer momento — sem precisar ligar pra ninguém.',
  },
  {
    p: 'Quando começo a pagar?',
    r: 'Só depois dos 7 dias grátis. Cancelando antes do fim do teste, você não paga nada.',
  },
  {
    p: 'Preciso informar cartão pra começar?',
    r: 'Sim, o Mercado Pago exige o cartão pra ativar o período de teste — mas a cobrança só acontece depois dos 7 dias, e só se você não cancelar antes.',
  },
  {
    p: 'Meus dados estão seguros?',
    r: 'Sim — suas informações ficam só na sua conta, protegidas, e nunca são vendidas ou compartilhadas.',
  },
];

export default function LandingPage({ aoComecar, aoJaTenhoConta }: Props) {
  return (
    <div className="app landing">
      <header className="topo">
        <h1><IconeMusculacao size={22} /> Meu Coach</h1>
        <button className="chip" onClick={aoJaTenhoConta}>Já tenho conta</button>
      </header>

      <main className="conteudo landing-conteudo">
        <section className="landing-hero">
          <h2>Seu personal trainer e nutricionista, sempre no bolso</h2>
          <p className="landing-subhead">
            Fotografe sua refeição e receba a análise na hora. Diga o que tem em casa ou na
            academia e receba o treino do dia. Um Coach que acompanha sua evolução de verdade —
            todos os dias, sem mensalidade de academia boutique nem preço de personal particular.
          </p>
          <button className="primario grande landing-cta" onClick={aoComecar}>Começar 7 dias grátis</button>
          <p className="landing-microcopy">
            Pede o cartão pra ativar o teste, mas você só paga depois de 7 dias — cancele antes
            disso e não sai nada.
          </p>
        </section>

        <section className="landing-secao">
          <h3>Você já tentou de tudo</h3>
          <p>
            App de contar caloria que não sabe o que você comeu de verdade. Ficha de treino que
            não muda nunca. Personal que custa caro e só vê você uma vez por semana. No fim, a
            dieta e o treino ficam por sua conta mesmo — só que sem ninguém pra ajustar o rumo.
          </p>
        </section>

        <section className="landing-secao">
          <h3>O Meu Coach ajusta o plano com você, todo dia</h3>
          <div className="landing-recursos">
            {RECURSOS.map(({ Icone, titulo, texto }) => (
              <div key={titulo} className="landing-recurso">
                <Icone size={22} />
                <strong>{titulo}</strong>
                <p>{texto}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-secao">
          <h3>Como funciona</h3>
          <div className="landing-passos">
            {PASSOS.map((p) => (
              <div key={p.numero} className="landing-passo">
                <span className="landing-passo-numero">{p.numero}</span>
                <div>
                  <strong>{p.titulo}</strong>
                  <p>{p.texto}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-secao landing-preco">
          <h3>7 dias grátis. Sem letra miúda.</h3>
          <ul className="landing-confianca">
            {CONFIANCA.map((c) => (
              <li key={c}><IconeConcluido size={16} /> {c}</li>
            ))}
          </ul>
          <button className="primario grande landing-cta" onClick={aoComecar}>Começar 7 dias grátis</button>
        </section>

        <section className="landing-secao">
          <h3>Perguntas frequentes</h3>
          {FAQ.map((f) => (
            <details key={f.p} className="landing-faq-item">
              <summary>{f.p}</summary>
              <p>{f.r}</p>
            </details>
          ))}
        </section>

        <section className="landing-secao landing-cta-final">
          <h3>Seu próximo treino pode começar agora</h3>
          <button className="primario grande landing-cta" onClick={aoComecar}>Começar 7 dias grátis</button>
        </section>
      </main>
    </div>
  );
}
