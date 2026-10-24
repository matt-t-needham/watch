import { isOwnBackend } from '$lib/shared';
import { error, json } from '@sveltejs/kit';

export async function GET() {
	const backend = isOwnBackend();
	if (!backend) throw error(404, 'Not found');

	return json({
		...backend,
		version: import.meta.env.APP_VERSION,
		backend: 'materialious'
	});
}
