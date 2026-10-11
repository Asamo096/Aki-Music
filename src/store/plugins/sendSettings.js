// SPDX-License-Identifier: AGPL-3.0-or-later
import { ipcRenderer } from '@/utils/electronBridge';

export function getSendSettingsPlugin() {
  return store => {
    store.subscribe((mutation, state) => {
      // console.log(mutation);
      if (mutation.type !== 'updateSettings') return;
      ipcRenderer.send('settings', state.settings);
    });
  };
}
