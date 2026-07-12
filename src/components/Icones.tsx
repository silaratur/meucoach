// Ícones funcionais do app (navegação, ações de botão, conteúdo) em SVG — via lucide-react.
// Usam stroke="currentColor" por padrão, então herdam a cor do texto do elemento pai e se
// adaptam automaticamente ao tema claro/escuro, sem precisar de nenhuma lógica extra.
// Os grupos abaixo cobrem tanto a navegação/controles quanto os emojis de conteúdo que antes
// apareciam em chips e cabeçalhos (tipo de refeição, local de treino, avaliação, dicas, etc.) —
// substituídos por ícones para manter a aparência de um app profissional de saúde.
export {
  Utensils as IconeRefeicao,
  Dumbbell as IconeMusculacao,
  TrendingUp as IconeEvolucao,
  Bot as IconeCoach,
  UserRound as IconePerfil,
  Trash2 as IconeExcluir,
  Pencil as IconeEditar,
  Plus as IconeAdicionar,
  Play as IconeComecar,
  Pause as IconePausa,
  CheckCircle2 as IconeConcluido,
  SkipForward as IconePular,
  StopCircle as IconeParar,
  RotateCcw as IconeTrocar,
  History as IconeHistorico,
  Video as IconeVideo,
  Camera as IconeCamera,
  Image as IconeGaleria,
  Mic as IconeMicrofone,
  KeyRound as IconeChave,
  ImageOff as IconeImagemIndisponivel,
  Save as IconeSalvar,
} from 'lucide-react';

// Ícones de conteúdo: tipo de refeição, local/tipo de treino, avaliação, aquecimento, dicas.
import {
  Coffee,
  Apple,
  UtensilsCrossed,
  Cookie,
  Soup,
  Moon,
  Pill,
  Home,
  Footprints,
  ClipboardList,
  Flame,
  Lightbulb,
  Activity,
  BedDouble,
  StretchHorizontal,
  Dumbbell,
  Link2,
  Settings,
  PersonStanding,
} from 'lucide-react';
import type { LocalTreino, TipoRefeicao } from '../types';
import type { TipoEquipamento } from '../calc';

export {
  Coffee as IconeCafeManha,
  Apple as IconeLancheManha,
  UtensilsCrossed as IconeAlmoco,
  Cookie as IconeLancheTarde,
  Soup as IconeJantar,
  Moon as IconeCeia,
  Pill as IconeSuplemento,
  Home as IconeCasa,
  Footprints as IconeCorrida,
  ClipboardList as IconeAvaliacao,
  Flame as IconeAquecimento,
  Lightbulb as IconeDica,
  Activity as IconeAtividade,
  BedDouble as IconeSono,
  StretchHorizontal as IconeAlongamento,
};

// Mapas de ícone por valor — usados nos chips que antes mostravam um emoji por tipo.
export const ICONE_REFEICAO: Record<TipoRefeicao, typeof Coffee> = {
  cafe: Coffee,
  lanche_manha: Apple,
  almoco: UtensilsCrossed,
  lanche_tarde: Cookie,
  jantar: Soup,
  ceia: Moon,
  suplemento: Pill,
};

export const ICONE_LOCAL: Record<LocalTreino, typeof Coffee> = {
  academia: Dumbbell,
  casa: Home,
  rua: Footprints,
};

// Ícone de equipamento por categoria inferida (ver tipoEquipamento em calc.ts) — usado no
// lugar do emoji que antes aparecia junto ao nome do exercício durante o treino guiado.
export const ICONE_EQUIPAMENTO: Record<TipoEquipamento, typeof Coffee> = {
  cabo: Link2,
  maquina: Settings,
  peso_livre: Dumbbell,
  suspensao: PersonStanding,
  cardio: Footprints,
  geral: Dumbbell,
};
