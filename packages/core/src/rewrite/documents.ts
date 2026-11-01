import { parsers, type CustomParser } from "@featurevisor/parsers";
import { Document, parseDocument, visit } from "yaml";
import type { Node } from "yaml";

import { lineEndings, renderValues, rewriteFile, yamlOptions } from "./lines";

/**
 * Definitions edited as YAML documents whatever their parser, by convert and by fmt's
 * --simplify, so one set of edits serves every format. A YAML file keeps its comments, and
 * every file keeps the lines an edit does not touch.
 */

/**
 * A file as a document. Aliases are written out in full, since splitting lanes apart can leave
 * an alias without its anchor. `expanded` says whether there were any.
 */
export function load(source: string, parser: CustomParser): { doc: Document; expanded: boolean } {
  if (parser !== parsers.yml) return { doc: new Document(parser.parse(source)), expanded: false };
  const doc = parseDocument(lineEndings(source).text);
  let expanded = false;
  visit(doc, {
    Alias(_, alias) {
      expanded = true;
      const target = alias.resolve(doc);
      return target ? (target.clone() as Node) : visit.REMOVE;
    },
  });
  if (expanded) {
    visit(doc, {
      Node(_, node) {
        if ("anchor" in node) delete (node as { anchor?: string }).anchor;
      },
    });
  }
  return { doc, expanded };
}

/**
 * The document as the file's new text, with the file's own lines where nothing changed, or
 * the whole file as its parser writes it, which `merged` says. YAML keeps its comments either
 * way and JSON has none, but a custom format may lose them. Undefined when the text would not
 * read back as the document.
 */
export function render(
  source: string,
  doc: Document,
  parser: CustomParser,
): { text: string; merged: boolean } | undefined {
  const value = doc.toJS();
  return rewriteFile(source, parser, value, (text) => {
    if (parser !== parsers.yml) return renderValues(parser, parser.parse(text), value);
    const options = yamlOptions(text);
    return { base: parseDocument(text).toString(options), changed: doc.toString(options) };
  });
}
