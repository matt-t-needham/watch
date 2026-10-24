// bix: refresh-rate matching for the TV player (android/.../DisplayMode.java).
import { registerPlugin, WebPlugin } from '@capacitor/core';

export interface DisplayModeInfo {
	refreshRate: number;
	width: number;
	height: number;
}

interface DisplayModePlugin {
	current: () => Promise<DisplayModeInfo>;
	matchFrameRate: (options: { fps: number }) => Promise<{ matched: boolean; refreshRate: number }>;
	reset: () => Promise<void>;
}

export class DisplayModeWeb extends WebPlugin implements DisplayModePlugin {
	async current(): Promise<DisplayModeInfo> {
		throw this.unavailable('Display modes are only available in the Android app');
	}

	async matchFrameRate(): Promise<{ matched: boolean; refreshRate: number }> {
		throw this.unavailable('Display modes are only available in the Android app');
	}

	async reset(): Promise<void> {
		throw this.unavailable('Display modes are only available in the Android app');
	}
}

const displayMode = registerPlugin<DisplayModePlugin>('DisplayMode', {
	web: new DisplayModeWeb()
});

export default displayMode;
