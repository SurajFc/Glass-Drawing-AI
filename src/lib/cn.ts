/** Join class names, dropping falsy values. Deliberately tiny — this app has
 *  no variant system to merge for. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ")
}
