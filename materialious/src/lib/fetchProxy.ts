import { getPublicEnv } from '$lib/env';
import { isUnrestrictedPlatform } from '$lib/backend';
import { timeout } from '$lib/utils';
import { Capacitor } from '@capacitor/core';
import sodium from 'libsodium-wrappers-sumo';
import { isOwnBackend } from './shared';
import { get } from 'svelte/store';
import { authTokenStore } from './stores/backend';

// bix: the server's proxy requires a login. Its cookie (Path=/api, 60 days)
// lapses while the page's token keeps working, which left every proxied
// request 401 — no videos, no feed. Web requests to our own proxy carry the
// token in X-Bix-Auth instead; the server accepts it there and strips it
// before forwarding (never Authorization, which the proxy passes on).
function proxyAuthToken(): string | undefined {
	if (Capacitor.getPlatform() !== 'web' || !isOwnBackend()) return undefined;
	return get(authTokenStore) || undefined;
}

export const originalFetch = window.fetch;
export const corsProxyUrl =
	Capacitor.getPlatform() === 'android'
		? 'http://localhost:3000/'
		: `${location.origin}/api/proxy/`;

let mobileNodeLoaded = false;

function needsProxying(target: string): boolean {
	if (!target.startsWith('http')) return false;
	return true;
}

function encodeUrl(url: string): string {
	return Capacitor.getPlatform() === 'android' ? url : encodeURIComponent(url);
}

export const fetchProxied = async (
	requestInput: string | URL | Request,
	requestOptions?: RequestInit
): Promise<Response> => {
	if (!mobileNodeLoaded && Capacitor.getPlatform() === 'android') {
		let mobileNodeResp: Response | undefined;

		while (!mobileNodeResp || !mobileNodeResp.ok) {
			try {
				mobileNodeResp = await originalFetch(corsProxyUrl + 'check-nodejs');
			} catch {
				// Continue regardless of error
			}
			await timeout(100);
		}

		mobileNodeLoaded = true;
	}

	const nonProxiedUrl =
		requestInput instanceof Request ? requestInput.url : requestInput.toString();

	if (needsProxying(nonProxiedUrl)) {
		const proxiedUrl = corsProxyUrl + encodeUrl(nonProxiedUrl);

		const token = proxyAuthToken();

		if (requestInput instanceof Request) {
			const headers = new Headers(requestInput.headers);
			if (token) headers.set('X-Bix-Auth', token);
			requestInput = new Request(proxiedUrl, {
				method: requestInput.method,
				headers,
				body: requestInput.body,
				mode: requestInput.mode,
				credentials: requestInput.credentials,
				cache: requestInput.cache,
				redirect: requestInput.redirect,
				referrer: requestInput.referrer,
				integrity: requestInput.integrity,
				keepalive: requestInput.keepalive,
				...(requestInput.body ? { duplex: 'half' } : {})
			});
		} else {
			requestInput = proxiedUrl;
		}

		// Headers passed alongside a Request replace the Request's own
		// (youtubei.js calls fetch(request, { headers })), so add it here too.
		if (token && (!(requestInput instanceof Request) || requestOptions?.headers)) {
			requestOptions = {
				...requestOptions,
				headers: {
					...Object.fromEntries(new Headers(requestOptions?.headers).entries()),
					'X-Bix-Auth': token
				}
			};
		}
	}

	if (isOwnBackend() && Capacitor.getPlatform() === 'web' && requestOptions?.body) {
		if (requestOptions.body instanceof ArrayBuffer) {
			requestOptions.body = new Uint8Array(requestOptions?.body);
		}

		if (requestOptions.body instanceof Uint8Array) {
			await sodium.ready;
			requestOptions.body = sodium.to_base64(requestOptions.body);

			requestOptions.headers = {
				...requestOptions.headers,
				__is_base64_encoded: 'true'
			};
		}
	}

	// Use the original fetch with the proxied URL and options
	return originalFetch(requestInput, requestOptions);
};

if (
	isUnrestrictedPlatform() &&
	Capacitor.getPlatform() !== 'electron' &&
	getPublicEnv('PROXY_DISABLED') !== 'true'
) {
	window.fetch = fetchProxied;

	const originalXhrOpen = XMLHttpRequest.prototype.open;

	XMLHttpRequest.prototype.open = function (...args: any[]): void {
		const proxied = needsProxying(args[1]);
		if (proxied) {
			args[1] = corsProxyUrl + encodeUrl(args[1]);
		}
		// @ts-expect-error args have any type
		originalXhrOpen.apply(this, args);
		const token = proxied ? proxyAuthToken() : undefined;
		if (token) this.setRequestHeader('X-Bix-Auth', token);
	};
}
