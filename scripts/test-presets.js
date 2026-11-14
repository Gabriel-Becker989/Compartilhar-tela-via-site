// Teste dos presets de vídeo em modo isolado. Não entra em sala e não captura áudio.
//
// Inicia o Electron com COLLAB_ISOLATED_RUN=1 e --remote-debugging-port em 127.0.0.1,
// chama as funções do próprio public/app.js (getQualityPreset + captureScreenStream)
// para cada preset na primeira tela, mede resolução e FPS reais com
// MediaStreamTrackProcessor durante 6 s e fecha a janela, registrando o código de saída.
//
// Uso (Windows nativo, PowerShell comum):
//   node scripts/test-presets.js [rótulo] [flags extras do Electron...]
// Exemplos:
//   node scripts/test-presets.js padrao
//   node scripts/test-presets.js npmstart --disable-gpu --disable-gpu-compositing --no-sandbox
// Variáveis opcionais: PRESET_TEST_PORT (padrão 9333).
const { spawn } = require('child_process');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const label = process.argv[2] || 'padrao';
const extra = process.argv.slice(3);
const port = Number(process.env.PRESET_TEST_PORT || 9333);
const electronExe = path.join(repo, 'node_modules', 'electron', 'dist', 'electron.exe');

const env = { ...process.env, COLLAB_ISOLATED_RUN: '1' };
delete env.COLLAB_ISOLATED_ADDON;
delete env.ELECTRON_RUN_AS_NODE;

const args = ['.', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', ...extra];
console.log(`[${label}] spawn electron ${args.join(' ')}`);
const child = spawn(electronExe, args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', d => process.stdout.write(`[main] ${d}`));
child.stderr.on('data', d => { const s = String(d); if (!/DevTools listening/.test(s)) process.stdout.write(`[main:err] ${s}`); });
const exitPromise = new Promise(res => child.on('exit', (code, sig) => res({ code, sig })));

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const t = list.find(x => x.type === 'page' && /index\.html/.test(x.url));
      if (t) return t;
    } catch (_) {}
    await sleep(500);
  }
  throw new Error('page target não encontrado');
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return { ready, send, close: () => ws.close() };
}

// Código executado no renderer. Usa as funções globais do próprio app.js.
const pageTest = `(async () => {
  const out = { display: { w: screen.width, h: screen.height, dpr: devicePixelRatio,
                           physW: Math.round(screen.width*devicePixelRatio), physH: Math.round(screen.height*devicePixelRatio) },
                ua: navigator.userAgent, results: [] };
  if (typeof captureScreenStream !== 'function' || typeof getQualityPreset !== 'function') throw new Error('funções do app.js ausentes');
  const sources = await window.electronAPI.getSources();
  const scr = sources.filter(s => s.id.startsWith('screen'));
  out.screens = scr.map(s => ({ id: s.id, name: s.name, display_id: s.display_id }));
  const src = scr[0];
  if (!src) throw new Error('nenhuma tela');
  out.sourceUsed = src.id;

  // Animação de tela cheia para garantir conteúdo mudando a cada vsync
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:999999;pointer-events:none';
  cv.width = 640; cv.height = 360; document.body.appendChild(cv);
  const g = cv.getContext('2d'); let run = true, n = 0;
  (function tick(){ if(!run) return; n++; g.fillStyle = 'hsl(' + (n*7%360) + ',70%,40%)'; g.fillRect(0,0,640,360);
    g.fillStyle='#fff'; g.font='48px sans-serif'; g.fillText('preset test ' + n, 20 + (n*5)%300, 200); requestAnimationFrame(tick); })();
  // mede rAF (taxa de atualização do monitor)
  const rafRate = await new Promise(r => { let c=0; const t0=performance.now(); (function f(t){ c++; if (t - t0 < 2000) requestAnimationFrame(f); else r(c*1000/(t-t0)); })(t0); });
  out.display.rafHz = +rafRate.toFixed(1);

  for (const key of ['480p30','720p30','720p60','1080p30','1080p60']) {
    const preset = getQualityPreset(key);
    const r = { key, expected: { w: preset.width, h: preset.height, fps: preset.frameRate } };
    let stream;
    try {
      stream = await captureScreenStream(src.id, preset);
      const tr = stream.getVideoTracks()[0];
      try { tr.contentHint = 'detail'; } catch (_) {}
      try { await tr.applyConstraints({ degradationPreference: 'maintain-resolution' }); } catch (e) { r.applyErr = e.message; }
      r.audioTracks = stream.getAudioTracks().length;
      r.settingsInitial = tr.getSettings();
      // aquecimento
      const proc = new MediaStreamTrackProcessor({ track: tr });
      const reader = proc.readable.getReader();
      const warm = performance.now() + 1500;
      while (performance.now() < warm) { const { value } = await reader.read(); value && value.close(); }
      // medição 6 s
      let frames = 0, dims = {}, ts = [];
      const t0 = performance.now(), end = t0 + 6000;
      while (performance.now() < end) {
        const { value, done } = await reader.read(); if (done) break;
        frames++; ts.push(value.timestamp); const k = value.displayWidth + 'x' + value.displayHeight; dims[k] = (dims[k]||0)+1; value.close();
      }
      const el = (performance.now() - t0) / 1000;
      const gaps = []; for (let i=1;i<ts.length;i++) gaps.push((ts[i]-ts[i-1])/1000);
      gaps.sort((a,b)=>a-b);
      r.measured = { frames, seconds: +el.toFixed(2), fps: +(frames/el).toFixed(1), frameDims: dims,
                     gapMsMedian: gaps.length ? +gaps[gaps.length>>1].toFixed(1) : null,
                     gapMsP95: gaps.length ? +gaps[Math.floor(gaps.length*0.95)].toFixed(1) : null,
                     gapMsMax: gaps.length ? +gaps[gaps.length-1].toFixed(1) : null };
      r.settingsFinal = tr.getSettings();
      reader.cancel().catch(()=>{});
    } catch (e) { r.error = e.name + ': ' + e.message; }
    finally { if (stream) stream.getTracks().forEach(t => t.stop()); }
    out.results.push(r);
    await new Promise(z => setTimeout(z, 500));
  }
  run = false; cv.remove();
  out.roomConnected = !!(typeof myRoom !== 'undefined' && myRoom);
  return JSON.stringify(out);
})()`;

function printSummary(json) {
  const j = JSON.parse(json);
  console.log(`[${label}] tela ${j.display.physW}x${j.display.physH} rAF≈${j.display.rafHz} Hz, fonte ${j.sourceUsed}, sala conectada: ${j.roomConnected}`);
  for (const r of j.results) {
    if (r.error) { console.log(`  ${r.key.padEnd(8)} ERRO ${r.error}`); continue; }
    const s = r.settingsFinal, m = r.measured;
    console.log(`  ${r.key.padEnd(8)} pedido ${r.expected.w}x${r.expected.h}@${r.expected.fps}  entregue ${s.width}x${s.height}  ${m.fps} fps  intervalo med/p95/max ${m.gapMsMedian}/${m.gapMsP95}/${m.gapMsMax} ms`);
  }
}

(async () => {
  let result = null, err = null;
  try {
    const t = await getTarget();
    const c = cdp(t.webSocketDebuggerUrl); await c.ready;
    await sleep(2500); // deixa a página carregar
    const r = await c.send('Runtime.evaluate', { expression: pageTest, awaitPromise: true, returnByValue: true, timeout: 120000 });
    if (r.result && r.result.exceptionDetails) err = JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails);
    else result = r.result && r.result.result && r.result.result.value;
    await c.send('Runtime.evaluate', { expression: 'window.close()' });
    c.close();
  } catch (e) { err = String(e && e.stack || e); }
  const timeout = sleep(20000).then(() => 'timeout');
  const ex = await Promise.race([exitPromise, timeout]);
  let code;
  if (ex === 'timeout') { console.log(`[${label}] electron não saiu em 20s; matando`); child.kill(); const ex2 = await exitPromise; console.log(`[${label}] EXIT (forçado)`, JSON.stringify(ex2)); code = 2; }
  else { console.log(`[${label}] EXIT code=${ex.code} signal=${ex.sig}`); code = ex.code === 0 ? 0 : 1; }
  if (err) { console.log(`[${label}] ERRO`, err); code = code || 1; }
  if (result) { printSummary(result); console.log(`[${label}] RESULT ${result}`); }
  process.exitCode = code;
})();
