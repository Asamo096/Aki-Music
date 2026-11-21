const sleep = ms => new Promise(r => setTimeout(r, ms));
const walk = (c, n) => { if (!c) return null; if (c.$options && c.$options.name === n) return c; for (const k of c.$children || []) { const f = walk(k, n); if (f) return f; } return null; };
store.commit('updateSettings', { key: 'visualMode', value: 'fume' });
store.commit('updateSettings', { key: 'fumeStyle', value: 'glyph' });
if (!store.state.showLyrics) store.commit('toggleLyrics');
const lyrics = walk(app, 'Lyrics');
await sleep(400);
const r = await fetch('/api/search?keywords=' + encodeURIComponent('Shape of You Ed Sheeran') + '&type=1&limit=3', { credentials: 'include' });
const j = await r.json();
const song = (j.result?.songs || []).find(x => /Shape of You/i.test(x.name)) || j.result?.songs?.[0];
if (!song) return { error: 'song-not-found' };
await store.state.player._replaceCurrentTrack(song.id, true);
await sleep(3500);
store.state.player.play();
store.state.player.seek(18);
await sleep(1000);
const cells = window.__akiGlyph?.currentLayout?.cells?.map(c => c.char) ?? null;
return {
  song: { id: song.id, name: song.name },
  source: lyrics?.lyricData?.source,
  hasWordTiming: lyrics?.hasWordTiming,
  idx: lyrics?.highlightLyricIndex,
  cells,
  line: lyrics?.lines?.[lyrics.highlightLyricIndex]?.words?.map(w => w.text).join('') ?? null,
};
