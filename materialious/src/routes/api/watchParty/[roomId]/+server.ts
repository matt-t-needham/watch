import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { WatchPartyEvent } from '$lib/watchParty';
import {
	broadcastWatchParty,
	createWatchPartyClientId,
	joinWatchParty,
	leaveWatchParty,
	type WatchPartyClient
} from '$lib/server/watchParty';

// bix: Watch on TV's rooms are named in a header, not the path, so the
// secret never reaches access or error logs: /api/watchParty/bix-tv with
// X-Bix-Room: <32 hex>. Other rooms work as upstream.
const BIX_TV_PATH = 'bix-tv';
const BIX_ROOM_PATTERN = /^[0-9a-f]{32}$/;

function resolveRoom(pathRoomId: string, headers: Headers): string {
	if (pathRoomId !== BIX_TV_PATH) return pathRoomId;
	const room = headers.get('x-bix-room') ?? '';
	if (!BIX_ROOM_PATTERN.test(room)) throw error(400, 'Missing or malformed X-Bix-Room');
	return `${BIX_TV_PATH}:${room}`;
}

const SSE_HEADERS = {
	'Content-Type': 'text/event-stream',
	'Cache-Control': 'no-cache, no-transform',
	Connection: 'keep-alive',
	'X-Accel-Buffering': 'no'
};

export const GET: RequestHandler = ({ params, request }) => {
	const roomId = resolveRoom(params.roomId, request.headers);
	const clientId = createWatchPartyClientId();
	const encoder = new TextEncoder();

	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let stopped = false;

	const stop = () => {
		if (stopped) return;
		stopped = true;
		if (heartbeat) clearInterval(heartbeat);
		leaveWatchParty(roomId, clientId);
	};

	const send = (message: WatchPartyEvent) => {
		if (!controller || stopped) return;
		try {
			controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
		} catch {
			stop();
		}
	};

	const client: WatchPartyClient = { id: clientId, send };

	const stream = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;

			controller.enqueue(
				encoder.encode(`data: ${JSON.stringify({ event: 'hello', clientId })}\n\n`)
			);

			const recent = joinWatchParty(roomId, client);
			for (const message of recent) {
				send(message);
			}

			heartbeat = setInterval(() => {
				try {
					controller?.enqueue(encoder.encode(`: ping\n\n`));
				} catch {
					stop();
				}
			}, 25_000);
		},
		cancel() {
			stop();
		}
	});

	return new Response(stream, { headers: SSE_HEADERS });
};

export const POST: RequestHandler = async ({ params, request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return error(400, 'Invalid JSON body');
	}

	const clientId =
		typeof (body as { clientId?: unknown }).clientId === 'string'
			? (body as { clientId: string }).clientId
			: undefined;

	if (!broadcastWatchParty(resolveRoom(params.roomId, request.headers), clientId, body)) {
		return error(400, 'Invalid watch party event');
	}

	return new Response(undefined, { status: 204 });
};
