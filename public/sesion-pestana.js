// =================================================================
// SESIÓN POR PESTAÑA (30-10-2026).
// Problema real: el inicio de sesión se guardaba SOLO en localStorage ('zenyatta_token' / 'zenyatta_grupo'), que es UNO PARA TODO el
// navegador. Con dos grupos abiertos en pestañas distintas (ej. Largavita y Zenyatta), el último que iniciaba sesión pisaba al otro y,
// al dar F5 en la pestaña de Largavita, esa pestaña pasaba a trabajar como Zenyatta (nombre, datos y planos del grupo equivocado).
//
// Ahora cada pestaña recuerda SU sesión en sessionStorage (sobrevive a F5 y a navegar entre las páginas de la misma pestaña) y
// localStorage queda solo como "última sesión usada", para que una pestaña NUEVA abra ya con sesión y para que al reabrir el
// navegador no haya que volver a entrar. Se aplica por debajo: el resto del código sigue llamando a localStorage como siempre.
// Este archivo debe cargarse ANTES que cualquier otro script que lea la sesión.
// =================================================================
(function () {
  var CLAVES = { zenyatta_token: 1, zenyatta_grupo: 1, zenyatta_ultima_actividad: 1 };
  var PREF = 'zenyatta_pestana_';
  var LS, SS, get, set, rem;
  try {
    LS = window.localStorage; SS = window.sessionStorage;
    LS.getItem('zenyatta_probe'); SS.getItem('zenyatta_probe');
    var proto = window.Storage && window.Storage.prototype;
    if (!proto) return;
    get = proto.getItem; set = proto.setItem; rem = proto.removeItem;
  } catch (e) { return; } // sin almacenamiento (modo privado estricto): todo sigue como siempre
  var p = window.Storage.prototype;

  p.getItem = function (k) {
    if (this === LS && CLAVES[k]) {
      var propio = get.call(SS, PREF + k);
      if (propio !== null) return propio;
      if (get.call(SS, PREF + 'cerrada') === '1') return null; // esta pestaña cerró sesión: no se vuelve a "adoptar" la de otra
      var global = get.call(LS, k);
      if (global !== null) set.call(SS, PREF + k, global); // primera lectura de una pestaña nueva: adopta la última sesión usada
      return global;
    }
    return get.call(this, k);
  };

  p.setItem = function (k, v) {
    if (this === LS && CLAVES[k]) {
      set.call(SS, PREF + k, v);
      if (k === 'zenyatta_token') rem.call(SS, PREF + 'cerrada');
      set.call(LS, k, v);
      if (k === 'zenyatta_token' || k === 'zenyatta_grupo') {
        // El par token+grupo siempre se copia completo y de la MISMA pestaña, para que una pestaña nueva nunca mezcle uno con otro.
        var otro = k === 'zenyatta_token' ? 'zenyatta_grupo' : 'zenyatta_token';
        var mio = get.call(SS, PREF + otro);
        if (mio !== null) set.call(LS, otro, mio);
      }
      return;
    }
    return set.call(this, k, v);
  };

  p.removeItem = function (k) {
    if (this === LS && CLAVES[k]) {
      var mio = get.call(SS, PREF + k);
      rem.call(SS, PREF + k);
      if (k === 'zenyatta_token') set.call(SS, PREF + 'cerrada', '1');
      var glob = get.call(LS, k);
      // Solo se borra la copia compartida si era la de ESTA pestaña: cerrar la sesión de un grupo no tumba la de otro.
      if (mio === null || glob === mio) {
        rem.call(LS, k);
        if (k === 'zenyatta_token') { rem.call(LS, 'zenyatta_grupo'); rem.call(LS, 'zenyatta_ultima_actividad'); }
      }
      return;
    }
    return rem.call(this, k);
  };
})();
