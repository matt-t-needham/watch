import { backendFetch } from '$lib/api/backend/request';

export async function webPoTokenMinter(requestKey: string, visitorData: string): Promise<string> {
	// bix: backendFetch sends the page's login token; plain fetch relied on
	// the session cookie, which lapses while the token still works (401).
	const resp = await backendFetch('/api/poToken', {
		body: JSON.stringify({
			requestKey,
			visitorData
		}),
		method: 'POST'
	});

	if (!resp.ok) {
		let errorMsg = 'An error occurred';
		try {
			errorMsg = (await resp.json()).message;
		} catch {
			// Ignore error
		}

		throw new Error(errorMsg);
	}

	return await resp.text();
}
