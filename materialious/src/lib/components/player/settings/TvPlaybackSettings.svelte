<!--
	bix: playback settings for the TV player, which hides the mouse-only
	Settings menu. Plain buttons in rows, so the info panel's D-pad focus
	order reaches every option. The chosen option shows a check mark as well
	as a colour.
-->
<script lang="ts">
	import type shaka from 'shaka-player/dist/shaka-player.ui';
	import { onDestroy, onMount } from 'svelte';
	import { _ } from '#lib/i18n';
	import { playerMatchFrameRateStore } from '#lib/stores/player';
	import {
		activeVideoTrack,
		chooseAutoQuality,
		chooseQualityHeight,
		chooseSpeed as applySpeed,
		isAutoQuality,
		qualityHeights,
		tvRates
	} from '#lib/player/tvPlayback';

	let {
		player,
		playerElement,
		displayRefreshRate
	}: {
		player: shaka.Player;
		playerElement: HTMLMediaElement;
		displayRefreshRate: number | undefined;
	} = $props();

	let autoQuality = $state(true);
	let activeTrack: shaka.extern.VideoTrack | undefined = $state();
	let speed = $state(1);
	let dropped = $state(0);
	let total = $state(0);

	const heights = $derived(qualityHeights(player));

	function refresh() {
		// Polled, so changes from the remote (bixRemote.ts) show up here too.
		activeTrack = activeVideoTrack(player);
		autoQuality = isAutoQuality(player);
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
		chooseAutoQuality(player);
		refresh();
	}

	function chooseHeight(height: number) {
		chooseQualityHeight(player, height);
		refresh();
	}

	function chooseSpeed(rate: number) {
		applySpeed(playerElement, rate);
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
