export type LogoStyle = 'block' | 'dome' | 'star' | 'monogram' | 'prism' | 'classic';

export interface LogoDefinition {
  name: string;
  description: string;
  lines: string[];
}

export const LOGOS: Record<LogoStyle, LogoDefinition> = {
  block: {
    name: 'F en blocs',
    description: 'F sur trois lignes, même gabarit que le logo de Claude Code',
    lines: [
      ' ▐██▀▀▀▀ ',
      ' ▐██▀▀▀  ',
      ' ▐██     ',
    ],
  },
  dome: {
    name: 'Dôme géodésique',
    description: 'Structure hexagonale',
    lines: [
      '   ╱─╲   ',
      '  ╱ ◈ ╲  ',
      '  ╲───╱  ',
    ],
  },
  star: {
    name: 'Étoile géométrique',
    description: 'Noyau cristallin à facettes et étincelles',
    lines: [
      '    ▲    ',
      '  ◄ ◈ ►  ',
      '    ▼    ',
    ],
  },
  monogram: {
    name: 'Monogramme F',
    description: 'F en relief ombré FIGlet',
    lines: [
      '  ██████╗',
      '  ██╔═══╝',
      '  █████╗ ',
      '  ██╔══╝ ',
      '  ██║    ',
      '  ╚═╝    ',
    ],
  },
  prism: {
    name: 'Prisme 3D',
    description: 'Polyèdre isométrique',
    lines: [
      '   ┌─┐   ',
      '  ┌┴─┴┐  ',
      '  └─┬─┘  ',
    ],
  },
  classic: {
    name: 'Constellation',
    description: 'Étincelles florales discrètes',
    lines: [
      '    ✦    ',
      '  ✧ ◈ ✧  ',
      '    ✦    ',
    ],
  },
};
