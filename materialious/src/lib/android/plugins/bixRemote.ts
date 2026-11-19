// bix: the living-room remote's receiver (android/.../BixRemote.java). The TV
// player page reports its speed and quality here and applies the remote's
// changes, which arrive as `remoteCommand` events already checked against
// the last report.
import { registerPlugin, WebPlugin, type PluginListenerHandle } from '@capacitor/core';

export type RemoteState =
	| { player: false }
	| {
			player: true;
			speed: number;
			speeds: number[];
			quality: 'auto' | number;
			qualities: number[];
	  };

export interface RemoteCommand {
	cmd: 'speed' | 'quality';
	value: string;
}

interface BixRemotePlugin {
	report: (options: { state: string }) => Promise<void>;
	addListener: (
		eventName: 'remoteCommand',
		listener: (command: RemoteCommand) => void
	) => Promise<PluginListenerHandle>;
}

export class BixRemoteWeb extends WebPlugin implements BixRemotePlugin {
	async report(): Promise<void> {
		throw this.unavailable('The remote receiver is only available in the Android app');
	}
}

const bixRemote = registerPlugin<BixRemotePlugin>('BixRemote', {
	web: new BixRemoteWeb()
});

export function reportRemoteState(state: RemoteState) {
	bixRemote
		.report({ state: JSON.stringify(state) })
		.catch((error) => console.error('Reporting the player state to the remote failed:', error));
}

export default bixRemote;
