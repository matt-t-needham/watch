<script lang="ts">
	import { getFeed } from '$lib/api/index';
	import type { PlaylistPageVideo, Video, VideoBase } from '$lib/api/model';
	import { feedCacheStore, feedLoadingStore } from '$lib/store';
	import InfiniteLoading, { type InfiniteEvent } from 'svelte-infinite-loading';
	import ItemsList from '$lib/components/layout/ItemsList.svelte';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { _ } from '$lib/i18n';
	import PageLoading from '$lib/components/PageLoading.svelte';
	import { isYTBackend } from '$lib/backend';
	import { refreshFeedYTjs, type FeedRefreshResult } from '$lib/api/youtubejs/subscriptions';

	let currentPage = 1;
	let videos: (VideoBase | Video | PlaylistPageVideo)[] = $derived($feedCacheStore.subscription);

	// bix: the feed is built on this device. Refresh waits for every channel
	// (ignoring the cooldown), says what failed, then reloads the list.
	let refreshing = $state(false);
	let refreshStatus = $state('');
	let refreshFailed = $state(false);

	function report(result: FeedRefreshResult) {
		refreshFailed = result.failed.length > 0;
		if (refreshFailed) {
			refreshStatus = $_('subscriptions.refreshFailed', {
				channels: result.failed.map((channel) => channel.channelName).join(', ')
			});
		} else {
			refreshStatus =
				result.added > 0
					? $_('subscriptions.refreshAdded', { count: result.added })
					: $_('subscriptions.refreshNothing');
		}
	}

	async function refresh() {
		refreshing = true;
		refreshStatus = $_('subscriptions.refreshing');
		refreshFailed = false;
		try {
			const result = await refreshFeedYTjs(true);
			report(result);
			if (result.added > 0) await invalidateAll();
		} catch (error) {
			refreshFailed = true;
			refreshStatus = error instanceof Error ? error.message : String(error);
		} finally {
			refreshing = false;
		}
	}

	// Opening the page starts a background refresh of stale channels; show
	// what it found instead of waiting for the next visit.
	onMount(() => {
		if (!isYTBackend()) return;
		refreshFeedYTjs()
			.then(async (result) => {
				if (result.failed.length > 0) report(result);
				if (result.added > 0) await invalidateAll();
			})
			.catch((error) => {
				refreshFailed = true;
				refreshStatus = error instanceof Error ? error.message : String(error);
			});
	});

	async function loadMore(event: InfiniteEvent) {
		currentPage++;

		const feed = await getFeed(100, currentPage);
		if (feed.videos.length === 0) {
			event.detail.complete();
		} else {
			videos = [...videos, ...feed.videos, ...feed.notifications];
			feedCacheStore.set({ subscription: videos });
			event.detail.loaded();
		}
	}
</script>

<nav class="right-align">
	{#if isYTBackend()}
		<span class="refresh-status" class:error-text={refreshFailed} role="status">
			{refreshStatus}
		</span>
		<button class="surface-container-highest" onclick={refresh} disabled={refreshing}>
			<i>refresh</i>
			<span>{$_('subscriptions.refresh')}</span>
		</button>
	{/if}
	<a class="button surface-container-highest" href={resolve('/subscriptions/manage', {})}>
		{$_('subscriptions.manageSubscriptions')}
	</a>
</nav>
<div class="space"></div>

{#if !$feedLoadingStore}
	<ItemsList items={videos ?? []} />
	<InfiniteLoading on:infinite={loadMore} />
{:else}
	<PageLoading />
{/if}

<style>
	.refresh-status {
		margin-right: auto;
	}
</style>
