// =================================================================
// banderas.js (10-11-2026) — banderas de países (🇺🇸 🇻🇪) también en Windows.
// Windows (Chrome, Edge, Firefox) NO trae las banderas de países en su fuente de emojis: en vez de la bandera se ve "US" o "VE".
// Este archivo comprueba si el navegador sabe dibujar banderas; solo si NO sabe, carga la fuente pequeña (78 KB, una vez; el navegador
// la guarda) con las banderas de Twemoji y se la agrega a las fuentes de la página (Inter, Outfit y la lista del buscador de hipódromos).
// En Mac, iPhone y Android no hace nada: no descarga nada y no cambia nada.
// Fuente: "Twemoji Country Flags" (country-flag-emoji-polyfill, MIT). Dibujos: Twemoji, licencia CC-BY 4.0 (https://twemoji.twitter.com).
// Sin consultas al servidor de datos (Supabase): es un archivo estático.
// =================================================================
(function () {
  try {
    var script = document.currentScript;
    function lienzo() {
      var c = document.createElement('canvas'); c.width = c.height = 1;
      var t = c.getContext('2d', { willReadFrequently: true });
      t.textBaseline = 'top';
      t.font = '100px "Twemoji Mozilla","Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji","EmojiOne Color","Android Emoji",sans-serif';
      t.scale(0.01, 0.01);
      return t;
    }
    function huella(t, texto, color) { t.clearRect(0, 0, 100, 100); t.fillStyle = color; t.fillText(texto, 0, 0); return t.getImageData(0, 0, 1, 1).data.join(','); }
    // Un emoji "de color" se dibuja igual en blanco que en negro; un texto normal cambia con el color.
    function esDeColor(t, texto) { var a = huella(t, texto, '#fff'), b = huella(t, texto, '#000'); return a === b && b.indexOf('0,0,0,') !== 0; }
    var t = lienzo();
    var emojiOk = esDeColor(t, '\u{1F60A}'), banderaOk = esDeColor(t, '\u{1F1E8}\u{1F1ED}');
    if (!emojiOk || banderaOk) return;   // Mac / móvil: ya hay banderas. Navegador sin emojis de color: no se toca.
    var url = script && script.src ? new URL('fonts/TwemojiCountryFlags.woff2', script.src).href : 'fonts/TwemojiCountryFlags.woff2';
    var rango = 'U+1F1E6-1F1FF, U+1F3F4, U+E0062-E0063, U+E0065, U+E0067, U+E006C, U+E006E, U+E0073-E0074, U+E0077, U+E007F';
    function cara(familia, extra) { return '@font-face{font-family:' + familia + ';' + (extra || '') + 'unicode-range:' + rango + ';src:url("' + url + '") format("woff2");font-display:swap}'; }
    var st = document.createElement('style');
    st.id = 'banderas-windows';
    st.textContent = cara('"Twemoji Country Flags"') +
      // Mismas familias que usan las pantallas: solo para los caracteres de bandera, el resto del texto no cambia.
      cara('"Inter"', 'font-weight:100 900;') + cara('"Outfit"', 'font-weight:100 900;') +
      '.bl-panel,.bl-panel *{font-family:system-ui,"Twemoji Country Flags",sans-serif}';
    document.head.appendChild(st);
  } catch (e) { /* si algo falla, queda como antes: nunca rompe la página */ }
})();
