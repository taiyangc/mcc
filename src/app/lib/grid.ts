/**
 * Height of one dashboard grid row, in pixels.
 *
 * The grid's row tracks and each cell's minimum height are both derived from this, so a
 * cell spanning two rows lines up with the two tracks it occupies. They must not drift
 * apart: a cell taller than the tracks it spans pushes the layout around.
 */
export const GRID_ROW_HEIGHT = 350;
