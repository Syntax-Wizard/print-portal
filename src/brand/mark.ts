/**
 * The Tombo mark: a printer's registration mark (トンボ) with its cyan, magenta and yellow
 * rings slightly out of register. One SVG string, used for the header, the tab icon and
 * (via scripts/build-site.ts) the install page.
 */
export const BRAND_MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect x=".5" y=".5" width="31" height="31" rx="7.5" fill="#fff" stroke="#d5dbe3"/>' +
  '<g fill="none" stroke-width="2.4" style="mix-blend-mode:multiply">' +
  '<circle cx="14.8" cy="15.2" r="7" stroke="#00a0e9"/>' +
  '<circle cx="17.2" cy="15.4" r="7" stroke="#e4007f"/>' +
  '<circle cx="16" cy="17.3" r="7" stroke="#f5cf00"/>' +
  "</g>" +
  '<path d="M16 4.5v23M4.5 16h23" stroke="#231815" stroke-width="1.6" stroke-linecap="round"/>' +
  "</svg>";

export const BRAND_FAVICON = `data:image/svg+xml,${encodeURIComponent(BRAND_MARK_SVG)}`;

export const BRAND_NAME = "Tombo";
