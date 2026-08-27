// Minimal, safe markdown-lite → HTML for guide bodies (##, ###, -, 1., **bold**, [text](url)).
export function mdLite(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // WP1: any link to hexwaren.de renders sponsored+nofollow (never a followed keyword link);
  // other external links get noopener; internal links stay plain.
  const link = (txt: string, url: string) => {
    if (/^https?:\/\/(www\.)?hexwaren\.de(\/|$|\?|#)/i.test(url)) return `<a href="${url}" target="_blank" rel="sponsored nofollow noopener">${txt}</a>`;
    if (/^https?:\/\//i.test(url)) return `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`;
    return `<a href="${url}">${txt}</a>`;
  };
  const inline = (t: string) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt, url) => link(txt, url));
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  let html = "", inList = false;
  const close = () => { if (inList) { html += "</ul>\n"; inList = false; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^### /.test(l)) { close(); html += `<h3>${inline(l.slice(4))}</h3>\n`; }
    else if (/^## /.test(l)) { close(); html += `<h2>${inline(l.slice(3))}</h2>\n`; }
    else if (/^\d+\.\s/.test(l)) { if (!inList) { html += "<ul>\n"; inList = true; } html += `<li>${inline(l.replace(/^\d+\.\s/, ""))}</li>\n`; }
    else if (/^-\s/.test(l)) { if (!inList) { html += "<ul>\n"; inList = true; } html += `<li>${inline(l.slice(2))}</li>\n`; }
    else if (l === "") { close(); }
    else { close(); html += `<p>${inline(l)}</p>\n`; }
  }
  close();
  return html;
}
