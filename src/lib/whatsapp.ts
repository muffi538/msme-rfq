// Shared by the supplier form (validates on save) and RfqDetailClient
// (validates again right before opening a chat/group) so both sides agree
// on what counts as a real WhatsApp number/group link.

// strip non-digits and add India's +91 country code if the user saved the
// number without one. wa.me silently fails on a 10-digit local number —
// it must be in international form. Also rejects anything that isn't
// plausibly a real phone number (E.164 numbers are 10-15 digits) instead
// of silently producing a broken chat link.
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return "";
  let normalized = digits;
  if (digits.length === 10) normalized = `91${digits}`;
  else if (digits.length === 11 && digits.startsWith("0")) normalized = `91${digits.slice(1)}`;
  if (normalized.length < 10 || normalized.length > 15) return "";
  return normalized;
}

export function buildWaUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

// Group invite links only ever look like https://chat.whatsapp.com/<code>.
export function isValidWhatsappGroupLink(link: string | null | undefined): boolean {
  if (!link) return false;
  try {
    const url = new URL(link);
    return /(^|\.)chat\.whatsapp\.com$/i.test(url.hostname) && url.pathname.length > 1;
  } catch {
    return false;
  }
}
