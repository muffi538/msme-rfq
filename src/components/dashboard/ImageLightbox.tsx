"use client";

import { useState } from "react";
import { X, MessageSquare, ImageOff } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BUILT_IN_CATEGORIES } from "@/lib/categories";

const CATEGORY_NONE = "__NONE__";

export type LightboxImage = {
  id: string;
  signedUrl: string | null;
  source_file_name: string | null;
  category?: string | null;
  brand?: string | null;
  comment?: string | null;
};

// Full-size image viewer opened by clicking any RFQ item photo (assigned or
// unassigned) — also the place to manually annotate a photo the auto-
// matcher couldn't confidently link to a line item, since that image has
// no item of its own to carry a category/brand otherwise.
export function ImageLightbox({
  image,
  onClose,
  onSave,
}: {
  image: LightboxImage;
  onClose: () => void;
  onSave: (id: string, patch: { category?: string | null; brand?: string | null; comment?: string | null }) => Promise<void>;
}) {
  const [category, setCategory] = useState(image.category ?? "");
  const [brand, setBrand] = useState(image.brand ?? "");
  const [comment, setComment] = useState(image.comment ?? "");
  const [saving, setSaving] = useState(false);

  const dirty = category !== (image.category ?? "") || brand !== (image.brand ?? "") || comment !== (image.comment ?? "");

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(image.id, { category: category || null, brand: brand || null, comment: comment || null });
      onClose();
    } catch {
      // onSave already shows its own toast on failure — keep the modal
      // open so the user's edits aren't lost and they can retry.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl overflow-hidden max-w-3xl w-full max-h-[90vh] flex flex-col md:flex-row shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 bg-gray-50 flex items-center justify-center min-h-[240px] md:min-h-[400px]">
          {image.signedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.signedUrl}
              alt={image.source_file_name ?? "RFQ image"}
              className="max-w-full max-h-[80vh] md:max-h-[85vh] object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-gray-300">
              <ImageOff className="w-10 h-10" />
              <p className="text-xs">Image unavailable</p>
            </div>
          )}
        </div>

        <div className="w-full md:w-72 flex-shrink-0 p-5 space-y-4 overflow-y-auto border-t md:border-t-0 md:border-l border-gray-100">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-gray-700 break-all" title={image.source_file_name ?? undefined}>
              {image.source_file_name ?? "Image"}
            </p>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">Category</label>
            <Select
              value={category || CATEGORY_NONE}
              onValueChange={(v) => setCategory(v === CATEGORY_NONE || !v ? "" : v)}
            >
              <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue>{(val: string) => (val === CATEGORY_NONE ? "— None —" : val.replace(/_/g, " "))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CATEGORY_NONE} className="text-xs text-gray-400">— None —</SelectItem>
                {BUILT_IN_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c} className="text-xs">{c.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500">Brand</label>
            <Input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="e.g. DeWalt"
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
              <MessageSquare className="w-3 h-3" /> Comment
            </label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a note about this image…"
              className="text-xs min-h-24 resize-y"
            />
          </div>

          <Button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white h-9 text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
