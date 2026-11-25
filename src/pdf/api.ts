/**
 * Contract between portal.js and the separately loaded pdf-tools.js.
 *
 * The two files are cached independently by browsers (GitHub Pages sends max-age=600), so
 * right after a release a new portal.js can meet an old pdf-tools.js. Bump this number
 * whenever the tools' functions change shape; the loader refuses a mismatching bundle.
 */
export const PDF_TOOLS_API = 5;
