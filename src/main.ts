/**
 * Production entry point, loaded by the bookmarklet into the printer's own page.
 */

import css from "./ui/styles.css?inline";
import { takeover } from "./bootstrap";

takeover(css);
