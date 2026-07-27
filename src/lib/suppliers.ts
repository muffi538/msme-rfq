// Shared between the manual Add/Edit supplier form (client-side, immediate
// feedback) and the Excel/Tally import route (server-side, per-row) so both
// paths agree on what a valid supplier record looks like — same reasoning
// as whatsapp.ts being shared across its two consumers.
import { normalizePhone } from "@/lib/whatsapp";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export type SupplierValidationInput = {
  name: string;
  email?: string | null;
  whatsapp_number?: string | null;
  phone_number?: string | null;
};

// Returns every validation failure found (not just the first) so a caller
// can show them all at once instead of forcing several rounds of "fix one,
// find the next." An empty array means the record is valid.
export function validateSupplier(input: SupplierValidationInput): string[] {
  const errors: string[] = [];
  if (!input.name || !input.name.trim()) errors.push("Supplier name is required.");
  if (input.email && input.email.trim() && !isValidEmail(input.email)) {
    errors.push(`"${input.email}" is not a valid email address.`);
  }
  if (input.whatsapp_number && input.whatsapp_number.trim() && !normalizePhone(input.whatsapp_number)) {
    errors.push(`"${input.whatsapp_number}" is not a valid WhatsApp number.`);
  }
  if (input.phone_number && input.phone_number.trim() && !normalizePhone(input.phone_number)) {
    errors.push(`"${input.phone_number}" is not a valid phone number.`);
  }
  return errors;
}

// Normalized lookup key for duplicate detection — trim + lowercase so
// "Sharma Traders" and "sharma traders " are recognized as the same
// supplier instead of silently becoming two rows.
export function normalizeForMatch(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}
