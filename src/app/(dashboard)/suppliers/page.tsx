"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Users, Pencil, X, AlertTriangle, Check } from "lucide-react";

const BUILT_IN_CATEGORIES = [
  "POWER_TOOLS","HAND_TOOLS","FURNITURE_FITTINGS","SAFETY_ITEMS",
  "FASTENERS","SANITARY_PLUMBING","PAINTS","VALVES_FITTINGS",
  "PACKAGING_MATERIALS","ELECTRICAL","HVAC","GENERAL_HARDWARE",
];

// Normalize free-text into a CATEGORY_KEY format: uppercase, underscores, no special chars
function normalizeCategory(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

type Supplier = {
  id: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  whatsapp_number: string | null;
  whatsapp_group_link: string | null;
  categories: string[];
};

const emptyForm = { name: "", contact_person: "", email: "", whatsapp_number: "", whatsapp_group_link: "", categories: [] as string[] };

export default function SuppliersPage() {
  const supabase = createClient();
  const [suppliers, setSuppliers]   = useState<Supplier[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);

  // Form state — null = closed, "add" = adding, supplier id = editing
  const [formMode, setFormMode]     = useState<null | "add" | string>(null);
  const [form, setForm]             = useState(emptyForm);

  // Delete confirm
  const [deleteId, setDeleteId]     = useState<string | null>(null);
  const [deleting, setDeleting]     = useState(false);

  // Custom categories (user-defined, persisted to user_settings)
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [newCategoryInput, setNewCategoryInput] = useState("");
  const [savingCategory,   setSavingCategory]   = useState(false);

  // Standalone "Manage Categories" modal (separate from the supplier form)
  const [categoriesModalOpen, setCategoriesModalOpen] = useState(false);
  const [modalCategoryInput,  setModalCategoryInput]  = useState("");

  async function addCategoryFromModal() {
    const normalized = normalizeCategory(modalCategoryInput);
    if (!normalized) return;
    if (BUILT_IN_CATEGORIES.includes(normalized) || customCategories.includes(normalized)) {
      setModalCategoryInput("");
      return;
    }
    setSavingCategory(true);
    const next = [...customCategories, normalized];
    setCustomCategories(next);
    await saveCustomCategories(next);
    setModalCategoryInput("");
    setSavingCategory(false);
  }

  useEffect(() => { fetchSuppliers(); fetchCustomCategories(); }, []);

  async function fetchCustomCategories() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "custom_categories")
      .single();
    if (data?.value) {
      try { setCustomCategories(JSON.parse(data.value)); } catch { /* ignore */ }
    }
  }

  async function saveCustomCategories(next: string[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("user_settings").upsert(
      { user_id: user.id, key: "custom_categories", value: JSON.stringify(next) },
      { onConflict: "user_id,key" }
    );
  }

  async function addCustomCategory() {
    const normalized = normalizeCategory(newCategoryInput);
    if (!normalized) return;
    // Skip if it already exists in built-in or custom
    if (BUILT_IN_CATEGORIES.includes(normalized) || customCategories.includes(normalized)) {
      setNewCategoryInput("");
      // Auto-toggle it on the form so the user sees their existing one selected
      if (!form.categories.includes(normalized)) toggleCategory(normalized);
      return;
    }
    setSavingCategory(true);
    const next = [...customCategories, normalized];
    setCustomCategories(next);
    await saveCustomCategories(next);
    // Auto-select the newly-added category for the supplier being edited
    if (!form.categories.includes(normalized)) toggleCategory(normalized);
    setNewCategoryInput("");
    setSavingCategory(false);
  }

  async function removeCustomCategory(cat: string) {
    const next = customCategories.filter((c) => c !== cat);
    setCustomCategories(next);
    await saveCustomCategories(next);
    // Also unselect if currently picked on form
    setForm((f) => ({ ...f, categories: f.categories.filter((c) => c !== cat) }));
  }

  // Combined list shown in the picker — built-ins first, then user's customs
  const allCategoryOptions = [...BUILT_IN_CATEGORIES, ...customCategories];

  async function fetchSuppliers() {
    setLoading(true);
    // Explicit user_id filter — defense-in-depth so each tenant only ever
    // sees their own suppliers, even if RLS is misconfigured.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSuppliers([]); setLoading(false); return; }
    const { data } = await supabase
      .from("suppliers")
      .select("*")
      .eq("user_id", user.id)
      .order("name");
    setSuppliers(data ?? []);
    setLoading(false);
  }

  function openAdd() {
    setForm(emptyForm);
    setFormMode("add");
  }

  function openEdit(s: Supplier) {
    setForm({
      name:                s.name,
      contact_person:      s.contact_person ?? "",
      email:               s.email ?? "",
      whatsapp_number:     s.whatsapp_number ?? "",
      whatsapp_group_link: s.whatsapp_group_link ?? "",
      categories:          s.categories ?? [],
    });
    setFormMode(s.id);
  }

  function closeForm() {
    setFormMode(null);
    setForm(emptyForm);
  }

  function toggleCategory(cat: string) {
    setForm((f) => ({
      ...f,
      categories: f.categories.includes(cat)
        ? f.categories.filter((c) => c !== cat)
        : [...f.categories, cat],
    }));
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();

    if (formMode === "add") {
      await supabase.from("suppliers").insert({
        user_id:              user!.id,
        name:                 form.name,
        contact_person:       form.contact_person || null,
        email:                form.email || null,
        whatsapp_number:      form.whatsapp_number || null,
        whatsapp_group_link:  form.whatsapp_group_link || null,
        categories:           form.categories,
      });
    } else {
      await supabase.from("suppliers").update({
        name:                 form.name,
        contact_person:       form.contact_person || null,
        email:                form.email || null,
        whatsapp_number:      form.whatsapp_number || null,
        whatsapp_group_link:  form.whatsapp_group_link || null,
        categories:           form.categories,
      }).eq("id", formMode!);
    }

    setSaving(false);
    closeForm();
    fetchSuppliers();
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleting(true);
    await supabase.from("suppliers").delete().eq("id", deleteId);
    setSuppliers((prev) => prev.filter((s) => s.id !== deleteId));
    setDeleteId(null);
    setDeleting(false);
  }

  const editingSupplier = typeof formMode === "string" && formMode !== "add"
    ? suppliers.find((s) => s.id === formMode)
    : null;

  return (
    <>
      <DashboardHeader title="Suppliers & Categories" />
      <main className="flex-1 p-8 space-y-6">

        {/* Delete confirmation modal */}
        {deleteId && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">Delete supplier?</p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    <strong>{suppliers.find(s => s.id === deleteId)?.name}</strong> will be permanently removed.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={confirmDelete}
                  disabled={deleting}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                >
                  {deleting ? "Deleting..." : "Yes, delete"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setDeleteId(null)}
                  disabled={deleting}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Top bar */}
        <div className="flex items-center justify-between">
          <p className="text-gray-500 text-sm">
            {suppliers.length} suppliers · {customCategories.length} custom categor{customCategories.length === 1 ? "y" : "ies"}
          </p>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setCategoriesModalOpen(true)}
              variant="outline"
              className="border-blue-200 text-blue-600 hover:bg-blue-50 gap-2"
            >
              <Plus className="w-4 h-4" /> Add Category
            </Button>
            <Button onClick={openAdd} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
              <Plus className="w-4 h-4" /> Add Supplier
            </Button>
          </div>
        </div>

        {/* Manage Categories modal */}
        {categoriesModalOpen && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-lg w-full space-y-5">

              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 text-lg">Manage Categories</h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Add categories that fit your business. Saved permanently.
                  </p>
                </div>
                <button
                  onClick={() => { setCategoriesModalOpen(false); setModalCategoryInput(""); }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Add input */}
              <div className="flex items-center gap-2">
                <Input
                  value={modalCategoryInput}
                  onChange={(e) => setModalCategoryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCategoryFromModal();
                    }
                  }}
                  placeholder="e.g. Steel, Plywood, Cement"
                  className="flex-1 h-10"
                  autoFocus
                />
                <Button
                  onClick={addCategoryFromModal}
                  disabled={savingCategory || !modalCategoryInput.trim()}
                  className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5 h-10"
                >
                  {savingCategory ? "Saving…" : <><Check className="w-3.5 h-3.5" />Add</>}
                </Button>
              </div>

              {/* Built-in section */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Built-in (always available)</p>
                <div className="flex flex-wrap gap-1.5">
                  {BUILT_IN_CATEGORIES.map((cat) => (
                    <span key={cat} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">
                      {cat.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>

              {/* Custom section */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                  Your custom categories ({customCategories.length})
                </p>
                {customCategories.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">
                    None yet — add one above. Custom categories appear in the supplier form alongside the built-ins.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {customCategories.map((cat) => (
                      <div key={cat} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-medium pr-1.5">
                        {cat.replace(/_/g, " ")}
                        <button
                          onClick={() => {
                            if (confirm(`Delete custom category "${cat.replace(/_/g, " ")}"? This won't affect existing supplier records.`)) {
                              removeCustomCategory(cat);
                            }
                          }}
                          className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-blue-100 transition-colors"
                          title="Remove"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2">
                <Button
                  onClick={() => { setCategoriesModalOpen(false); setModalCategoryInput(""); }}
                  variant="outline"
                  className="w-full"
                >
                  Done
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Add / Edit form */}
        {formMode !== null && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

            {/* Form header */}
            <div className="flex items-center justify-between px-7 py-5 border-b border-gray-100 bg-gray-50/50">
              <div>
                <p className="text-[11px] font-semibold tracking-widest text-blue-600 uppercase">
                  {formMode === "add" ? "New supplier" : "Editing supplier"}
                </p>
                <h3 className="font-semibold text-gray-900 text-lg mt-0.5">
                  {formMode === "add" ? "Add a new supplier" : editingSupplier?.name}
                </h3>
              </div>
              <button onClick={closeForm} className="text-gray-400 hover:text-gray-700 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-7 py-6 space-y-7">

              {/* ── Section 1: Identity ──────────────── */}
              <section className="space-y-3">
                <p className="text-[11px] font-semibold tracking-widest text-gray-400 uppercase">Company info</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-500 font-medium">Company name *</Label>
                    <Input placeholder="Sharma Traders" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-500 font-medium">Contact person</Label>
                    <Input placeholder="Ramesh Sharma" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
                  </div>
                </div>
              </section>

              {/* ── Section 2: Contact channels ──────── */}
              <section className="space-y-3">
                <p className="text-[11px] font-semibold tracking-widest text-gray-400 uppercase">Contact channels</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-500 font-medium">Email</Label>
                    <Input placeholder="ramesh@sharma.com" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-500 font-medium">WhatsApp number</Label>
                    <Input placeholder="+91 98765 43210" value={form.whatsapp_number} onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })} />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs text-gray-500 font-medium flex items-center gap-2">
                      WhatsApp group link
                      <span className="text-gray-300 font-normal text-[11px]">(optional)</span>
                    </Label>
                    <Input
                      placeholder="https://chat.whatsapp.com/xxxxx"
                      value={form.whatsapp_group_link}
                      onChange={(e) => setForm({ ...form, whatsapp_group_link: e.target.value })}
                    />
                    <p className="text-[11px] text-gray-400">
                      WhatsApp → Group → Invite via link → Copy link
                    </p>
                  </div>
                </div>
              </section>

              {/* ── Section 3: Categories ────────────── */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold tracking-widest text-gray-400 uppercase">
                    Categories
                    {form.categories.length > 0 && (
                      <span className="ml-2 text-blue-600 normal-case tracking-normal">
                        · {form.categories.length} selected
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {allCategoryOptions.map((cat) => {
                    const isCustom   = customCategories.includes(cat);
                    const isSelected = form.categories.includes(cat);
                    return (
                      <div key={cat} className="relative group">
                        <button
                          type="button"
                          onClick={() => toggleCategory(cat)}
                          className={`text-[11px] px-2.5 py-1 rounded-full border font-medium tracking-wide transition-colors ${
                            isSelected
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600"
                          } ${isCustom ? "pr-6" : ""}`}
                        >
                          {cat.replace(/_/g, " ")}
                        </button>
                        {isCustom && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Delete custom category "${cat.replace(/_/g, " ")}"? This won't affect existing supplier records.`)) {
                                removeCustomCategory(cat);
                              }
                            }}
                            title="Remove custom category"
                            className={`absolute top-1/2 -translate-y-1/2 right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center transition-colors ${
                              isSelected ? "text-white/70 hover:bg-white/20" : "text-gray-300 hover:bg-gray-100 hover:text-red-500"
                            }`}
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Inline add custom category */}
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex-1 relative">
                    <Plus className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                    <Input
                      value={newCategoryInput}
                      onChange={(e) => setNewCategoryInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCustomCategory();
                        }
                      }}
                      placeholder="Add custom category"
                      className="h-9 pl-9 text-sm bg-gray-50/50 border-gray-200"
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={addCustomCategory}
                    disabled={savingCategory || !newCategoryInput.trim()}
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5 border-blue-200 text-blue-600 hover:bg-blue-50"
                  >
                    {savingCategory
                      ? <span className="text-xs">Saving…</span>
                      : <><Check className="w-3.5 h-3.5" /><span className="text-xs">Add</span></>}
                  </Button>
                </div>
              </section>
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-end gap-2 px-7 py-4 border-t border-gray-100 bg-gray-50/50">
              <Button variant="outline" onClick={closeForm} className="border-gray-200">Cancel</Button>
              <Button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white shadow-[0_2px_8px_rgba(37,99,235,0.3)] disabled:opacity-50"
              >
                {saving ? "Saving..." : formMode === "add" ? "Save supplier" : "Save changes"}
              </Button>
            </div>
          </div>
        )}

        {/* Supplier list */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-gray-400">Loading...</div>
          ) : suppliers.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <Users className="w-10 h-10 text-gray-200 mb-3" />
              <p className="text-gray-400 font-medium">No suppliers yet</p>
              <p className="text-gray-400 text-sm mt-1">Add your first supplier above</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50">
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Contact</th>
                  <th className="px-6 py-3">WhatsApp</th>
                  <th className="px-6 py-3">Categories</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {suppliers.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{s.name}</td>
                    <td className="px-6 py-3 text-gray-500">{s.contact_person ?? "—"}</td>
                    <td className="px-6 py-3 text-gray-500">{s.whatsapp_number ?? "—"}</td>
                    <td className="px-6 py-3">
                      <div className="flex flex-wrap gap-1">
                        {s.categories.slice(0, 3).map((c) => (
                          <span key={c} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                            {c.replace(/_/g, " ")}
                          </span>
                        ))}
                        {s.categories.length > 3 && (
                          <span className="text-xs text-gray-400">+{s.categories.length - 3} more</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(s)}
                          className="text-gray-300 hover:text-blue-500 transition-colors"
                          title="Edit supplier"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(s.id)}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                          title="Delete supplier"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </>
  );
}
