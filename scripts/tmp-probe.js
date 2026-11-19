const sleep = ms => new Promise(r => setTimeout(r, ms));
const txt = s => document.querySelector(s)?.textContent?.trim() ?? null;
const roomId = (txt('.listen-together-modal .room-id') || '').replace(/^#/, '');
const p = store.state.player;
const ids = store.state.listenTogether.roomPlaylist.map(String);
p._isPersonalFM = false;
p._list = ids;
p._playlistSource = { type: 'listen-together', id: roomId };
await p._shuffleTheList(String(p.currentTrackID));
const idx = p.list.indexOf(String(p.currentTrackID));
if (idx >= 0) p.current = idx;

const getCmd = async () => {
  const r = await fetch(`/api/listentogether/sync/playlist/get?roomId=${encodeURIComponent(roomId)}&timestamp=${Date.now()}`, { credentials: 'include' });
  const j = await r.json();
  const c = j?.data?.playCommand;
  return c ? { type: c.commandType, target: String(c.targetSongId), seq: c.clientSeq, userId: String(c.userId), status: c.playStatus } : null;
};
const btns = () => [...document.querySelectorAll('.player .middle-control-buttons button')];
const local = () => txt('.player .track-info .name');
const out = { queueLen: p.list.length, steps: [] };
out.steps.push({ tag: 'adopted', local: local(), cmd: await getCmd() });

btns().find(b => b.title === '下一首').click();
await sleep(1200);
out.steps.push({ tag: 'next+1.2s', local: local(), playing: local() && btns().find(b => b.title === '暂停') !== undefined, cmd: await getCmd() });

await sleep(2500);
out.steps.push({ tag: 'watch+2.5s', local: local(), cmd: await getCmd(), roomSong: txt('.listen-together-modal .song-row .name'), roomStatus: txt('.listen-together-modal .song-row .play-status') });

btns().find(b => b.title === '暂停' || b.title === '播放').click();
await sleep(1200);
out.steps.push({ tag: 'pause+1.2s', local: local(), cmd: await getCmd() });

await sleep(3000);
out.steps.push({ tag: 'watch+3s', local: local(), cmd: await getCmd(), roomSong: txt('.listen-together-modal .song-row .name'), roomStatus: txt('.listen-together-modal .song-row .play-status') });
return out;
