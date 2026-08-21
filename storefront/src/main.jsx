import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";

import App from "./App";
import { ShopProvider } from "./lib/shop";

/* The stylesheet is shared with the admin panel, which is plain HTML and loads
   it from /assets/css/app.css. Importing the same file keeps one source of
   truth rather than two copies that drift apart. */
import "../../frontend/assets/css/app.css";

/* Hash routing, so #/shop and #/p/thing keep working and no server rewrite
   rule is needed — the same reason the old storefront used it. Old bookmarks
   and any links you have shared still resolve. */
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <ShopProvider>
        <App />
      </ShopProvider>
    </HashRouter>
  </React.StrictMode>,
);
