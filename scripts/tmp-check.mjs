const base = 'http://127.0.0.1:9333';
const targets = await (await fetch(base + '/json/list')).json();
const connect = async target => {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
  await new Promise(r => ws.addEventListener('open', r));
  return { ws, send };
};
const main = await connect(targets.find(t => t.type === 'page' && !t.url.includes('win=')));
const desk = await connect(targets.find(t => t.type === 'page' && t.url.includes('win=desktop-lyrics')));
await desk.send('Runtime.evaluate', { expression: `(() => { const r=window.__akiDesktopCanvas; if(!r || r.__wrapped) return; const o=r.draw.bind(r); r.draw=opts=>{window.__akiLastNow=opts.now; return o(opts)}; r.__wrapped=true; })()` });
for (let i = 0; i < 8; i++) {
  const m = await main.send('Runtime.evaluate', { expression: `(() => { const app=document.querySelector('#app').__vue__; const walk=(c,n)=>{if(!c)return null;if(c.$options&&c.$options.name===n)return c;for(const k of c.$children||[]){const f=walk(k,n);if(f)return f}return null}; const lyr=walk(app,'Lyrics'); const idx=lyr.highlightLyricIndex; const line=lyr.lines[Math.max(0,idx)]; return { seek: app.$store.state.player.seek(null,false), idx, text: (line?.words||[]).map(w=>w.text).join('') }; })()`, returnByValue: true });
  const d = await desk.send('Runtime.evaluate', { expression: `(() => ({ now: window.__akiLastNow ?? null, idx: window.__akiDesktopCanvas?.currentLayout?.index ?? null, text: window.__akiDesktopCanvas?.currentLayout?.text ?? null }))()`, returnByValue: true });
  console.log(JSON.stringify({ main: m.result.value, desk: d.result.value, diffMs: d.result.value.now != null ? Math.round((d.result.value.now - m.result.value.seek)*1000) : null }));
  await new Promise(r => setTimeout(r, 450));
}
main.ws.close(); desk.ws.close();
