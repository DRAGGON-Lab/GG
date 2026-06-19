import "katex/dist/katex.min.css";

import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { cx } from "@/ui/class-name";

type AiMarkdownProps = {
  muted?: boolean;
  text: string;
};

const markdownComponents: Components = {
  a: ({ children, href, node: _node, ...props }) => (
    <a
      className="cursor-pointer text-cg-accent underline decoration-cg-border-strong underline-offset-2 hover:decoration-cg-accent"
      href={href}
      rel="noreferrer"
      target="_blank"
      {...props}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="m-0 border-l border-cg-border-strong pl-3 text-cg-muted">
      {children}
    </blockquote>
  ),
  code: ({ children, className, node: _node, ...props }) => (
    <code
      className={cx(
        "rounded-[4px] bg-cg-surface px-[5px] py-px font-mono text-[0.9em] text-cg-fg",
        className,
      )}
      {...props}
    >
      {children}
    </code>
  ),
  // `em` intentionally has no override: italics alone, without a color
  // change mid-sentence.
  // Heading rhythm: a real size scale above the 12px body, and extra space
  // above each heading (margins add to the parent grid gap) so sections
  // group with what follows them, not what precedes.
  h1: ({ children }) => (
    <h2 className="m-0 mt-2 font-serif text-[17px] font-[560] leading-snug tracking-[-0.01em] text-cg-fg first:mt-0">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h3 className="m-0 mt-1.5 font-serif text-[15px] font-[560] leading-snug tracking-[-0.005em] text-cg-fg first:mt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="m-0 mt-1 font-serif text-[13.5px] font-[580] leading-snug text-cg-fg first:mt-0">
      {children}
    </h4>
  ),
  h4: ({ children }) => (
    <h5 className="m-0 mt-1 font-mono text-[10.5px] font-bold uppercase leading-snug tracking-[0.12em] text-cg-muted first:mt-0">
      {children}
    </h5>
  ),
  hr: () => <hr className="m-0 border-0 border-t border-cg-border" />,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  ol: ({ children }) => (
    <ol className="m-0 grid list-decimal gap-1 pl-5">{children}</ol>
  ),
  p: ({ children }) => <p className="m-0">{children}</p>,
  pre: ({ children }) => (
    <pre className="m-0 max-w-full overflow-x-auto rounded-[6px] border border-cg-border bg-cg-surface p-2 font-mono text-[11.5px] leading-[1.45] text-cg-fg [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-cg-fg">{children}</strong>
  ),
  table: ({ children }) => (
    <div className="max-w-full overflow-x-auto rounded-[6px] border border-cg-border">
      <table className="min-w-full border-collapse text-left text-[11.5px]">
        {children}
      </table>
    </div>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-cg-border">{children}</tbody>
  ),
  td: ({ children }) => (
    <td className="border-r border-cg-border px-2 py-1.5 align-top last:border-r-0">
      {children}
    </td>
  ),
  th: ({ children }) => (
    <th className="border-r border-cg-border bg-cg-surface px-2 py-1.5 align-top font-semibold text-cg-fg last:border-r-0">
      {children}
    </th>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-cg-border">{children}</thead>
  ),
  tr: ({ children }) => <tr>{children}</tr>,
  ul: ({ children }) => (
    <ul className="m-0 grid list-disc gap-1 pl-5">{children}</ul>
  ),
};

export function AiMarkdown({ muted = false, text }: AiMarkdownProps) {
  return (
    <div
      className={cx(
        "grid min-w-0 gap-2 break-words text-[12px] leading-[1.5] [&_.katex-display]:my-1.5 [&_.katex]:text-[0.95em]",
        muted ? "text-cg-muted" : "text-cg-fg",
      )}
    >
      <ReactMarkdown
        components={markdownComponents}
        rehypePlugins={[rehypeKatex]}
        remarkPlugins={[remarkGfm, remarkMath]}
        skipHtml
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
