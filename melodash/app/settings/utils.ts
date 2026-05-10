import { RuntimeValue } from "./types";

export function inputClass() {
 return "w-full rounded-md border border-border bg-page px-3 py-2 text-sm text-primary outline-none transition-colors placeholder:text-secondary focus:border-blue-500";
}

export function normalizeValue(value: RuntimeValue | undefined) {
 return value === undefined || value === null ? "" : String(value);
}

export function normalizeJsonPath(path: string) {
 return path.replace(/\[\*\]$/, "");
}

export function generateId() {
 return "cp_" + Math.random().toString(36).substring(2, 9);
}

export function getRelativeAlbumPath(arrayPath: string | undefined, selectedPath: string) {
 if (!arrayPath || !selectedPath.startsWith(normalizeJsonPath(arrayPath))) {
 return selectedPath;
 }
 return selectedPath
 .slice(normalizeJsonPath(arrayPath).length)
 .replace(/^\[\*\]\.?/, "")
 .replace(/^\./, "");
}

export function formatJson(value: unknown) {
 return JSON.stringify(value, null, 2);
}
