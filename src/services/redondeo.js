// Redondeo a centavos a prueba de empates (medio centavo siempre sube en valor
// absoluto) y sin "-0". Es EXACTAMENTE el mismo criterio de round2() en
// hipismoAdelantadasCalc.js (ahí quedó explicado por qué: Math.round pelado
// redondea -0,125 a -0,12 pero 0,125 a 0,13, y deja 1,005 en 1,00). Todo lo que
// se muestre o se suma como dinero en Hipismo usa este mismo criterio, para que
// pantallas, textos de WhatsApp e imágenes den el mismo centavo.
function redondear2(n) {
  const x = Number(n) || 0;
  const signo = x < 0 ? -1 : 1;
  return signo * Math.round(Math.abs(x) * 100 + 1e-6) / 100 || 0;
}
module.exports = { redondear2 };
