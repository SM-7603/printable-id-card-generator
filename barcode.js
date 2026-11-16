// Minimal Code 128 (set B) encoder that renders straight to SVG.
// Bundled so the app works offline and from file:// without a CDN.
(function (global) {
  'use strict';

  // Bar/space widths for symbol values 0–105, followed by STOP (106).
  const PATTERNS = (
    '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 ' +
    '221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
    '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 ' +
    '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
    '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 ' +
    '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
    '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
    '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
    '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 ' +
    '214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
    '114131 311141 411131 211412 211214 211232 2331112'
  ).split(' ');

  const START_B = 104;
  const STOP = 106;
  const QUIET = 10; // modules of white space required each side for scanning

  // Returns the list of symbol values (start, data, checksum, stop).
  function encode(text) {
    const values = [START_B];
    for (const ch of String(text)) {
      const code = ch.charCodeAt(0);
      if (code < 32 || code > 127) throw new Error(`Unsupported character "${ch}"`);
      values.push(code - 32);
    }
    let sum = values[0];
    for (let i = 1; i < values.length; i += 1) sum += values[i] * i;
    values.push(sum % 103, STOP);
    return values;
  }

  // Renders `text` as an SVG element. The SVG has a viewBox, so it scales
  // cleanly to whatever size CSS gives it. Returns { svg, modules }.
  function toSvg(text) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    let x = QUIET;
    let path = '';

    encode(text).forEach((value) => {
      const widths = PATTERNS[value];
      for (let i = 0; i < widths.length; i += 1) {
        const w = Number(widths[i]);
        if (i % 2 === 0) path += `M${x} 0h${w}v1h-${w}z`; // even index = bar
        x += w;
      }
    });

    const modules = x + QUIET;
    svg.setAttribute('viewBox', `0 0 ${modules} 1`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Barcode ${text}`);

    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('width', modules);
    rect.setAttribute('height', 1);
    rect.setAttribute('fill', '#fff');
    const bars = document.createElementNS(ns, 'path');
    bars.setAttribute('d', path);
    bars.setAttribute('fill', '#000');
    svg.append(rect, bars);

    return { svg, modules };
  }

  global.Code128 = { encode, toSvg, QUIET };
})(window);
