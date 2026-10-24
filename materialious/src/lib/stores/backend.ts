import { writable, type Writable } from 'svelte/store';
import { persist } from '@macfja/svelte-persistent-store';
import { createStorage } from './storage';
import type { IsOwnBackend } from '$lib/shared';

export const rawMasterKeyStore: Writable<string | undefined> = persist(
	writable(),
	createStorage(),
	'rawMasterKey'
);

export const materialiousBackendStore: Writable<string | undefined> = persist(
	writable(),
	createStorage(),
	'materialiousBackendUrl'
);

export const authTokenStore: Writable<string | undefined> = persist(
	writable(),
	createStorage(),
	'materialiousAuthToken'
);

export const configBackendCache: Writable<IsOwnBackend | undefined> = writable();
// bix: Watch on TV's room name (see $lib/watchOnTv). Registered as a synced
// setting so the server's keyValue allowlist accepts it.
export const bixTvRoomStore: Writable<string | undefined> = persist(
	writable(),
	createStorage(),
	'bixTvRoom'
);
