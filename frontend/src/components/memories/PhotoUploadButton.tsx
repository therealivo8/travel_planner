"use client";

import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api";
import { uploadPhoto, type PhotoTarget } from "@/lib/images";
import { useOnline } from "@/hooks/useOnline";
import type { TripPhoto } from "@/types";

interface Props extends PhotoTarget {
  tripId: string;
  onUploaded: (photo: TripPhoto) => void;
  label?: string;
  className?: string;
}

/** Pick or take photos; each is shrunk in the browser and sent straight to R2. */
export function PhotoUploadButton({ tripId, onUploaded, label = "Add photos", className, ...target }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const online = useOnline();
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      try {
        onUploaded(await uploadPhoto(tripId, file, target));
      } catch (err) {
        toast.error(`${file.name}: ${apiErrorMessage(err, "Upload failed")}`);
      }
    }
    setBusy(false);
    if (input.current) input.current.value = "";
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        className={className}
        disabled={busy || !online}
        title={online ? undefined : "Photos can't be uploaded while offline"}
        onClick={() => input.current?.click()}
      >
        <Camera className="mr-1.5 h-4 w-4" aria-hidden />
        {busy ? "Uploading…" : label}
      </Button>
    </>
  );
}
