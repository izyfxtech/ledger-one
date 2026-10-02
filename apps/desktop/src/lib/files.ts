import { isTauriRuntime } from "@/lib/db/backend";

// Saving and opening files, on desktop (native dialogs + Rust file commands)
// and in the browser (a download and a file picker). Callers don't care which.

type Filter = { name: string; extensions: string[] };

/** Save text to a file the user chooses. Returns false if they cancelled. */
export async function saveTextFile(opts: {
  defaultName: string;
  content: string;
  filter: Filter;
  mime?: string;
}): Promise<boolean> {
  if (isTauriRuntime()) {
    const [{ save }, { invoke }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/api/core"),
    ]);
    const path = await save({ defaultPath: opts.defaultName, filters: [opts.filter] });
    if (!path) return false;
    await invoke("write_export_file", { path, content: opts.content });
    return true;
  }
  const blob = new Blob([opts.content], { type: opts.mime ?? "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = opts.defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

/** Let the user pick a text file and return its contents (null if cancelled). */
export async function pickTextFile(filter: Filter): Promise<string | null> {
  if (isTauriRuntime()) {
    const [{ open }, { invoke }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/api/core"),
    ]);
    const selected = await open({ multiple: false, directory: false, filters: [filter] });
    if (!selected || Array.isArray(selected)) return null;
    return invoke<string>("read_import_file", { path: selected });
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = filter.extensions.map((e) => `.${e}`).join(",");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, reject);
    };
    // Fires in modern browsers when the dialog is dismissed without a choice.
    input.oncancel = () => resolve(null);
    input.click();
  });
}
