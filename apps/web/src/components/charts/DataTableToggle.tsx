import { cn } from '@/lib/cn';

/** Table view twin for a chart (WCAG-clean equivalent of the plotted values). */
export function DataTableToggle({
  caption,
  columns,
  rows,
  className,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
  className?: string;
}) {
  return (
    <details className={cn('group mt-2 text-xs', className)}>
      <summary className="inline-flex select-none items-center gap-1 rounded px-1 text-ink-3 hover:text-ink-2">
        <span className="transition-transform group-open:rotate-90" aria-hidden>
          ›
        </span>
        檢視資料表
      </summary>
      <div className="mt-2 relative max-h-64 overflow-auto rounded-md border border-line scroll-thin">
        <table className="w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-raised text-ink-2">
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col" className="px-2.5 py-1.5 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line text-ink-2">
                {r.map((v, j) => (
                  <td key={j} className={cn('px-2.5 py-1', j > 0 && 'tabular')}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
