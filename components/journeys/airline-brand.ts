// Airline colours for the flight card's header: the one place the trip page
// uses colour beyond its blue accent. `stripe` is the livery band under it.
// Every `bg` is dark enough for white text.

export type Brand = { bg: string; stripe: string[] };

const BRANDS: Record<string, Brand> = {
  WN: { bg: "#304CB2", stripe: ["#E31837", "#FFBF27", "#22388A"] },
  AA: { bg: "#0B5AA6", stripe: ["#C30019", "#9DA6AB"] },
  UA: { bg: "#0A3A7E", stripe: ["#1E6FD9", "#8FB8EE"] },
  DL: { bg: "#0B2A5B", stripe: ["#C8102E", "#E8414F"] },
  AS: { bg: "#01426A", stripe: ["#48A9C5", "#7BC142"] },
  B6: { bg: "#003876", stripe: ["#0F6CC4", "#5EB3E4"] },
  NK: { bg: "#2B2B2B", stripe: ["#FFEC00"] },
  F9: { bg: "#0D5640", stripe: ["#6FB33F"] },
  HA: { bg: "#413691", stripe: ["#D3175A", "#F5A2C1"] },
  AC: { bg: "#B5202A", stripe: ["#1F1F1F"] },
  BA: { bg: "#075AAA", stripe: ["#EB2226", "#FFFFFF"] },
  VS: { bg: "#8A0F3A", stripe: ["#E10A0A"] },
  LH: { bg: "#05164D", stripe: ["#F9BA00"] },
  AF: { bg: "#002157", stripe: ["#ED1C24", "#FFFFFF"] },
  KL: { bg: "#006DB5", stripe: ["#00A1DE"] },
  EK: { bg: "#A3151C", stripe: ["#C8A974"] },
  QR: { bg: "#5C0632", stripe: ["#A6A6A6"] },
  SQ: { bg: "#1D3C78", stripe: ["#F5B335"] },
  NH: { bg: "#13448F", stripe: ["#2E8BD6"] },
  JL: { bg: "#7A0C16", stripe: ["#CC0000"] },
  QF: { bg: "#B5121B", stripe: ["#1F1F1F"] },
};

/** Unknown airlines get a quiet ink header in the app's own colours. */
const PLAIN: Brand = { bg: "#2A2A27", stripe: ["#4C8DFF"] };

export const brandOf = (code: string | null): Brand => (code && BRANDS[code]) || PLAIN;

/** The stripe as equal bands, for a CSS background. */
export function stripeCss(b: Brand): string {
  const step = 100 / b.stripe.length;
  return `linear-gradient(90deg, ${b.stripe.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(", ")})`;
}
