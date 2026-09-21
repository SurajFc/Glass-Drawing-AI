import { useCallback, useEffect, useRef, useState } from "react"
import { ImagePlus, X } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/cn"

export type UploadedImage = { id: string; file: File; previewUrl: string }

export const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]
export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_FILES = 10

let seq = 0

/**
 * Multi-image picker: click, drag-and-drop, or paste straight from the
 * clipboard (handy for a screenshot of a drawing). Rejected files are
 * reported by name so the user knows which one was dropped and why.
 */
export function Dropzone({
  images,
  onChange,
  disabled,
  onPreview,
}: {
  images: UploadedImage[]
  onChange: (next: UploadedImage[]) => void
  disabled?: boolean
  onPreview: (image: UploadedImage) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const addFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return
      const incoming = Array.from(files)
      const accepted: UploadedImage[] = []

      for (const file of incoming) {
        if (!ALLOWED_TYPES.includes(file.type)) {
          toast.error(`${file.name}: only PNG, JPEG, WebP or GIF`)
          continue
        }
        if (file.size > MAX_FILE_BYTES) {
          toast.error(`${file.name}: larger than 5 MB`)
          continue
        }
        accepted.push({
          id: `img${++seq}`,
          file,
          previewUrl: URL.createObjectURL(file),
        })
      }
      if (accepted.length === 0) return

      const combined = [...images, ...accepted]
      if (combined.length > MAX_FILES) {
        toast.warning(`Maximum ${MAX_FILES} images — the extras were dropped`)
        combined.slice(MAX_FILES).forEach((i) => URL.revokeObjectURL(i.previewUrl))
      }
      onChange(combined.slice(0, MAX_FILES))
    },
    [images, onChange],
  )

  // Paste an image from the clipboard anywhere on the page.
  useEffect(() => {
    if (disabled) return
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length > 0) {
        e.preventDefault()
        addFiles(files)
      }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [addFiles, disabled])

  const remove = (id: string) => {
    const target = images.find((i) => i.id === id)
    if (target) URL.revokeObjectURL(target.previewUrl)
    onChange(images.filter((i) => i.id !== id))
  }

  return (
    <div className="space-y-3">
      {images.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2">
          {images.map((img, i) => (
            <li key={img.id} className="group relative">
              <button
                type="button"
                onClick={() => onPreview(img)}
                className="border-border bg-surface-2 block aspect-square w-full overflow-hidden rounded-lg border"
                title={`${img.file.name} — click to enlarge`}
              >
                <img
                  src={img.previewUrl}
                  alt={img.file.name}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              </button>
              <span className="bg-bg/85 absolute bottom-1 left-1 rounded px-1 text-[10px] font-medium">
                {i + 1}
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(img.id)}
                  aria-label={`Remove ${img.file.name}`}
                  className="bg-surface border-border absolute top-1 right-1 rounded-full border p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        disabled={disabled || images.length >= MAX_FILES}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!disabled) addFiles(e.dataTransfer.files)
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-50",
          images.length > 0 ? "px-4 py-3" : "px-4 py-10",
          dragging
            ? "border-accent bg-accent-soft"
            : "border-border hover:border-accent hover:bg-surface-2",
        )}
      >
        <ImagePlus
          className={cn("text-muted", images.length > 0 ? "size-4" : "size-8 opacity-50")}
        />
        {images.length > 0 ? (
          <span className="text-muted text-xs">
            Add more ({images.length}/{MAX_FILES})
          </span>
        ) : (
          <>
            <span className="text-sm font-medium">
              Drop a drawing, click to browse, or paste
            </span>
            <span className="text-muted text-xs">
              PNG · JPEG · WebP · max 5 MB each · up to {MAX_FILES} pages
            </span>
          </>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ""
        }}
      />
    </div>
  )
}
