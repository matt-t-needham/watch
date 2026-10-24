<!--
	bix: playback settings for the TV player, which hides the mouse-only
	Settings menu. Plain buttons in rows, so the info panel's D-pad focus
	order reaches every option. The chosen option shows a check mark as well
	as a colour.
-->
<script lang="ts">
	import type shaka from 'shaka-player/dist/shaka-player.ui';
	import { onDestroy, onMount } from 'svelte';
	import { _ } from '$lib/i18n';
	import { playbackRates } from '$lib/player/index';
	import { playerMatchFrameRateStore } from '$lib/stores/player';
	import { setActiveVideoTrack } from './Settings.svelte';

	let {
		player,
		playerElement,
		displayRefreshRate
	}: {
		player: shaka.Player;
		playerElement: HTMLMediaElement;
		displayRefreshRate: number | undefined;
	} = $props();

	// The TV is no place for 4x; keep the useful range.
	const tvRates = playbackRates.filter((rate) => rate >= 0.5 && rate <= 2);

	let autoQuality = $state(true);
	let activeTrack: shaka.extern.VideoTrack | undefined = $state();
	let speed = $state(1);
	let dropped = $state(0);
	let total = $state(0);

	const heights = $derived(
		[...new Set(player.getVideoTracks().map((track) => track.height ?? 0))]
			.filter((height) => height > 0)
			.sort((a, b) => b - a)
	);

	function refresh() {
		activeTrack = player.getVideoTracks().find((track) => track.active);
		autoQuality = player.getConfiguration().abr.enabled;
		speed = playerElement.playbackRate;
		const quality =
			playerElement instanceof HTMLVideoElement
				? playerElement.getVideoPlaybackQuality()
				: undefined;
		dropped = quality?.droppedVideoFrames ?? 0;
		total = quality?.totalVideoFrames ?? 0;
	}

	const round = (value: number) => Math.round(value * 1000) / 1000;
	const stats = $derived(
		[
			activeTrack ? `${activeTrack.height}p` : undefined,
			activeTrack?.frameRate ? `${round(activeTrack.frameRate)} fps` : undefined,
			displayRefreshRate
				? `${$_('player.controls.display')} ${round(displayRefreshRate)} Hz`
				: undefined,
			$_('player.controls.droppedFrames', { dropped, total })
		]
			.filter((part) => part !== undefined)
			.join(' · ')
	);

	function chooseAuto() {
		player.configure({ abr: { enabled: true } });
		refresh();
	}

	function chooseHeight(height: number) {
		// Highest frame rate and bitrate at that height.
		const track = player
			.getVideoTracks()
			.filter((candidate) => candidate.height === height)
			.sort(
				(a, b) => (b.frameRate ?? 0) - (a.frameRate ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0)
			)[0];
		if (!track) return;
		player.selectVideoTrack(track, true);
		setActiveVideoTrack(player);
		refresh();
	}

	function chooseSpeed(rate: number) {
		playerElement.playbackRate = rate;
		refresh();
	}

	let timer: ReturnType<typeof setInterval>;
	onMount(() => {
		refresh();
		timer = setInterval(refresh, 1000);
	});
	onDestroy(() => clearInterval(timer));
</script>

<section class="tv-playback">
	<h5>{$_('player.controls.quality')}</h5>
	<nav class="wrap">
		<button
			class="chip"
			class:primary={autoQuality}
			aria-pressed={autoQuality}
			onclick={chooseAuto}
		>
			{#if autoQuality}<i>check</i>{/if}
			{$_('player.controls.auto')}
		</button>
		{#each heights as height (height)}
			{@const chosen = !autoQuality && activeTrack?.height === height}
			<button
				class="chip"
				class:primary={chosen}
				aria-pressed={chosen}
				onclick={() => chooseHeight(height)}
			>
				{#if chosen}<i>check</i>{/if}
				{height}p
			</button>
		{/each}
	</nav>

	<h5>{$_('player.controls.playbackSpeed')}</h5>
	<nav class="wrap">
		{#each tvRates as rate (rate)}
			<button
				class="chip"
				class:primary={speed === rate}
				aria-pressed={speed === rate}
				onclick={() => chooseSpeed(rate)}
			>
				{#if speed === rate}<i>check</i>{/if}
				{rate}x
			</button>
		{/each}
	</nav>

	<h5>{$_('player.controls.matchFrameRate')}</h5>
	<nav class="wrap">
		{#each [true, false] as on (on)}
			<button
				class="chip"
				class:primary={$playerMatchFrameRateStore === on}
				aria-pressed={$playerMatchFrameRateStore === on}
				onclick={() => playerMatchFrameRateStore.set(on)}
			>
				{#if $playerMatchFrameRateStore === on}<i>check</i>{/if}
				{on ? $_('player.controls.on') : $_('player.controls.off')}
			</button>
		{/each}
	</nav>

	<p class="small-text">{stats}</p>
</section>

<style>
	.tv-playback h5 {
		margin: 0.5em 0 0.25em;
	}
</style>
