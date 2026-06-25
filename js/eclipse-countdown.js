/* eclipse-countdown.js — countdown compartido, auto-avanzante.
 * Lee window.NE_ECLIPSES (lo inyecta build.mjs: [{start,end,type,en,es}, …],
 * en-curso + próximos en orden cronológico). Mientras un eclipse está en curso
 * (now ∈ [start,end]) muestra "En curso"; al pasar su fin, avanza solo al
 * siguiente. Sin dependencias. DOM esperado: #cd-days/#cd-hours/#cd-mins/
 * #cd-secs + #cd-answer (los mismos ids que ya usaban las páginas). */
(function () {
  var ECL = window.NE_ECLIPSES || [];
  var elD = id('cd-days'), elH = id('cd-hours'), elM = id('cd-mins'), elS = id('cd-secs'), elA = id('cd-answer');
  if (!elA && !elD) return;
  function id(x) { return document.getElementById(x); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function lang() { return document.documentElement.lang === 'es' ? 'es' : 'en'; }
  function ms(s) { return new Date(s).getTime(); }

  function pick() {
    var now = Date.now(), i;
    for (i = 0; i < ECL.length; i++) if (ms(ECL[i].start) <= now && now <= ms(ECL[i].end)) return { ev: ECL[i], live: true };
    for (i = 0; i < ECL.length; i++) if (ms(ECL[i].start) > now) return { ev: ECL[i], live: false };
    return null;
  }
  function setCD(d, h, m, s) {
    if (elD) elD.textContent = d; if (elH) elH.textContent = pad(h);
    if (elM) elM.textContent = pad(m); if (elS) elS.textContent = pad(s);
  }
  function tick() {
    var p = pick(), lg = lang();
    if (!p) { setCD(0, 0, 0, 0); if (elA) elA.textContent = lg === 'en' ? 'New eclipse dates coming soon.' : 'Pronto, nuevas fechas de eclipses.'; return; }
    if (p.live) {
      setCD(0, 0, 0, 0);
      if (elA) elA.innerHTML = (lg === 'en' ? '<strong>Happening now:</strong> the ' : '<strong>En curso ahora:</strong> el ') + p.ev[lg] + '.';
      return;
    }
    var diff = ms(p.ev.start) - Date.now();
    setCD(Math.floor(diff / 86400000), Math.floor(diff / 3600000) % 24, Math.floor(diff / 60000) % 60, Math.floor(diff / 1000) % 60);
    if (elA) elA.innerHTML = (lg === 'en' ? 'Until the ' : 'Hasta el ') + p.ev[lg] + '.';
  }
  tick();
  setInterval(tick, 1000);
})();
