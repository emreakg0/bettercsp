// Shared bounded parsing avoids duplicating the existing generation endpoint's trust boundary.
export class JsonBodyError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function readJsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new JsonBodyError('Send JSON settings.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new JsonBodyError('Missing request body.', 400);
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.length;
    if (length > 32000) { await reader.cancel(); throw new JsonBodyError('Settings are too large.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new JsonBodyError('Invalid JSON settings.', 400); }
}
