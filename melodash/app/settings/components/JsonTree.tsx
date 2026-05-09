import { ReactNode } from "react";

export function JsonTree({
  value,
  path = "$",
  depth = 0,
  onSelect,
}: {
  value: unknown;
  path?: string;
  depth?: number;
  onSelect: (path: string) => void;
}) {
  if (Array.isArray(value)) {
    const sample = value[0];

    return (
      <div>
        <button
          type="button"
          onClick={() => onSelect(`${path}[*]`)}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-blue-300 hover:bg-blue-500/10"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          <span>{path.split(".").pop()}</span>
          <span className="text-muted">array[{value.length}]</span>
        </button>
        {sample !== undefined && (
          <JsonTree value={sample} path={`${path}[*]`} depth={depth + 1} onSelect={onSelect} />
        )}
      </div>
    );
  }

  if (value && typeof value === "object") {
    return (
      <div>
        {Object.entries(value as Record<string, unknown>).map(([key, child]) => {
          const childPath = path === "$" ? `$.${key}` : `${path}.${key}`;

          return (
            <div key={childPath}>
              <button
                type="button"
                onClick={() => onSelect(childPath)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-secondary hover:bg-black/5 dark:hover:bg-black/5 dark:bg-black/5 dark:bg-card/5"
                style={{ paddingLeft: `${depth * 14 + 8}px` }}
              >
                <span>{key}</span>
                <span className="truncate text-secondary">
                  {Array.isArray(child) ? `array[${child.length}]` : typeof child}
                </span>
              </button>
              {Boolean(Array.isArray(child) || (child && typeof child === "object")) && (
                <JsonTree value={child} path={childPath} depth={depth + 1} onSelect={onSelect} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(path)}
      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-secondary hover:bg-black/5 dark:hover:bg-black/5 dark:bg-black/5 dark:bg-card/5"
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
    >
      <span>{path.split(".").pop()}</span>
      <span className="truncate text-secondary">{String(value)}</span>
    </button>
  );
}
