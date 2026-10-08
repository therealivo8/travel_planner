"use client";

import { toast } from "sonner";
import { useEffect, useState } from "react";
import { Copy, Check, Share2, X } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import type { ShareInfo } from "@/types";

interface ShareModalProps {
  tripId: string;
  initialIsPublic: boolean;
  initialShareRecap?: boolean;
  initialShareToken: string | null;
  onClose: () => void;
}

export function ShareModal({
  tripId,
  initialIsPublic,
  initialShareRecap = false,
  initialShareToken,
  onClose,
}: ShareModalProps) {
  const [shareRecap, setShareRecap] = useState(initialShareRecap);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(
    initialIsPublic && initialShareToken
      ? { share_token: initialShareToken, share_url: "", is_public: true }
      : null
  );
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // If initially public, fetch the full share URL
    if (initialIsPublic && initialShareToken) {
      api
        .post<ShareInfo>(`/trips/${tripId}/share`)
        .then((info) => setShareInfo(info))
        .catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRecapToggle() {
    const next = !shareRecap;
    setShareRecap(next);
    try {
      await api.patch(`/trips/${tripId}`, { share_recap: next });
    } catch (err) {
      setShareRecap(!next);
      toast.error(err instanceof Error ? err.message : "Failed to update sharing");
    }
  }

  async function handleToggle() {
    setLoading(true);
    try {
      if (isPublic) {
        await api.delete(`/trips/${tripId}/share`);
        setIsPublic(false);
        setShareInfo(null);
      } else {
        const info = await api.post<ShareInfo>(`/trips/${tripId}/share`);
        setIsPublic(true);
        setShareInfo(info);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update sharing");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!shareInfo?.share_url) return;
    await navigator.clipboard.writeText(shareInfo.share_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary-600" />
            <h2 className="text-base font-semibold text-neutral-900">Share Trip</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-neutral-400 hover:text-neutral-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center justify-between py-3 border-y border-neutral-100 mb-4">
          <div>
            <p className="text-sm font-medium text-neutral-800">Public link</p>
            <p className="text-xs text-neutral-500 mt-0.5">
              Anyone with the link can view this trip (read-only)
            </p>
          </div>
          <button
            onClick={handleToggle}
            disabled={loading}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              isPublic ? "bg-primary-600" : "bg-neutral-200"
            } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
            role="switch"
            aria-checked={isPublic}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                isPublic ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {isPublic && shareInfo?.share_url && (
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={shareInfo.share_url}
              className="flex-1 text-xs bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-neutral-700 font-mono focus:outline-none"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopy}
              className="shrink-0"
              aria-label={copied ? "Link copied" : "Copy share link"}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        )}

        {isPublic && (
          <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-4">
            <div>
              <p className="text-sm font-medium text-neutral-800">Add recap to share page</p>
              <p className="mt-0.5 text-xs text-neutral-500">
                Shows visited stops, your notes and photos. Spending stays private.
              </p>
            </div>
            <button
              onClick={handleRecapToggle}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
                shareRecap ? "bg-primary-600" : "bg-neutral-200"
              }`}
              role="switch"
              aria-checked={shareRecap}
              aria-label="Add recap to share page"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  shareRecap ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        )}

        {!isPublic && (
          <p className="text-xs text-neutral-500 text-center py-2">
            Enable sharing to get a public link.
          </p>
        )}
      </div>
    </div>
  );
}
