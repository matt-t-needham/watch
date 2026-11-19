// bix: the TV player's speed and quality choices, shared by the settings panel
// (TvPlaybackSettings.svelte) and the living-room remote (bixRemote.ts), so both
// offer the same options and apply them the same way.
import type shaka from 'shaka-player/dist/shaka-player.ui';
import { setActiveVideoTrack } from '$lib/components/player/settings/Settings.svelte';
import { playbackRates } from '$lib/player/index';

// The TV is no place for 4x; keep the useful range.
export const tvRates = playbackRates.filter((rate) => rate >= 0.5 && rate <= 2);

/** Distinct video heights on offer, highest first. */
export function qualityHeights(player: shaka.Player): number[] {
	return [...new Set(player.getVideoTracks().map((track) => track.height ?? 0))]
		.filter((height) => height > 0)
		.sort((a, b) => b - a);
}

export function activeVideoTrack(player: shaka.Player): shaka.extern.VideoTrack | undefined {
	return player.getVideoTracks().find((track) => track.active);
}

export function isAutoQuality(player: shaka.Player): boolean {
	return player.getConfiguration().abr.enabled;
}

export function chooseAutoQuality(player: shaka.Player) {
	player.configure({ abr: { enabled: true } });
}

/** Picks the highest frame rate and bitrate at that height; false when there's none. */
export function chooseQualityHeight(player: shaka.Player, height: number): boolean {
	const track = player
		.getVideoTracks()
		.filter((candidate) => candidate.height === height)
		.sort(
			(a, b) => (b.frameRate ?? 0) - (a.frameRate ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0)
		)[0];
	if (!track) return false;
	player.selectVideoTrack(track, true);
	setActiveVideoTrack(player);
	return true;
}

export function chooseSpeed(playerElement: HTMLMediaElement, rate: number) {
	playerElement.playbackRate = rate;
}
