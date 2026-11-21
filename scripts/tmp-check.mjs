import fs from 'node:fs';
const base = 'http://127.0.0.1:9333';
const targets = await (await fetch(base + '/json/list')).json();
const connect = async target => {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
  await new Promise(r => ws.addEventListener('open', r));
  await send('Page.enable');
  return { ws, send };
};
const main = await connect(targets.find(t => t.type === 'page' && !t.url.includes('win=')));
const desk = await connect(targets.find(t => t.type === 'page' && t.url.includes('win=desktop-lyrics')));
const seekAndCapture = async (t, mainName, deskName) => {
  const r = await main.send('Runtime.evaluate', {
    expression: `(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms)); const app=document.querySelector('#app').__vue__; app.$store.state.player.seek(${t}); await s(350); const lyr=(()=>{const walk=(c,n)=>{if(!c)return null;if(c.$options&&c.$options.name===n)return c;for(const k of c.$children||[]){const f=walk(k,n);if(f)return f}return null}; return walk(app,'Lyrics')})(); const idx=lyr.highlightLyricIndex; return { seek: app.$store.state.player.seek(null,false), idx, text:(lyr.lines[Math.max(0,idx)]?.words||[]).map(w=>w.text).join('') };})()`,
    awaitPromise: true, returnByValue: true });
  console.log('main', JSON.stringify(r.result.value));
  const sm = await main.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`C:/Users/Asamo/AppData/Local/Temp/${mainName}.png`, Buffer.from(sm.data, 'base64'));
  await new Promise(r => setTimeout(r, 400));
  if (deskName) {
    const info = await desk.send('Runtime.evaluate', { expression: `(() => ({ canvas: Boolean(document.querySelector('.desktop-canvas')), focus: window.__akiDesktopCanvas?.focusAmount, hasFocused: window.__akiDesktopCanvas?.hasFocusedLine }))()`, returnByValue: true });
    console.log('desk', JSON.stringify(info.result.value));
    const sd = await desk.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`C:/Users/Asamo/AppData/Local/Temp/${deskName}.png`, Buffer.from(sd.data, 'base64'));
  }
};
await seekAndCapture(136, 'aki-sentence-217-main', 'aki-sentence-217-desk');
await seekAndCapture(145.35, 'aki-sentence-line13', null);
main.ws.close(); desk.ws.close();
