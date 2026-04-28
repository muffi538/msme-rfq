"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Users, Pencil, X, AlertTriangle } from "lucide-react";

const ALL_CATEGORIES = [
  "POWER_TOOLS","HAND_TOOLS","FURNITURE_FITTINGS","SAFETY_ITEMS",
  "FASTENERS","SANITARY_PLUMBING","PAINTS","VALVES_FITTINGS",
  "PACKAGING_MATERIALS","ELECTRICAL","HVAC","GENERAL_HARDWARE",
];

type Supplier = {
  id: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  whatsapp_number: string | null;
  categories: string[];
};

const emptyForm = { name: "", contact_person: "", email: "", whatsapp_number: "", categories: [] as string[] };

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

  useEffect(() => { fetchSuppliers(); }, []);

  async function fetchSuppliers() {
    setLoading(true);
    const { data } = await supabase.from("suppliers").select("*").order("name");
    setSuppliers(data ?? []);
    setLoading(false);
  }

  function openAdd() {
    setForm(emptyForm);
    setFormMode("add");
  }

  function openEdit(s: Supplier) {
    setForm({
      name:            s.name,
      contact_person:  s.contact_person ?? "",
      email:           s.email ?? "",
      whatsapp_number: s.whatsapp_number ?? "",
      categories:      s.categories ?? [],
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
        user_id:         user!.id,
        name:            form.name,
        contact_person:  form.contact_person || null,
        email:           form.email || null,
        whatsapp_number: form.whatsapp_number || null,
        categories:      form.categories,
      });
    } else {
      await supabase.from("suppliers").update({
        name:            form.name,
        contact_person:  form.contact_person || null,
        email:           form.email || null,
        whatsapp_number: form.whatsapp_number || null,
        categories:      form.categories,
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
      <DashboardHeader title="Suppliers" />
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
          <p className="text-gray-500 text-sm">{suppliers.length} suppliers</p>
          <Button onClick={openAdd} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
            <Plus className="w-4 h-4" /> Add Supplier
          </Button>
        </div>

        {/* Add / Edit form */}
        {formMode !== null && (
          <div className="bg-white rounded-2xl border border-blue-100 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">
                {formMode === "add" ? "New Supplier" : `Editing: ${editingSupplier?.name}`}
              </h3>
              <button onClick={closeForm} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Company name *</Label>
                <Input placeholder="Sharma Traders" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Contact person</Label>
                <Input placeholder="Ramesh Sharma" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input placeholder="ramesh@sharma.com" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>WhatsApp number</Label>
                <Input placeholder="+919876543210" value={form.whatsapp_number} onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Categories this supplier deals in</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                      form.categories.includes(cat)
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                    }`}
                  >
                    {cat.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <Button onClick={handleSave} disabled={saving || !form.name.trim()} className="bg-blue-600 hover:bg-blue-700 text-white">
                {saving ? "Saving..." : formMode === "add" ? "Save supplier" : "Save changes"}
              </Button>
              <Button variant="outline" onClick={closeForm}>Cancel</Button>
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
