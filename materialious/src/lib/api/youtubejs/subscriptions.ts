import { localDb, type ChannelSubscriptions } from '$lib/dexie';
import { cleanNumber } from '$lib/numbers';
import { relativeTimestamp } from '$lib/time';
import { get } from 'svelte/store';
import type { Feed, Subscription, Thumbnail, Video } from '../model';
import { getChannelContentYTjs, getChannelYTjs } from './channel';
import {
	engineCooldownYTStore,
	engineCullYTStore,
	engineMaxConcurrentChannelsStore,
	rawMasterKeyStore
} from '$lib/store';
import { getSubscriptionsBackend } from '../backend/subscriptions';

let refreshPromise: Promise<FeedRefreshResult> | null = null;

export async function getSubscriptionsYTjs(): Promise<Subscription[]> {
	const subscriptions: Subscription[] = [];

	await localDb.channelSubscriptions.each((subscription) => {
		subscriptions.push({
			author: subscription.channelName,
			authorId: subscription.channelId
		});
	});

	return subscriptions;
}

export async function amSubscribedYTjs(authorId: string): Promise<boolean> {
	return (await localDb.channelSubscriptions.where('channelId').equals(authorId).count()) > 0;
}

export async function postSubscribeYTjs(
	authorId: string,
	authorName: string | undefined = undefined
) {
	if (!authorName) {
		const channel = await getChannelYTjs(authorId);
		authorName = channel.author;
	}

	try {
		await localDb.channelSubscriptions.add({
			channelId: authorId,
			channelName: authorName,
			lastRSSFetch: new Date(0)
		});
	} catch {
		// Continue regardless
	}

	// Store channel into db in background
	parseChannelRSS(authorId).catch((error) => {
		console.error(`Feed fetch failed for new subscription ${authorName}:`, error);
	});
}

export async function deleteUnsubscribeYTjs(authorId: string) {
	await localDb.channelSubscriptions.where('channelId').equals(authorId).delete();
	await localDb.subscriptionFeed.where('authorId').equals(authorId).delete();
}

type RSSEntry = { video: Video; isShort: boolean };

function parseRSSEntries(xmlDoc: Document): { entries: RSSEntry[]; channelName?: string } {
	const entries: RSSEntry[] = [];
	let channelName: string | undefined;

	for (const entry of xmlDoc.getElementsByTagName('entry')) {
		const videoId = entry.getElementsByTagName('yt:videoId')[0]?.textContent || '';
		const title = entry.getElementsByTagName('title')[0]?.textContent || 'Untitled';
		const description =
			entry.getElementsByTagName('media:description')[0]?.textContent || 'No description available';
		const publishedAt = new Date(
			entry.getElementsByTagName('published')[0]?.textContent || new Date()
		);
		const published = publishedAt.getTime() / 1000;
		channelName =
			entry.getElementsByTagName('author')[0]?.getElementsByTagName('name')[0]?.textContent ||
			'Unknown Author';
		const authorId =
			entry
				.getElementsByTagName('author')[0]
				?.getElementsByTagName('uri')[0]
				?.textContent.split('/')[4] || '';
		// bix: RSS links Shorts as youtube.com/shorts/<id>.
		const link = entry.getElementsByTagName('link')[0]?.getAttribute('href') || '';

		const videoThumbnails: Thumbnail[] = Array.from(
			entry.getElementsByTagName('media:group')[0]?.getElementsByTagName('media:thumbnail') || []
		).map((thumbElement) => ({
			url: thumbElement.getAttribute('url') || '',
			width: parseInt(thumbElement.getAttribute('width') || '0'),
			height: parseInt(thumbElement.getAttribute('height') || '0')
		}));

		const viewCountText =
			entry.getElementsByTagName('media:statistics')[0]?.getAttribute('views') || '0';
		const viewCount = parseInt(viewCountText) || 0;

		entries.push({
			isShort: link.includes('/shorts/'),
			video: {
				type: 'video',
				videoId,
				title,
				videoThumbnails,
				author: channelName,
				authorId,
				description,
				descriptionHtml: description,
				published,
				publishedText: relativeTimestamp(published * 1000, false),
				liveNow: false,
				premium: false,
				isUpcoming: false,
				lengthSeconds: 0,
				viewCountText: cleanNumber(viewCount),
				viewCount,
				authorUrl: authorId ? `/channel/${authorId}` : '',
				authorVerified: false
			}
		});
	}

	return { entries, channelName };
}

// bix: durations come from the channel's Videos tab, keyed by video ID. That
// tab leaves out Shorts and live streams, and gives 0 for upcoming premieres
// (no length badge yet).
async function getVideosTabLengths(channelId: string): Promise<Map<string, number>> {
	const content = await getChannelContentYTjs(channelId, { type: 'videos' });
	if (!('videos' in content)) throw new Error('Videos tab returned no videos list');
	return new Map(content.videos.map((video: Video) => [video.videoId, video.lengthSeconds]));
}

/**
 * bix: RSS says what's new and when (exact times); the Videos tab, fetched
 * only when RSS shows something not yet in the feed, gives durations and
 * decides what counts as a video. Kept: RSS entries in the Videos tab with a
 * length. Dropped: Shorts, live streams and premieres not yet aired — those
 * are retried on the next refresh while RSS still lists them.
 *
 * Throws when either fetch fails, so the caller can report the channel.
 */
export async function parseChannelRSS(channelId: string): Promise<number> {
	const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

	const response = await fetch(feedUrl, { priority: 'low' });
	if (!response.ok) throw new Error(`RSS answered ${response.status}`);

	const xmlDoc = new DOMParser().parseFromString(await response.text(), 'text/xml');
	const { entries, channelName } = parseRSSEntries(xmlDoc);

	const candidates = entries
		.filter((entry) => !entry.isShort && entry.video.videoId)
		.map((entry) => entry.video);
	// Rows with no length came from the plain-RSS engine; fetch them again.
	const known = new Set(
		(
			await localDb.subscriptionFeed
				.where('videoId')
				.anyOf(candidates.map((video) => video.videoId))
				.toArray()
		)
			.filter((video) => video.lengthSeconds > 0)
			.map((video) => video.videoId)
	);
	const fresh = candidates.filter((video) => !known.has(video.videoId));

	let added = 0;
	if (fresh.length > 0) {
		const lengths = await getVideosTabLengths(channelId);
		for (const video of fresh) {
			const lengthSeconds = lengths.get(video.videoId) ?? 0;
			if (lengthSeconds === 0) continue;
			await localDb.subscriptionFeed.put({ ...video, lengthSeconds });
			added++;
		}
	}

	await updateLastRssFetch(channelId, channelName ?? 'Unknown');
	return added;
}

async function updateLastRssFetch(channelId: string, channelName: string) {
	const subscription = await localDb.channelSubscriptions
		.where('channelId')
		.equals(channelId)
		.first();
	if (subscription) {
		await localDb.channelSubscriptions.where('channelId').equals(channelId).modify({
			lastRSSFetch: new Date()
		});
	} else {
		await localDb.channelSubscriptions.add({
			channelId: channelId,
			channelName: channelName,
			lastRSSFetch: new Date()
		});
	}
}

export async function clearFeedYTjs() {
	await localDb.subscriptionFeed.clear();
}

export type FeedRefreshResult = {
	checked: number;
	added: number;
	failed: { channelId: string; channelName: string; reason: string }[];
};

async function getStaleSubscriptions(force: boolean): Promise<ChannelSubscriptions[]> {
	let channelSubscriptions: ChannelSubscriptions[];

	if (!get(rawMasterKeyStore)) {
		channelSubscriptions = await localDb.channelSubscriptions.toArray();
	} else {
		channelSubscriptions = await getSubscriptionsBackend();
	}

	const now = new Date();
	const cooldownTime = force ? 0 : get(engineCooldownYTStore) * 60 * 60 * 1000;
	const stale: ChannelSubscriptions[] = [];

	for (const channel of channelSubscriptions) {
		let lastRSSFetch = new Date(channel.lastRSSFetch);

		if (get(rawMasterKeyStore)) {
			const localSub = await localDb.channelSubscriptions
				.where('channelId')
				.equals(channel.channelId)
				.first();

			if (!localSub) {
				lastRSSFetch = new Date(0);
			} else {
				lastRSSFetch = new Date(localSub.lastRSSFetch);
			}
		}

		const timeDifference = now.getTime() - lastRSSFetch.getTime();
		if (timeDifference >= cooldownTime) {
			stale.push(channel);
		}
	}

	stale.sort((a, b) => {
		const aTime = new Date(a.lastRSSFetch).getTime();
		const bTime = new Date(b.lastRSSFetch).getTime();
		return aTime - bTime;
	});

	return stale;
}

async function refreshStaleChannels(force: boolean): Promise<FeedRefreshResult> {
	const staleChannels = await getStaleSubscriptions(force);
	const result: FeedRefreshResult = { checked: staleChannels.length, added: 0, failed: [] };
	if (staleChannels.length === 0) return result;

	const maxConcurrent = get(engineMaxConcurrentChannelsStore);

	for (let i = 0; i < staleChannels.length; i += maxConcurrent) {
		const batch = staleChannels.slice(i, i + maxConcurrent);
		const outcomes = await Promise.allSettled(batch.map((ch) => parseChannelRSS(ch.channelId)));
		outcomes.forEach((outcome, index) => {
			if (outcome.status === 'fulfilled') {
				result.added += outcome.value;
			} else {
				const channel = batch[index];
				const reason =
					outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
				console.error(`Feed refresh failed for ${channel.channelName}: ${reason}`);
				result.failed.push({
					channelId: channel.channelId,
					channelName: channel.channelName,
					reason
				});
			}
		});
	}

	return result;
}

let refreshForced = false;

/**
 * bix: the running refresh, or a new one. A forced refresh (the Refresh
 * button) ignores the cooldown; asked for while an unforced one runs, it
 * waits for that one and then runs.
 */
export function refreshFeedYTjs(force = false): Promise<FeedRefreshResult> {
	if (refreshPromise && force && !refreshForced) {
		return refreshPromise.then(() => refreshFeedYTjs(true));
	}
	if (!refreshPromise) {
		refreshForced = force;
		refreshPromise = refreshStaleChannels(force).finally(() => {
			refreshPromise = null;
		});
	}
	return refreshPromise;
}

export async function getFeedYTjs(maxResults: number, page: number): Promise<Feed> {
	refreshFeedYTjs().catch((error) => console.error('Feed refresh failed:', error));

	// bix: rows with no length are Shorts and streams the plain-RSS engine stored.
	const videos = (await localDb.subscriptionFeed.toArray()).filter(
		(video) => video.lengthSeconds > 0
	);
	videos.sort((a, b) => b.published - a.published);

	const start = (page - 1) * maxResults;
	const end = start + maxResults;
	const sliced = videos.slice(start, end);

	if (page === 1) {
		const cullAfter = get(engineCullYTStore);
		if (videos.length > cullAfter) {
			const videosToDelete = videos.slice(cullAfter);
			const videoIdsToDelete = videosToDelete.map((video) => video.videoId);
			await localDb.subscriptionFeed.where('videoId').anyOf(videoIdsToDelete).delete();
		}
	}

	return {
		notifications: [],
		videos: sliced
	};
}
