<script lang="ts">
	import ContentColumn from '$lib/components/layout/ContentColumn.svelte';
	import Player from '$lib/components/player/Player.svelte';
	import Author from '$lib/components/Author.svelte';
	import Description from '$lib/components/watch/Description.svelte';
	import LikesDislikes from '$lib/components/watch/LikesDislikes.svelte';
	import { letterCase } from '$lib/letterCasing';
	import Mousetrap from 'mousetrap';
	import { onDestroy, onMount, tick } from 'svelte';
	import { _ } from '$lib/i18n';
	import { playlistCacheStore } from '$lib/store';
	import { fade } from 'svelte/transition';
	import ItemsList from '$lib/components/layout/ItemsList.svelte';
	import { addBackHandler } from '$lib/backHandlers';
	import TvPlaybackSettings from '$lib/components/player/settings/TvPlaybackSettings.svelte';
	import displayMode from '$lib/android/plugins/displayMode';
	import { playerMatchFrameRateStore } from '$lib/stores/player';
	import type shaka from 'shaka-player/dist/shaka-player.ui';

	let { data } = $props();

	let playerElement: HTMLMediaElement | undefined = $state();
	let shakaPlayer: shaka.Player | undefined = $state();

	// bix: refresh-rate matching. The display follows the playing track's
	// frame rate; leaving the player hands the mode back to the system.
	let displayRefreshRate: number | undefined = $state();
	let matchedFps: number | undefined;

	async function matchFrameRate() {
		if (!shakaPlayer) return;
		try {
			if (!$playerMatchFrameRateStore) {
				if (matchedFps === undefined) return;
				matchedFps = undefined;
				await displayMode.reset();
				displayRefreshRate = (await displayMode.current()).refreshRate;
				return;
			}
			const fps = shakaPlayer.getVariantTracks().find((track) => track.active)?.frameRate;
			if (!fps || fps === matchedFps) return;
			matchedFps = fps;
			const result = await displayMode.matchFrameRate({ fps });
			displayRefreshRate = result.refreshRate;
		} catch (error) {
			console.error('Refresh-rate matching failed:', error);
		}
	}

	$effect(() => {
		const player = shakaPlayer;
		if (!player) return;
		const onChange = () => void matchFrameRate();
		const events = ['loaded', 'adaptation', 'variantchanged'];
		events.forEach((name) => player.addEventListener(name, onChange));
		return () => events.forEach((name) => player.removeEventListener(name, onChange));
	});

	$effect(() => {
		void $playerMatchFrameRateStore;
		void matchFrameRate();
	});
	let showInfo = $state(false);
	let infoPanel: HTMLElement | undefined = $state();
	let infoScope: HTMLElement | undefined = $state();
	let playerCurrentTime: number = $state(0);
	let showControls = $state(false);
	let currentTime = $state(0);
	let userManualSeeking = $state(false);

	let seekRaf: number | null = null;
	let seekStartTime = 0;
	let isSeeking = false;
	let lastUpdate = 0;
	let infoClosedByEnter = false;
	let keydownHandledMovement = false;

	const hasChapters = $derived(data.content.timestamps.length > 0);
	const hasPlaylist = $derived(!!data.playlistId && data.playlistId in $playlistCacheStore);
	const hasRecommended = $derived(data.video.recommendedVideos.length > 0);

	function startSeeking(direction: 'left' | 'right') {
		showControls = true;

		if (!playerElement || showInfo || isSeeking) return true;

		userManualSeeking = true;
		isSeeking = true;
		lastUpdate = performance.now();

		const duration = data.video.lengthSeconds;
		const base = duration * 0.005; // ~0.5%

		function step(now: number) {
			if (!isSeeking) return;

			const elapsedTotal = (now - seekStartTime) / 1000; // total hold time
			const throttleDelta = now - lastUpdate;

			// only update every ~100ms so we don’t overshoot
			if (throttleDelta > 100) {
				const factor = 1 + Math.min(elapsedTotal ** 1.2, 3); // gentler acceleration
				const amount = base * factor;

				if (direction === 'right') {
					currentTime = Math.min(currentTime + amount, duration);
				} else {
					currentTime = Math.max(currentTime - amount, 0);
				}

				lastUpdate = now;
			}

			seekRaf = requestAnimationFrame(step);
		}

		seekStartTime = performance.now();
		seekRaf = requestAnimationFrame(step);

		return false;
	}

	function stopSeeking() {
		isSeeking = false;
		showControls = false;
		userManualSeeking = false;

		if (seekRaf !== null) {
			cancelAnimationFrame(seekRaf);
			seekRaf = null;
		}

		if (playerElement && !showInfo) {
			playerElement.currentTime = currentTime;
		}
	}

	function focusElement(el: HTMLElement | null | undefined) {
		if (!el) return;
		el.focus();
		el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}

	function openInfo() {
		showInfo = true;

		tick().then(() => {
			if (infoScope) infoScope.scrollTop = 0;

			const first = infoScope?.querySelector<HTMLElement>(
				'[tabindex]:not([tabindex="-1"]), a, button, summary'
			);
			focusElement(first ?? infoPanel);
		});
	}

	function closeInfo() {
		showInfo = false;
		(document.activeElement as HTMLElement | null)?.blur();
	}

	function getInfoFocusables() {
		return Array.from(
			infoScope?.querySelectorAll<HTMLElement>(
				'[tabindex]:not([tabindex="-1"]), a, button, summary'
			) ?? []
		).filter((el) => el.getClientRects().length > 0);
	}

	// bix: D-pad moves by position, not list order: Up/Down to the nearest
	// item in the row above or below, Left/Right along the current row.
	function spatialTarget(from: HTMLElement, key: string): HTMLElement | undefined {
		const a = from.getBoundingClientRect();
		const aCenterX = a.left + a.width / 2;
		const aCenterY = a.top + a.height / 2;
		const vertical = key === 'ArrowDown' || key === 'ArrowUp';
		const candidates: { el: HTMLElement; along: number; across: number }[] = [];

		for (const el of getInfoFocusables()) {
			if (el === from || el.contains(from) || from.contains(el)) continue;
			const b = el.getBoundingClientRect();
			const bCenterX = b.left + b.width / 2;
			const bCenterY = b.top + b.height / 2;
			const sameRow = b.top < a.bottom && b.bottom > a.top;

			let along: number;
			if (key === 'ArrowDown') along = b.top - a.bottom;
			else if (key === 'ArrowUp') along = a.top - b.bottom;
			else if (!sameRow) continue;
			else if (key === 'ArrowRight') {
				if (bCenterX <= aCenterX) continue;
				along = b.left - a.right;
			} else {
				if (bCenterX >= aCenterX) continue;
				along = a.left - b.right;
			}

			// Allow a little overlap (focus rings, wrapped rows); anything else is behind us.
			if (along < -4 || (vertical && sameRow)) continue;
			candidates.push({
				el,
				along: Math.max(along, 0),
				across: vertical ? Math.abs(bCenterX - aCenterX) : Math.abs(bCenterY - aCenterY)
			});
		}
		if (candidates.length === 0) return;

		// Nearest row (or neighbour) first, then the closest within it.
		const nearest = Math.min(...candidates.map((candidate) => candidate.along));
		return candidates
			.filter((candidate) => candidate.along <= nearest + 8)
			.sort((x, y) => x.across - y.across || x.along - y.along)[0].el;
	}

	function moveInfoFocus(key: string) {
		const current = document.activeElement as HTMLElement | null;
		const focusables = getInfoFocusables();
		if (focusables.length === 0) return false;

		const target =
			current && infoScope?.contains(current)
				? spatialTarget(current, key)
				: key === 'ArrowUp'
					? focusables[focusables.length - 1]
					: focusables[0];
		if (!target) return false;

		target.focus();
		target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		return document.activeElement === target;
	}

	function handleInfoKeyDown(event: KeyboardEvent) {
		if (event.defaultPrevented) {
			keydownHandledMovement = true;
			return;
		}

		keydownHandledMovement = false;
		if (event.key === 'Enter') return;
		if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;

		if (moveInfoFocus(event.key)) {
			event.preventDefault();
			keydownHandledMovement = true;
		} else if (event.key !== 'ArrowUp') {
			// Nothing further that way: stay put instead of seeking the video.
			event.preventDefault();
			keydownHandledMovement = true;
		}
	}

	function activateChapter(timestamp: { time: number }) {
		if (playerElement) playerElement.currentTime = timestamp.time;
		infoClosedByEnter = true;
		closeInfo();
	}

	// bix: Back closes the info panel instead of leaving the video.
	const removeBackHandler = addBackHandler(() => {
		if (!showInfo) return false;
		closeInfo();
		return true;
	});

	onMount(() => {
		displayMode
			.current()
			.then((mode) => (displayRefreshRate = mode.refreshRate))
			.catch((error) => console.error('Reading the display mode failed:', error));

		if (playerElement) {
			playerElement.addEventListener('timeupdate', () => {
				if (!playerElement) return;
				playerCurrentTime = playerElement.currentTime;
			});
		}

		Mousetrap.bind(
			'down',
			() => {
				if (showInfo) return true;

				openInfo();

				return false;
			},
			'keyup'
		);

		Mousetrap.bind(
			'up',
			() => {
				if (!showInfo) {
					openInfo();
					return false;
				}

				const moved = keydownHandledMovement;
				keydownHandledMovement = false;

				if (moved) return true;

				const activeElement = document.activeElement;
				const atTop = activeElement?.id === 'info-close' || !infoScope || infoScope.scrollTop === 0;

				if (atTop) {
					closeInfo();
					return false;
				}

				return true;
			},
			'keyup'
		);

		// Arrow key seeking bindings
		Mousetrap.bind('right', () => startSeeking('right'), 'keydown');
		Mousetrap.bind('right', stopSeeking, 'keyup');
		Mousetrap.bind('left', () => startSeeking('left'), 'keydown');
		Mousetrap.bind('left', stopSeeking, 'keyup');

		Mousetrap.bind(
			'esc',
			() => {
				if (showInfo) {
					closeInfo();
					return false;
				}

				return true;
			},
			'keyup'
		);

		Mousetrap.bind(
			'enter',
			() => {
				if (infoClosedByEnter) {
					infoClosedByEnter = false;
					return true;
				}

				if (!showInfo) {
					if (playerElement?.paused) {
						showControls = false;
						playerElement?.play();
					} else {
						showControls = true;

						playerElement?.pause();
					}
					return false;
				}

				return true;
			},
			'keyup'
		);
	});

	onDestroy(() => {
		removeBackHandler();
		displayMode
			.reset()
			.catch((error) => console.error('Resetting the display mode failed:', error));
		Mousetrap.unbind(['up', 'down', 'left', 'right', 'enter', 'esc']);
	});
</script>

{#key data.video.videoId}
	<Player
		bind:playerElement
		onShakaPlayer={(player) => (shakaPlayer = player)}
		bind:currentTime
		bind:userManualSeeking
		isEmbed={true}
		{data}
		{showControls}
	/>
{/key}

{#if showInfo}
	<article
		id="shown-info"
		transition:fade
		bind:this={infoPanel}
		onkeydown={handleInfoKeyDown}
		role="dialog"
		aria-label={data.video.title}
	>
		<nav class="info-header">
			<h5>{letterCase(data.video.title)}</h5>
			<button
				id="info-close"
				class="circle surface-container-highest"
				aria-label={$_('player.closePlayer')}
				onclick={(event) => {
					if (event.detail === 0) infoClosedByEnter = true;
					closeInfo();
				}}
			>
				<i>close</i>
			</button>
		</nav>

		<div bind:this={infoScope} class="info-body" tabindex="-1">
			{#if shakaPlayer && playerElement}
				<section class="info-section">
					<TvPlaybackSettings player={shakaPlayer} {playerElement} {displayRefreshRate} />
				</section>
			{/if}
			<section class="info-section">
				<Author channel={data.video} />
				<div class="space"></div>
				<LikesDislikes video={data.video} returnYTDislikes={data.streamed.returnYTDislikes} />
				<article class="border">
					<Description video={data.video} description={data.content.description} />
				</article>
			</section>

			{#if hasChapters}
				<section class="info-section">
					<h5 style="margin-bottom: 0;">{$_('player.chapters')}</h5>
					<div class="grid">
						{#each data.content.timestamps as timestamp, index (timestamp)}
							{@const isCurrent =
								playerCurrentTime >= timestamp.time &&
								(playerCurrentTime <= timestamp.endTime || timestamp.endTime === -1)}
							<ContentColumn>
								<article
									tabindex="0"
									id={`chapter-${index}`}
									aria-label={timestamp.title}
									class:chapter-current={isCurrent}
									style="cursor: pointer;height: 100%;"
									onclick={() => activateChapter(timestamp)}
									onkeydown={(event) => {
										if (event.key === 'Enter') {
											event.preventDefault();
											activateChapter(timestamp);
										}
									}}
								>
									<div
										style="white-space: pre-line; overflow-wrap: anywhere; word-break: break-word; text-align: center; min-width: 0;"
									>
										<p style="no-margin no-padding">{timestamp.title}</p>
										<span
											class="chip no-margin"
											class:primary={isCurrent}
											class:surface-container-highest={!isCurrent}>{timestamp.timePretty}</span
										>
									</div>
								</article>
							</ContentColumn>
						{/each}
					</div>
				</section>
			{/if}

			{#if hasPlaylist}
				<section class="info-section">
					<h5>{$_('playlistVideos')}</h5>
					<ItemsList classes="" items={$playlistCacheStore[data.playlistId!].videos} />
				</section>
			{/if}

			{#if hasRecommended}
				<section class="info-section">
					<h5>{$_('recommendedVideos')}</h5>
					<ItemsList classes="" items={data.video.recommendedVideos} />
				</section>
			{/if}
		</div>
	</article>
{/if}

<style>
	#shown-info {
		position: fixed;
		bottom: 0;
		left: 0;
		width: 100%;
		height: 75%;
		z-index: 101;
		display: flex;
		flex-direction: column;
		background-color: var(--surface);
		box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
		border-bottom-left-radius: 0px;
		border-bottom-right-radius: 0px;
	}

	.info-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1em;
		padding: 0.75em 1em;
		border-bottom: 1px solid var(--outline-variant);
		flex-shrink: 0;
	}

	.info-header h5 {
		margin: 0;
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
		white-space: normal;
	}

	.info-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 1em;
	}

	.info-body:focus {
		outline: none !important;
	}

	.info-section {
		margin-bottom: 1.5em;
	}

	.chapter-current {
		background-color: var(--primary-container);
		color: var(--on-primary-container);
	}
</style>
