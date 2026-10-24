// bix: lets a screen handle the Android Back button before the app navigates
// (the TV player closes its info panel). The newest handler runs first; if it
// returns true, Back is used up.
type BackHandler = () => boolean;

const handlers: BackHandler[] = [];

export function addBackHandler(handler: BackHandler): () => void {
	handlers.push(handler);
	return () => {
		const index = handlers.lastIndexOf(handler);
		if (index !== -1) handlers.splice(index, 1);
	};
}

export function runBackHandlers(): boolean {
	for (let i = handlers.length - 1; i >= 0; i--) {
		if (handlers[i]()) return true;
	}
	return false;
}
