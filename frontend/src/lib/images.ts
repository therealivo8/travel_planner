import { api } from "@/lib/api";

export const MAX_ORIGINAL_BYTES = 5 * 1024 * 1024; // 5 MB before resizing
const MAX_EDGE = 1600;

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  takenAt: string;
}

/**
 * Shrink a phone photo before upload: longest edge 1600 px, WebP at ~0.8 quality (JPEG where
 * the browser can't encode WebP), typically 200-400 KB. Re-drawing through a canvas also
 * discards all EXIF metadata, including GPS coordinates — photos can end up on public pages.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error("Photos can be at most 5 MB.");

  // from-image applies the EXIF orientation now, since we're about to drop the EXIF.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const toBlob = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  let blob = await toBlob("image/webp", 0.8);
  if (!blob || blob.type !== "image/webp") blob = await toBlob("image/jpeg", 0.82); // Safari
  if (!blob) throw new Error("Couldn't process that image.");

  return { blob, width, height, takenAt: new Date(file.lastModified || Date.now()).toISOString() };
}

export interface PhotoTarget {
  waypointId?: string;
  itineraryDayId?: string;
}

interface UploadUrl {
  object_key: string;
  upload_url: string;
  headers: Record<string, string>;
}

/** prepare -> ask the API for a presigned URL -> PUT straight to R2 -> confirm. */
export async function uploadPhoto(tripId: string, file: File, target: PhotoTarget = {}) {
  const img = await prepareImage(file);
  const links = { waypoint_id: target.waypointId, itinerary_day_id: target.itineraryDayId };

  const approved = await api.post<UploadUrl>(`/trips/${tripId}/photos/upload-url`, {
    content_type: img.blob.type,
    bytes: img.blob.size,
    width: img.width,
    height: img.height,
    ...links,
  });

  // Straight to R2: the image bytes never pass through our API.
  const put = await fetch(approved.upload_url, {
    method: "PUT",
    headers: approved.headers,
    body: img.blob,
  });
  if (!put.ok) throw new Error("The upload to storage failed. Please try again.");

  return api.post<import("@/types").TripPhoto>(`/trips/${tripId}/photos`, {
    object_key: approved.object_key,
    width: img.width,
    height: img.height,
    bytes: img.blob.size,
    taken_at: img.takenAt,
    ...links,
  });
}
