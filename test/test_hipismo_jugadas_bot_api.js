// =================================================================
// PRUEBA: lectura de apuestas de la pestaña JUGADAS BOT IA (19-11-2026): lo que se escribe en el panel se entiende igual que en el chat,
// y lo que se guarda vuelve a mostrarse igual (para poder editarlo). La API completa contra Postgres real: test/manual/api_jugadas_bot_pglite.js.
// =================================================================
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;
Module._load = function (request) { if (request === 'pg') return { Pool: function () { this.query = async () => ({ rows: [] }); this.connect = async () => ({ query: async () => ({ rows: [] }), release() {} }); this.on = () => {}; } }; return originalLoad.apply(this, arguments); };
process.env.DATABASE_URL = 'postgresql://fake/fake';
const R = require(path.join(__dirname, '..', 'src', 'routes', 'hipismoJugadasBot'));
const motor = require(path.join(__dirname, '..', 'src', 'services', 'hipismoJugadasChat'));
Module._load = originalLoad;
let pasaron = 0, fallaron = 0;
const check = (c, m) => { if (c) { pasaron++; console.log('OK:', m); } else { fallaron++; console.error('FALLÓ:', m); } };

for (const t of ['Juego 4x1 con 20 doy a8', 'Juego 3n del 8 con 200', 'Juego 2y2 y 2p del 5 con 40', 'Juego 4.1x5 con 12', 'Juego 1x4 recibo a7 con 30', 'Juego 2p del 5 con 10', 'Juego 1p del 3 con 10']) {
  const o = motor.interpretarOferta(t);
  const a = motor.apuestaDesdeElJugador({ lado: o.lado, apuesta: o.apuesta });
  const txt = R._apuestaComoTexto(a);
  const j = R._armarJugada({ apuestaTxt: txt, monto: 10 });
  check(j.ok && JSON.stringify(j.apuesta) === JSON.stringify(a), '"' + t.replace(/ con \d+/, '') + '" se muestra como "' + txt + '" y al guardarla se entiende igual');
}
let j = R._armarJugada({ apuestaTxt: '4x1 doy a8', monto: 100 });
check(j.ok && j.riesgoJugador === 100 && j.riesgoBanquero === 80 && j.monto === 100, 'riesgo de un cruce 10a8: el que juega 100 %, el que da 80 %');
j = R._armarJugada({ apuestaTxt: 'Juego 3n del 8', monto: 50 });
check(j.ok && j.apuesta.modalidad === '3n', 'si escriben "Juego" al principio, se acepta igual');
check(!R._armarJugada({ apuestaTxt: '4x1 doy a8', monto: 0 }).ok && !R._armarJugada({ apuestaTxt: '4x1 doy a8', monto: -5 }).ok, 'un monto en 0 o negativo se rechaza');
check(!R._armarJugada({ apuestaTxt: '', monto: 10 }).ok && !R._armarJugada({ apuestaTxt: 'cosa rara', monto: 10 }).ok, 'una apuesta vacía o ilegible se rechaza con explicación');
console.log('\n' + pasaron + ' OK, ' + fallaron + ' fallaron.');
process.exit(fallaron ? 1 : 0);
