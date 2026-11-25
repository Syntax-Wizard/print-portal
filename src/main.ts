/**
 * Production entry point, loaded by the bookmarklet into the printer's own page.
 */

import css from "./ui/styles.css?inline";
import { takeover } from "./bootstrap";
import { rememberScriptBase } from "./pdf/loader";

// Must run first, while document.currentScript still points at this script.
rememberScriptBase();
takeover(css);
