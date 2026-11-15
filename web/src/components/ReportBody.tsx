/* Rapportens text (athlete_reports.body_md), ritad i appens formspråk.
 *
 * Bara det rapporterna faktiskt använder: rubriker (## och ###), stycken,
 * **fetstil**, [länkar](https://…), punkt- och numrerade listor och
 * pipe-tabeller. Allt byggs som React-element — ingen rå HTML släpps igenom,
 * så texten kan inte bära med sig något som körs. Länkar tillåts bara till
 * http(s). */

import type { ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] != null) {
      out.push(
        <strong key={`${keyBase}-b${i++}`} className="font-semibold text-[var(--foreground)]">
          {inline(m[1], `${keyBase}-b${i}`)}
        </strong>,
      );
    } else {
      out.push(
        <a
          key={`${keyBase}-a${i++}`}
          href={m[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          {m[2]}
        </a>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

export function ReportBody({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const key = `b${k++}`;
    if (line.startsWith("### ")) {
      blocks.push(
        <h3 key={key} className="mt-4 text-base font-semibold text-[var(--foreground)]">
          {inline(line.slice(4), key)}
        </h3>,
      );
      i++;
    } else if (line.startsWith("## ")) {
      blocks.push(
        <h2 key={key} className="display mt-6 text-xl leading-tight font-semibold text-[var(--foreground)]">
          {inline(line.slice(3), key)}
        </h2>,
      );
      i++;
    } else if (line.trim().startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++]);
      const [head, , ...body] = rows;
      blocks.push(
        // Tabellen får rulla i sidled i sin egen ram — sidan gör det aldrig.
        <div key={key} className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--ink-3)]">
                {cells(head).map((c, j) => (
                  <th key={j} className="border-b border-[var(--line)] py-1.5 pr-3 font-normal">
                    {inline(c, `${key}-h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri} className="border-b border-[var(--line)] align-top">
                  {cells(r).map((c, j) => (
                    <td key={j} className="tabular py-1.5 pr-3 text-[var(--ink-2)]">
                      {inline(c, `${key}-${ri}-${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^- /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      blocks.push(
        <ul key={key} className="flex list-disc flex-col gap-1.5 pl-5 text-[var(--ink-2)]">
          {items.map((t, j) => (
            <li key={j}>{inline(t, `${key}-${j}`)}</li>
          ))}
        </ul>,
      );
    } else if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, ""));
      blocks.push(
        <ol key={key} className="flex list-decimal flex-col gap-1.5 pl-5 text-[var(--ink-2)]">
          {items.map((t, j) => (
            <li key={j}>{inline(t, `${key}-${j}`)}</li>
          ))}
        </ol>,
      );
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{2,3} |- |\d+\. |\|)/.test(lines[i].trim())
      )
        para.push(lines[i++]);
      blocks.push(
        <p key={key} className="text-[var(--ink-2)]">
          {inline(para.join(" "), key)}
        </p>,
      );
    }
  }
  return <div className="flex max-w-3xl flex-col gap-3 leading-relaxed">{blocks}</div>;
}
