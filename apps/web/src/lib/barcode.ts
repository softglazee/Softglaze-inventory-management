// Dependency-free Code 128 (subset B) encoder → a string of module widths, alternating
// bar/space starting with a bar. Used by the shelf-label printer (D3). No external libs.

const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

/** Returns the Code128-B module-width string for `data` (empty string if nothing printable). */
export function code128B(data: string): string {
  const codes: number[] = [104]; // start B
  for (const ch of data) {
    const v = ch.charCodeAt(0) - 32;
    if (v >= 0 && v <= 94) codes.push(v);
  }
  if (codes.length === 1) return "";
  let sum = 104;
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103); // checksum
  codes.push(106); // stop
  return codes.map((c) => PATTERNS[c]).join("");
}

/** Convert the width string into positioned black bars for an SVG (module = 1 unit). */
export function code128Bars(data: string): { bars: { x: number; w: number }[]; width: number } {
  const widths = code128B(data);
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (let i = 0; i < widths.length; i++) {
    const w = Number(widths[i]);
    if (i % 2 === 0) bars.push({ x, w }); // even index = bar
    x += w;
  }
  return { bars, width: x };
}
