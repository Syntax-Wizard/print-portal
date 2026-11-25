/**
 * Development entry point (`npm run dev`): renders the app directly, with printer requests
 * proxied to the mock printer so everything stays same-origin like production.
 */

import { render } from "preact";
import "./ui/styles.css";
import { initI18n } from "./i18n";
import { App } from "./ui/App";

void initI18n().then(() => render(<App />, document.getElementById("app")!));
