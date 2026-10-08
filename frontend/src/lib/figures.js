// Figures on cards. A long amount is shown short ("£1.25M") so it never has to be cut off;
// the full amount is always in the card's tooltip and its accessible name.

const UNITS = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
const FIGURE = /^(\D*?)(-?\d[\d,]*(?:\.\d+)?)(\D*)$/;

/**
 * "£1,245,300.00" becomes "£1.25M" and "£12,345.67" becomes "£12.3K". Anything of `limit`
 * characters or fewer ("£300.00"), anything under a thousand, and anything that isn't a single
 * number with an optional sign or unit around it ("3 of 7", "Not enough evidence yet") is left as it is.
 */
export function compactFigure(text, limit = 7) {
  const full = String(text ?? "");
  if (full.length <= limit) return full;
  const parts = full.match(FIGURE);
  if (!parts) return full;
  const value = Number(parts[2].replace(/,/g, ""));
  if (!Number.isFinite(value) || Math.abs(value) < 1000) return full;
  const [size, letter] = UNITS.find(([u]) => Math.abs(value) >= u);
  const short = Number((value / size).toPrecision(3));
  // 999,950 rounds to 1000K: say 1M instead.
  const bumped = Math.abs(short) >= 1000 && UNITS.find(([u]) => u === size * 1000);
  return `${parts[1]}${bumped ? Number((value / bumped[0]).toPrecision(3)) : short}${bumped ? bumped[1] : letter}${parts[3]}`;
}

/** True when the text is a figure (so it must stay on one line), not a result in words. */
export const isFigure = (text) => FIGURE.test(String(text ?? ""));
