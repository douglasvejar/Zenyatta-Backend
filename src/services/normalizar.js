// Portado tal cual de app.js (sección 2).
//
// OJO (05-09-2026, a pedido del usuario con un ticket real): "si el logro
// que paga un equipo es -120 y hay un espacio entre el signo y la
// cantidad no distingue el logro sea cual sea el signo + o -". Una cuota
// americana escrita como "- 120" (con un espacio de más, fácil de tipear
// sin querer en WhatsApp) no la reconocía NADA de lo que busca cuotas con
// signo pegado al número (extraerCuotaAmericana() en parser.js, y todo lo
// que depende de ella: el cierre automático de "cuota para monto", y el
// aviso de "FALTA LOGRO" en procesarSabana.js) — el número quedaba sin
// signo, y "120" solo no alcanza para saber si es a favor o en contra.
// Se pega el signo a su número ANTES de cualquier otra cosa, así que todo
// lo que ya funcionaba con el signo pegado sigue funcionando exactamente
// igual (esto no le cambia nada), y ahora "+ 130"/"- 120" también.
function normalizarTexto(texto) {
  return texto
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|\u{FE0F}/gu, '')
    .replace(/([+-])\s+(\d)/g, '$1$2')
    .replace(/½/g, '.5')
    .replace(/(\d+),(\d+)/g, '$1.$2')
    .replace(/5to|5inn/gi, ' 5inn ')
    .toLowerCase();
}

module.exports = { normalizarTexto };
