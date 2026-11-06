// =================================================================
// MARCA DE AGUA: prepara el logo del grupo para ponerlo de fondo sobre una hoja CLARA (06-11-2026).
// Un logo blanco sin fondo (como el de Kentucky Derby Office) se ve perfecto sobre colores, pero sobre el blanco de un
// informe desaparece. Esta ayuda mira el logo: si sus partes visibles son claras, lo devuelve en un gris oscuro (misma
// forma y transparencia, en un PNG nuevo en memoria); si ya es oscuro o de colores, lo deja como está. Así UN solo logo
// sirve para todo y la marca de agua siempre se nota. Si el navegador no deja leer la imagen, se usa tal cual.
// =================================================================
(function () {
  'use strict';
  if (window.MarcaAgua) return;
  const cache = {};
  const OSCURO = [44, 42, 38];   // el mismo gris cálido del texto de los informes

  function cargar(url) {
    return new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error('logo')); i.src = url; });
  }

  // ¿Las partes visibles del logo son claras? (promedio de luminosidad de los píxeles con algo de opacidad, > 0.72)
  function esClaro(data) {
    let suma = 0, n = 0;
    for (let k = 0; k < data.length; k += 4) {
      const a = data[k + 3]; if (a < 40) continue;
      suma += (0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]) / 255 * (a / 255); n += a / 255;
    }
    return n > 0 && (suma / n) > 0.72;
  }

  // Devuelve una URL (la misma, o un data:image/png con el logo oscurecido).
  function preparar(url) {
    if (!url) return Promise.resolve(url);
    if (!cache[url]) {
      cache[url] = cargar(url).then(img => {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return url;
        const esc = Math.min(1, 700 / Math.max(w, h));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * esc)); c.height = Math.max(1, Math.round(h * esc));
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
        const px = ctx.getImageData(0, 0, c.width, c.height);
        if (!esClaro(px.data)) return url;
        for (let k = 0; k < px.data.length; k += 4) { px.data[k] = OSCURO[0]; px.data[k + 1] = OSCURO[1]; px.data[k + 2] = OSCURO[2]; }
        ctx.putImageData(px, 0, 0);
        return c.toDataURL('image/png');
      }).catch(() => url);
    }
    return cache[url];
  }

  window.MarcaAgua = { preparar, esClaro };
})();
