import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  table: ({ children }) => (
    <div className="md-table-wrap">
      <table>{children}</table>
    </div>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

/** GitHub-flavoured markdown. Raw HTML is not rendered (react-markdown default), URLs are sanitised. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `markdown ${className}` : 'markdown'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
