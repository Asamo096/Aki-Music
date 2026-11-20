const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = await import('/src/api/others.js');
const res = await api.search({ keywords: '素颜 许嵩 何曼婷', limit: 1 });
const song = res?.result?.songs?.[0];
store.commit('updateSettings', { key: 'visualMode', value: 'off' });
store.commit('updateSettings', { key: 'lyricsBackground', value: 'fluid' });
if (!store.state.showLyrics) store.commit('toggleLyrics');
if (song) await store.state.player._replaceCurrentTrack(song.id, true);
await sleep(3200);
const veil = document.querySelector('.veil');
return {
  track: store.state.player.currentTrack?.name,
  veil: veil ? { opacity: getComputedStyle(veil).opacity, color: getComputedStyle(veil).backgroundColor } : null,
};
