/**
 * Copy a string to the clipboard, with a fallback for browsers / contexts
 * where `navigator.clipboard.writeText` is unavailable (insecure HTTP origin,
 * focus issues, older browsers). The fallback uses a hidden textarea +
 * `document.execCommand("copy")`, which works in nearly every browser.
 *
 * Resolves with `true` on success, `false` on failure. Never throws.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Modern path. Requires a secure context (https or localhost) AND a focused
  // document — fails silently in some embedded views.
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }

  // Fallback: write to a hidden textarea, select, execCommand("copy").
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.padding = "0";
    ta.style.border = "none";
    ta.style.outline = "none";
    ta.style.boxShadow = "none";
    ta.style.background = "transparent";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
