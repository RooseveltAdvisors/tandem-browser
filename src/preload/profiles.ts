import { ipcRenderer } from 'electron';
import { IpcChannels } from '../shared/ipc-channels';

export function createProfilesApi() {
  return {
    inspectProfiles: () => ipcRenderer.invoke(IpcChannels.PROFILE_LIST),
    selectProfile: (name: string) => ipcRenderer.invoke(IpcChannels.PROFILE_SELECT, name),
  };
}
