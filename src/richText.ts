import DOMPurify from "dompurify";
import { marked } from "marked";

/** Render knowledge text as Markdown while keeping embedded HTML inert and local to the result card. */
export function renderRichText(value: string): string {
  const parsed = marked.parse(value, { async: false, breaks: true, gfm: true });
  const sanitized = DOMPurify.sanitize(parsed, {
    FORBID_TAGS: ["style", "img", "svg", "math", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["style"],
  });
  const template = document.createElement("template");
  template.innerHTML = sanitized;
  template.content.querySelectorAll("a").forEach((link) => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  return template.innerHTML;
}
