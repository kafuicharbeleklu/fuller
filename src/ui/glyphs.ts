import stringWidth from 'string-width';

/**
 * Some symbols (⏺ ⏵ ⏸) are "wide" for string-width/Ink but rendered on a single
 * column by most terminals. When Ink already reserves two cells we add no extra
 * space, so the visible gap is always exactly one column.
 */
function gap(glyph: string): string {
  return stringWidth(glyph) >= 2 ? '' : ' ';
}

export const BULLET = '⏺';
export const BULLET_GAP = gap(BULLET);
export const RESULT = '⎿';
export const PLAY = '⏵⏵';
export const PLAY_GAP = gap('⏵');
export const PAUSE = '⏸';
export const PAUSE_GAP = gap(PAUSE);
