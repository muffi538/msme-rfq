# features.md

Features are grouped by phase. Each has: description, why it matters, priority.

## Core Features (MVP — Phase 1)

### F1. Email ingestion (IMAP)
**Description:** n8n IMAP trigger polls a per-tenant inbox every 1–2 min, pulls new emails with attachments.
**Why it matters:** Zero-touch capture. Without this, every other automation is gated on manual upload.
**Priority:** High

### F2. Multi-format attachment parsing
**Description:** Handle PDF (text + scanned), Excel (.xls, .xlsx), CSV, and image attachments (JPG/PNG/HEIC).
**Why it matters:** Real RFQs come in all three. Excel-only support would cover ~40% of cases at best.
**Priority:** High

### F3. OCR for scanned PDFs and images
**Description:** Tesseract for cheap path; Google Vision API as fallback for low-confidence cases.
**Why it matters:** Handwritten and phone-photo RFQs are common from older buyers and small workshops.
**Priority:** High

### F4. LLM-based item normalization
**Description:** Send extracted raw text to an LLM (Claude Haiku or GPT-4o-mini for cost) with a strict JSON schema prompt; outputs `[{name, qty, unit, brand, spec, notes}]`.
**Why it matters:** Raw OCR/Excel rarely matches a clean schema — handles spelling variation, unit normalization, Hindi/Hinglish.
**Priority:** High

### F5. Fixed-category classifier
**Description:** Classifies each item into exactly one of 12 categories (Power Tools, Hand Tools, Furniture Fittings, Safety Items, Fasteners, Sanitary & Plumbing, Paints, Valves & Fittings, Packaging Materials, Electrical, HVAC, General Hardware). Hybrid: keyword/regex first pass + LLM fallback for unknowns.
**Why it matters:** Category is the routing key — wrong category = wrong supplier.
**Priority:** High

### F6. Tally Prime supplier sync
**Description:** Pull supplier ledgers from Tally (via Tally ODBC or daily XML/CSV export); each supplier tagged with one or more categories in our DB.
**Why it matters:** Tally is the source of truth for MSMEs. Forcing a parallel master = adoption killer.
**Priority:** High

### F7. RFQ splitter
**Description:** Given a parent RFQ with N items across M categories, produce child RFQs grouped by `(category → eligible supplier)`. One child RFQ = one outbound message.
**Why it matters:** Suppliers only want what they sell. Sending mixed lists kills response rates.
**Priority:** High

### F8. Human-in-the-loop approval UI
**Description:** Web app (Next.js + Supabase or simple Retool/Appsmith) showing: parent RFQ summary, list of child RFQs, editable items/categories/suppliers per child. One-click "Approve & Send" per child or "Approve All".
**Why it matters:** Locked in as a hard requirement. Catches OCR errors, wrong categories, and lets staff add context (e.g., "urgent", "no GST").
**Priority:** High

### F9. WhatsApp sending via AiSensy
**Description:** Pre-approved WhatsApp Business templates with variables for supplier name, item list, RFQ ID, deadline. n8n calls AiSensy API on approval.
**Why it matters:** WhatsApp is how Indian MSMEs actually transact. Email gets ignored.
**Priority:** High

### F10. Email fallback
**Description:** If supplier has no WhatsApp number or message fails, send same content via email (SMTP).
**Why it matters:** Some suppliers are email-first or have stale WhatsApp numbers.
**Priority:** High

### F11. Multi-tenant isolation
**Description:** Every record carries `tenant_id`. Each tenant has separate inbox, supplier master, AiSensy account, approval users. Row-level security in DB.
**Why it matters:** Confirmed scope: building for multiple MSME clients. Retrofitting tenancy later is painful.
**Priority:** High

### F12. Audit trail
**Description:** Every state change (extracted, categorized, edited by staff, approved, sent, delivered) logged with timestamp and user.
**Why it matters:** When a supplier complains "I never got the RFQ" or buyer claims "you missed an item", you need receipts.
**Priority:** High

### F13. Basic dashboard
**Description:** Per-tenant view: RFQs today/week, avg processing time, items pending approval, send-failure count.
**Why it matters:** Owner buy-in. Without visibility, the tool feels like a black box.
**Priority:** High

---

## Advanced Features (Phase 2)

### F14. Quote collation from supplier replies
**Description:** Parse supplier's WhatsApp/email reply ("price ₹450, MOQ 10, delivery 3 days"), structure into a comparison table per item.
**Why it matters:** Closes the loop. Eliminates the *other* manual step (collecting quotes).
**Priority:** High (Phase 2)

### F15. Per-tenant learning
**Description:** Item-name → category mappings approved by staff are stored per tenant; next time same string appears, skip LLM.
**Why it matters:** Cuts LLM cost and latency over time; accuracy improves with use.
**Priority:** High (Phase 2)

### F16. Supplier performance scoring
**Description:** Track response rate, response time, win rate per supplier per category. Surface in approval UI.
**Why it matters:** Helps staff pick top suppliers when category has many; dead suppliers get pruned.
**Priority:** Medium

### F17. Buyer profile / repeat detection
**Description:** Detect repeat buyers, surface their typical patterns (categories, urgency, payment terms).
**Why it matters:** Faster context for staff; enables personalized response templates.
**Priority:** Medium

### F18. Tally PO/quotation push
**Description:** Once a quote is finalized, push as a quotation/PO into Tally automatically.
**Why it matters:** Closes Tally loop; no double entry.
**Priority:** Medium

### F19. RFQ versioning
**Description:** Detect when buyer sends "revised RFQ" — link to original, show diff.
**Why it matters:** Prevents sending stale items to suppliers.
**Priority:** Medium

### F20. WhatsApp two-way conversation handling
**Description:** Suppliers can reply with structured commands ("QUOTE RFQ-1234 ITEM-3 RATE 450"); system parses.
**Why it matters:** Reduces parsing errors on the quote-collation side (F14).
**Priority:** Medium

---

## Nice-to-Have Features

### F21. Supplier self-onboarding link
**Description:** WhatsApp message to a new supplier with a link to add their categories, GSTIN, and preferences.
**Why it matters:** Removes data entry burden from MSME staff for new suppliers.
**Priority:** Low

### F22. Multi-language template support
**Description:** WhatsApp templates in Hindi, Marathi, Tamil, Gujarati, etc.
**Why it matters:** Some suppliers respond better in regional languages.
**Priority:** Low

### F23. Voice note RFQ
**Description:** Buyer sends a WhatsApp voice note → transcription → same pipeline.
**Why it matters:** Some buyers prefer voice; expands input modes.
**Priority:** Low

### F24. AI-suggested supplier additions
**Description:** When an item lands repeatedly in "no supplier", system suggests onboarding new suppliers based on web search or directory.
**Why it matters:** Surfaces gaps in supplier coverage proactively.
**Priority:** Low

### F25. Mobile PWA for approvers
**Description:** Approval UI works offline-first on mobile, push notifications for new RFQs.
**Why it matters:** Owners/managers approve on the go.
**Priority:** Low

### F26. Public buyer portal
**Description:** Buyers can submit RFQs via a form, track status, see consolidated quotes.
**Why it matters:** Premium offering; differentiates from email-only competitors.
**Priority:** Low

### F27. SLA alerts
**Description:** If a child RFQ has no supplier reply within X hours, auto-nudge supplier and notify staff.
**Why it matters:** Reduces dropped RFQs.
**Priority:** Low

### F28. Cost analytics
**Description:** Aggregate price trends per item across suppliers over time.
**Why it matters:** Negotiation leverage; identifies overpriced suppliers.
**Priority:** Low
