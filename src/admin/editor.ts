export function insertImageMarkdown(url: string, alt = ""): string {
	return `![${alt.replace(/[[\]]/g, "")}](${url})`;
}

export function insertVideoHtml(url: string): string {
	const safe = url.replace(/["<>]/g, "");
	return `<video controls preload="metadata" src="${safe}"></video>`;
}

export function insertAtSelection(
	value: string,
	insertion: string,
	start: number,
	end: number,
): { value: string; selectionStart: number; selectionEnd: number } {
	const next = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
	const cursor = start + insertion.length;
	return { value: next, selectionStart: cursor, selectionEnd: cursor };
}
