const sleep = ms => new Promise(r => setTimeout(r, ms));
const walk = (c, n) => { if (!c) return null; if (c.$options && c.$options.name === n) return c; for (const k of c.$children || []) { const f = walk(k, n); if (f) return f; } return null; };
store.commit('updateSettings', { key: 'visualMode', value: 'fume' });
store.commit('updateSettings', { key: 'fumeStyle', value: 'glyph' });
if (!store.state.showLyrics) store.commit('toggleLyrics');
const lyrics = walk(app, 'Lyrics');
await sleep(400);
if (!lyrics.desktopLyricsOpen) await lyrics.toggleDesktopLyrics();
if (store.state.player.currentTrack?.name !== '淘汰') {
  const r = await fetch('/api/search?keywords=' + encodeURIComponent('淘汰 陈奕迅') + '&type=1&limit=3', { credentials: 'include' });
  const j = await r.json(); const song = (j.result?.songs || []).find(x => /淘汰/.test(x.name)) || j.result?.songs?.[0];
  if (song) await store.state.player._replaceCurrentTrack(song.id, true);
  await sleep(3000);
}
store.state.player.seek(122.8);
store.state.player.play();
await sleep(500);
return { track: store.state.player.currentTrack?.name, t: store.state.player.seek(null, false), idx: lyrics.highlightLyricIndex };
