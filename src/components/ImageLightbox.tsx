import { useEffect } from "react"
import { X } from "lucide-react"

import type { UploadedImage } from "@/components/Dropzone"

/** Full-screen preview of one uploaded drawing. Escape or a backdrop click
 *  closes it — deliberately simple, no focus trap library. */
export function ImageLightbox({
  image,
  onClose,
}: {
  image: UploadedImage | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!image) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [image, onClose])

  if (!image) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.file.name}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <button
        type="button"
        aria-label="Close preview"
        onClick={onClose}
        className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
      >
        <X className="size-5" />
      </button>
      <figure className="max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <img
          src={image.previewUrl}
          alt={image.file.name}
          className="max-h-[85vh] rounded-lg object-contain shadow-2xl"
        />
        <figcaption className="mt-2 text-center text-xs text-white/70">
          {image.file.name}
        </figcaption>
      </figure>
    </div>
  )
}
