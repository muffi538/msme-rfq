export async function parsePdf(buffer: Buffer): Promise<string> {
  // Dynamic import keeps pdf-parse out of the bundle (avoids canvas/DOMMatrix on Vercel)
  const mod = await import("pdf-parse");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse = (mod as any).default ?? mod;
  const data = await (pdfParse as (buf: Buffer) => Promise<{ text: string }>)(buffer);
  return data.text;
}
