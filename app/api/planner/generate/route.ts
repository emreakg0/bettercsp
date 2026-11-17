import { catalogSource, getCatalog } from '@/lib/catalog/server';
import { generateSchedules } from '@/lib/scheduling/generate';
import { parseGenerationRequest } from '@/lib/scheduling/generation-request';

// A new read-only computation endpoint keeps bounded solving off the browser's main thread.
export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get('content-type')?.includes('application/json')) return Response.json({ error: 'Send JSON settings.' }, { status: 415 });
  let input: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Missing request body.');
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 32000) { await reader.cancel(); return Response.json({ error: 'Settings are too large.' }, { status: 413 }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    input = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return Response.json({ error: 'Invalid JSON settings.' }, { status: 400 }); }
  if (!input || typeof input !== 'object' || !('sourceId' in input) || input.sourceId !== catalogSource.id) {
    return Response.json({ error: 'This semester/campus catalog is not available. Reload the planner.' }, { status: 400 });
  }
  let settings;
  try { settings = parseGenerationRequest(input); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid generation settings.' }, { status: 400 }); }
  try {
    const result = generateSchedules((await getCatalog()).courses, settings);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Schedule generation failed', error);
    return Response.json({ error: 'The catalog could not be processed. Your manual schedule is unchanged; retry generation.' }, { status: 503 });
  }
}
