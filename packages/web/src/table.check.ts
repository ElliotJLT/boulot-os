import { Markdown } from "./Activity.js";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
const md = `| JD requirement | Master CV evidence | Fit |
|---|---|---|
| Lead features concept→production | ZG bullet 1 (RAG tutor) | Direct |
| Stack: TypeScript, React | Ruby/JS/Postgres, not TS | **Gap** |`;
const html = renderToStaticMarkup(h(Markdown, { text: md }));
console.log("renders a <table>:", html.includes("<table"));
console.log("header cells:", (html.match(/<th>/g) || []).length);
console.log("body rows:", (html.match(/<tr>/g) || []).length - 1);
console.log("bold inside cell preserved:", html.includes("<strong>Gap</strong>"));
