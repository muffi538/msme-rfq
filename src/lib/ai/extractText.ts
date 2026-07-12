// Relocated unchanged from the upload route so both the PDF-parse fallback
// and image OCR (single- and multi-file upload) can share one implementation.
export async function extractTextViaOpenAI(buffer: Buffer, mimeType: string): Promise<string> {
  const base64 = buffer.toString("base64");
  const isPdf  = mimeType.includes("pdf");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
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
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}
