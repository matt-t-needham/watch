// bix: "Watch on TV". A phone or browser sends the video it's playing to the
// TV app through the watch-party relay (/api/watchParty/<room>), which pushes
// it to the TV as server-sent events.
//
// The room is a random 128-bit name kept in the account's synced settings,
// which are encrypted on the device, so only this account's signed-in devices
// know it. The relay itself has no login (EventSource couldn't send the TV's
// token anyway). Only the TV creates the room; senders use the TV's.
//
// The stream is read with fetch rather than EventSource: on Android, fetch
// goes through the app's local proxy, which supplies the CORS headers a
// cross-origin EventSource would lack.

import { addOrUpdateKeyValue, getKeyValue } from '$lib/api/backend/keyvalue';
import { backendFetch } from '$lib/api/backend/request';
import { isMaterialiousAccountActive } from '$lib/backend';
import { watchPartyEventSchema } from '$lib/watchParty';
import { addToast } from '$lib/components/Toast.svelte';
import { _ } from '$lib/i18n';
import { get } from 'svelte/store';

const ROOM_KEY = 'bixTvRoom';
const HANDLED_KEY = 'bixTvLastHandled';
const ROOM_PATTERN = /^[0-9a-f]{32}$/;
// The relay replays recent events to a new listener; older ones are stale.
const MAX_AGE_MS = 60_000;

export class NoTvError extends Error {
	constructor() {
		super('No TV has set up Watch on TV for this account yet');
	}
}

export function watchOnTvAvailable(): boolean {
	return isMaterialiousAccountActive();
}

async function readRoom(): Promise<string | null> {
	const room = await getKeyValue(ROOM_KEY);
	return typeof room === 'string' && ROOM_PATTERN.test(room) ? room : null;
}

async function createRoom(): Promise<string> {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	const room = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	await addOrUpdateKeyValue(ROOM_KEY, room);
	// addOrUpdateKeyValue doesn't report a failed save; read it back.
	if ((await readRoom()) !== room) throw new Error('Saving the TV room to the account failed');
	return room;
}

export async function sendToTv(videoId: string, currentTime: number): Promise<void> {
	const room = await readRoom();
	if (!room) throw new NoTvError();

	const resp = await backendFetch(`/api/watchParty/${room}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			event: 'goToVideo',
			videoId,
			sent: new Date().toISOString(),
			// The relay re-sends its last event, freshly stamped, to anyone who
			// joins; a tiny random offset makes each send unique so the TV can
			// tell a replay from a new request.
			currentTime: Math.max(0, currentTime) + Math.random() / 1000
		})
	});
	if (!resp.ok) throw new Error(`The server answered ${resp.status}`);
}

/**
 * Sends and tells the user how it went (toast). Returns whether it was sent.
 * A time under a second means "from where I left off": the TV then resumes
 * from watch history instead of starting at 0.
 */
export async function sendToTvAndReport(videoId: string, currentTime: number): Promise<boolean> {
	const t = get(_);
	try {
		await sendToTv(videoId, currentTime);
		addToast({ data: { text: t('watchOnTv.sent') } });
		return true;
	} catch (error) {
		console.error('Watch on TV failed:', error);
		addToast({
			data: {
				text:
					error instanceof NoTvError
						? t('watchOnTv.noTv')
						: t('watchOnTv.failed', {
								reason: error instanceof Error ? error.message : String(error)
							})
			}
		});
		return false;
	}
}

function alreadyHandled(key: string): boolean {
	try {
		if (localStorage.getItem(HANDLED_KEY) === key) return true;
		localStorage.setItem(HANDLED_KEY, key);
	} catch (error) {
		// Without storage a replay may play again; still play this one.
		console.error('Watch on TV: remembering the last request failed:', error);
	}
	return false;
}

function handleMessage(data: string, onPlay: (videoId: string, time: number) => void) {
	let message: unknown;
	try {
		message = JSON.parse(data);
	} catch {
		console.error('Watch on TV: unreadable message:', data);
		return;
	}
	const parsed = watchPartyEventSchema.safeParse(message);
	// The relay's own 'hello' and other party events aren't for us.
	if (!parsed.success || parsed.data.event !== 'goToVideo') return;

	const { videoId, currentTime, sent } = parsed.data;
	if (Date.now() - new Date(sent).getTime() > MAX_AGE_MS) return;
	if (alreadyHandled(`${videoId}@${currentTime}`)) return;
	onPlay(videoId, currentTime);
}

async function readEvents(body: ReadableStream<Uint8Array>, onData: (data: string) => void) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (done) return;
		buffer += decoder.decode(value, { stream: true });
		let end: number;
		while ((end = buffer.indexOf('\n\n')) !== -1) {
			const block = buffer.slice(0, end);
			buffer = buffer.slice(end + 2);
			const data = block
				.split('\n')
				.filter((line) => line.startsWith('data:'))
				.map((line) => line.slice(5).trimStart())
				.join('\n');
			if (data) onData(data);
		}
	}
}

/** TV side: listen until the returned function is called, reconnecting as needed. */
export function listenForTv(onPlay: (videoId: string, time: number) => void): () => void {
	let stopped = false;
	let controller: AbortController | undefined;

	(async () => {
		let delay = 2_000;
		while (!stopped) {
			try {
				const room = (await readRoom()) ?? (await createRoom());
				controller = new AbortController();
				const resp = await backendFetch(`/api/watchParty/${room}`, {
					headers: { Accept: 'text/event-stream' },
					signal: controller.signal
				});
				if (!resp.ok || !resp.body) throw new Error(`The server answered ${resp.status}`);
				delay = 2_000;
				await readEvents(resp.body, (data) => handleMessage(data, onPlay));
			} catch (error) {
				if (stopped) return;
				console.error('Watch on TV: listening failed, retrying:', error);
			}
			if (stopped) return;
			await new Promise((resolve) => setTimeout(resolve, delay));
			delay = Math.min(delay * 2, 60_000);
		}
	})();

	return () => {
		stopped = true;
		controller?.abort();
	};
}
