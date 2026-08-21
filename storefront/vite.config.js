import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The built shop is written into ../frontend/store and served by FastAPI:
//   /            -> frontend/store/index.html
//   /store/…     -> the hashed JS and CSS
//
// The output is committed to the repo on purpose. It means deploying stays a
// Python-only job — Render's Python runtime has no Node — and the free hosting
// path in docs/DEPLOY.md keeps working. Run `npm run build` before committing.
/* Where the built files sit depends on who serves them, and getting this wrong
   is silent: the page loads and every asset 404s.

     FastAPI serves the shop   → assets live at /store/, output goes into the
                                 Python project (the default)
     Vercel or a CDN serves it → the shop *is* the site root, so assets live at
                                 /, and the output stays in this folder

   vercel.json sets both for you. */
const BASE = process.env.VITE_BASE || "/store/";
const OUT_DIR = process.env.VITE_OUT_DIR || "../frontend/store";

export default defineConfig({
  plugins: [react()],
  base: BASE,
  build: {
    outDir: path.resolve(__dirname, OUT_DIR),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    // `npm run dev` serves the React app; the API still comes from the Python
    // server on 8000, so there is one origin as far as the browser is concerned.
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/media": "http://127.0.0.1:8000",
    },
    fs: {
      // app.css lives outside this folder because the admin panel shares it.
      allow: [path.resolve(__dirname, ".."), __dirname],
    },
  },
});
