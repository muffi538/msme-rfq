// Relocated from the upload route so both the PDF-parse fallback and image
// OCR (single- and multi-file upload, plus the process route) can share one
// implementation. Originally never checked res.ok — an OpenAI error
// response (429/5xx/4xx) silently produced empty text instead of throwing,
// which made it look like "this file has no text" instead of "OCR failed,"
// and meant any retry wrapper around this call had nothing to actually
// catch. Now throws on failure so callers can tell the difference and retry.
export async function extractTextViaOpenAI(buffer: Buffer, mimeType: string): Promise<string> {
  const base64 = buffer.toString("base64");
  const isPdf  = mimeType.includes("pdf");
  const startedAt = Date.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      // Root cause of "the same document sometimes succeeds, sometimes
      // fails": this call had no temperature set, so it defaulted to 1.0 —
      // genuine sampling randomness on every OCR call, meaning the exact
      // same image could legitimately produce DIFFERENT extracted text
      // (different wording/digit transcription) run to run, which then
      // cascades into different downstream extraction outcomes for what
      // the user sees as "the same document." OCR is a transcription task,
      // not a creative one — there's no reason for it to vary.
      temperature: 0,
      messages: [{
        role: "user",
        content: isPdf
          ? [
              { type: "text", text: "Extract all text from this RFQ document. Return just the raw text, preserve item names, quantities and units." },
              { type: "file", file: { filename: "document.pdf", file_data: `data:application/pdf;base64,${base64}` } },
            ]
          : [
              { type: "text", text: "Extract all text from this RFQ image. Return just the raw text, no commentary." },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
      }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  // OpenAI's own request id — the single most useful thing to hand OpenAI
  // support/dashboard lookups when a specific call is slow or misbehaves,
  // and otherwise unrecoverable after the fact.
  const requestId = res.headers.get("x-request-id");
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    console.log(`[extractTextViaOpenAI] FAILED status=${res.status} requestId=${requestId} durationMs=${Date.now() - startedAt} mime=${mimeType} bytes=${buffer.length}`);
    throw new Error(`OpenAI vision error (${res.status}): ${errText}`);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  console.log(`[extractTextViaOpenAI] COMPLETE requestId=${requestId} durationMs=${Date.now() - startedAt} mime=${mimeType} bytes=${buffer.length} tokens=${JSON.stringify(json.usage ?? {})}`);
  if (!content) throw new Error("OpenAI returned no text content");
  return content;
}
