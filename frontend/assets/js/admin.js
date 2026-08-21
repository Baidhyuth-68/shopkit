/* =========================================================================
   Admin panel.

   Routes (hash based):
     #/            dashboard
     #/products    catalogue; #/products/new and #/products/12 are full-page editors
     #/categories  collections
     #/orders      order list + order drawer
     #/customers   customers and staff
     #/appearance  storefront look, copy and shop rules
     #/dashboard-style  how this panel itself looks
     #/email       mail server, templates and the send log
     #/payments    payment gateways: Stripe, Razorpay, bank, cash
     #/api-keys    API credentials for Postman and other systems
     #/languages   language packs; #/languages/3 edits one pack
     #/promos      discount codes; #/promos/new and #/promos/4 are full-page editors

   Every call here hits /api/admin/*, which requires an admin token.
   ========================================================================= */

const admin = { user: null, categories: [], settings: {} };
const root = () => document.getElementById("root");
const main = () => document.getElementById("admin-main");

const NAV = [
  { href: "#/", label: "Dashboard", group: "Overview" },
  { href: "#/products", label: "Products", group: "Catalogue" },
  { href: "#/categories", label: "Collections", group: "Catalogue" },
  { href: "#/orders", label: "Orders", group: "Selling" },
  { href: "#/promos", label: "Promo codes", group: "Selling" },
  { href: "#/customers", label: "Customers", group: "Selling" },
  { href: "#/appearance", label: "Storefront", group: "Setup" },
  { href: "#/dashboard-style", label: "Dashboard style", group: "Setup" },
  { href: "#/payments", label: "Payments", group: "Setup" },
  { href: "#/api-keys", label: "API keys", group: "Setup" },
  { href: "#/languages", label: "Languages", group: "Setup" },
  { href: "#/email", label: "System email", group: "Setup" },
];

/* ------------------------------------------------------------ shell */
function renderShell() {
  const groups = [];
  NAV.forEach((item) => {
    const last = groups[groups.length - 1];
    if (!last || last.name !== item.group) groups.push({ name: item.group, items: [item] });
    else last.items.push(item);
  });

  root().innerHTML = `
    <div class="admin">
      <aside class="side">
        <div class="brand">
          <span class="brand-mark">${esc(admin.settings.logo_text || "S")}</span>
          <span class="brand-name">${esc(admin.settings.site_name || "Shop")}</span>
        </div>
        <nav class="side-nav" id="side-nav">
          ${groups.map((group) => `
            <div class="side-label">${esc(group.name)}</div>
            ${group.items.map((item) => `<a href="${item.href}">${esc(item.label)}</a>`).join("")}
          `).join("")}
        </nav>
        <div class="side-foot">
          <div>${esc(admin.user.full_name || admin.user.email)}</div>
          <div class="row" style="margin-top:10px;gap:6px">
            <a class="btn btn-ghost btn-sm" href="/" style="color:var(--paper);border-color:rgba(243,244,239,.3)">View store</a>
            <button class="btn btn-ghost btn-sm" id="sign-out" style="color:var(--paper);border-color:rgba(243,244,239,.3)">Sign out</button>
          </div>
        </div>
      </aside>
      <div class="admin-main" id="admin-main"></div>
    </div>`;

  document.getElementById("sign-out").addEventListener("click", () => {
    Auth.clear();
    location.reload();
  });
}

function markNav() {
  const current = location.hash.split("?")[0] || "#/";
  document.querySelectorAll(".side-nav a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === current));
}

function pageHead(title, subtitle, actionsHtml = "") {
  return `<div class="admin-head">
    <div><div class="eyebrow">${esc(subtitle)}</div><h1 style="font-size:1.9rem;margin-top:6px">${esc(title)}</h1></div>
    <div class="row">${actionsHtml}</div>
  </div>`;
}

/* ----------------------------------------------------------- router */
async function route() {
  const [path, queryString] = (location.hash.slice(1) || "/").split("?");
  const params = Object.fromEntries(new URLSearchParams(queryString || ""));
  const parts = path.split("/").filter(Boolean);
  markNav();
  main().innerHTML = `<div class="loading">Loading…</div>`;

  try {
    switch (parts[0]) {
      case undefined: return await pageDashboard();
      case "products": return parts[1] ? await pageProductEdit(parts[1]) : await pageProducts(params);
      case "categories": return await pageCategories();
      case "orders": return await pageOrders(params);
      case "customers": return await pageCustomers(params);
      case "appearance": return await pageAppearance();
      case "dashboard-style": return await pageDashboardStyle();
      case "email": return await pageEmail(parts[1]);
      case "payments": return await pagePayments();
      case "api-keys": return await pageApiKeys();
      case "languages": return await pageLanguages(parts[1]);
      case "promos": return parts[1] ? await pagePromoEdit(parts[1]) : await pagePromos();
      default: main().innerHTML = `<div class="empty"><h3>No such page</h3></div>`;
    }
  } catch (error) {
    main().innerHTML = `<div class="empty"><h3>That did not load</h3><p class="muted">${esc(error.message)}</p></div>`;
  }
}

/* -------------------------------------------------------- dashboard */
async function pageDashboard() {
  const data = await API.dashboard();
  const peak = Math.max(...data.revenue_series.map((d) => d.value), 1);

  main().innerHTML = `
    ${pageHead("Dashboard", "How the shop is doing", `<a class="btn btn-accent btn-sm" href="#/products">Add a product</a>`)}

    <div class="stat-grid">
      ${statCard("Revenue, all time", money(data.revenue_total), `${money(data.revenue_30d)} in the last 30 days`)}
      ${statCard("Orders", data.orders_total, `${data.orders_pending} waiting to be processed`)}
      ${statCard("Customers", data.customers_total, "registered accounts")}
      ${statCard("Products", data.products_total, `${data.products_out_of_stock} out of stock`)}
    </div>

    <div class="fieldset" style="margin-top:16px">
      <h3>Revenue, last 14 days</h3>
      <p class="hint">Counts orders marked paid, shipped or delivered.</p>
      <div class="chart">
        ${data.revenue_series.map((point) => `
          <div class="chart-bar" data-label="${point.date} · ${money(point.value)}" title="${point.date}">
            <i style="height:${Math.max(2, (point.value / peak) * 100)}%"></i>
          </div>`).join("")}
      </div>
    </div>

    <div class="grid-2" style="margin-top:16px;align-items:start">
      <div class="fieldset">
        <h3>Best sellers</h3>
        <p class="hint">By revenue, all time.</p>
        ${data.top_products.length ? data.top_products.map((p) => `
          <div class="order-row">
            <div>${esc(p.name)}<div class="cell-sub">${p.units} sold</div></div>
            <span class="price">${money(p.revenue)}</span>
          </div>`).join("") : `<p class="muted">Nothing sold yet.</p>`}
      </div>

      <div class="fieldset">
        <h3>Running low</h3>
        <p class="hint">At or below your low-stock threshold.</p>
        ${data.low_stock.length ? data.low_stock.map((p) => `
          <div class="order-row">
            <div>${esc(p.name)}</div>
            <span class="badge ${p.stock === 0 ? "badge-cancelled" : "badge-pending"}">${p.stock} left</span>
          </div>`).join("") : `<p class="muted">Every product has healthy stock.</p>`}
      </div>
    </div>

    <div class="fieldset" style="margin-top:16px">
      <div class="row-between" style="margin-bottom:12px">
        <h3>Latest orders</h3>
        <a class="btn btn-quiet" href="#/orders">See all</a>
      </div>
      ${data.recent_orders.length ? data.recent_orders.map((order) => `
        <div class="order-row">
          <div>
            <a class="num" style="font-weight:600" href="#/orders?open=${order.id}">${esc(order.order_number)}</a>
            <div class="cell-sub">${esc(order.customer_name)} · ${formatDate(order.created_at)}</div>
          </div>
          <div class="row">${statusBadge(order.status)}<span class="price">${money(order.total)}</span></div>
        </div>`).join("") : `<p class="muted">No orders yet.</p>`}
    </div>`;
}

function statCard(label, value, note) {
  return `<div class="stat"><div class="label">${esc(label)}</div>
    <div class="value">${value}</div><div class="delta">${esc(note)}</div></div>`;
}

/* --------------------------------------------------------- products */
async function pageProducts(params) {
  const query = {
    q: params.q || "",
    category_id: params.category_id || "",
    status_filter: params.status_filter || "",
    page: params.page || 1,
    page_size: 20,
  };
  const data = await API.adminProducts(query);

  main().innerHTML = `
    ${pageHead("Products", `${data.total} in the catalogue`, `<button class="btn btn-accent btn-sm" id="new-product">New product</button>`)}

    <div class="toolbar">
      <input class="search" id="q" type="search" placeholder="Search name or code" value="${esc(query.q)}">
      <select id="category_id" style="max-width:180px">
        <option value="">All collections</option>
        ${admin.categories.map((c) => `<option value="${c.id}" ${String(query.category_id) === String(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
      </select>
      <select id="status_filter" style="max-width:180px">
        <option value="">Any status</option>
        <option value="active" ${query.status_filter === "active" ? "selected" : ""}>Live</option>
        <option value="hidden" ${query.status_filter === "hidden" ? "selected" : ""}>Hidden</option>
        <option value="out_of_stock" ${query.status_filter === "out_of_stock" ? "selected" : ""}>Out of stock</option>
      </select>
    </div>

    <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th>Product</th><th>Collection</th><th class="right">Price</th>
          <th class="right">Stock</th><th>Status</th><th></th>
        </tr></thead>
        <tbody>
          ${data.items.length ? data.items.map((p) => `
            <tr>
              <td>
                <div class="cell-main">
                  ${imageTile(p.image_url, p.name, "cell-thumb")}
                  <div><div style="font-weight:700">${esc(p.name)}</div>
                    <div class="cell-sub">${esc(p.sku || p.slug)}</div></div>
                </div>
              </td>
              <td>${esc(p.category_name || "—")}</td>
              <td class="right num">${money(p.price)}</td>
              <td class="right num">${p.stock}</td>
              <td>${p.is_active ? `<span class="badge badge-live">Live</span>` : `<span class="badge badge-hidden">Hidden</span>`}</td>
              <td class="right">
                <button class="btn btn-quiet" data-edit="${p.id}">Edit</button>
                <button class="btn btn-quiet" data-delete="${p.id}" style="color:var(--bad)">Delete</button>
              </td>
            </tr>`).join("")
            : `<tr><td colspan="6"><div class="empty" style="border:0"><h3>No products match</h3>
                 <p class="muted">Clear the filters, or add your first product.</p></div></td></tr>`}
        </tbody>
      </table>
    </div>
    ${data.pages > 1 ? adminPager(data, params, "#/products") : ""}`;

  const push = (changes) => {
    const search = new URLSearchParams({ ...params, ...changes, page: changes.page || 1 });
    [...search.entries()].forEach(([k, v]) => { if (!v) search.delete(k); });
    location.hash = `#/products?${search}`;
  };
  let timer;
  document.getElementById("q").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => push({ q: e.target.value }), 350);
  });
  document.getElementById("category_id").addEventListener("change", (e) => push({ category_id: e.target.value }));
  document.getElementById("status_filter").addEventListener("change", (e) => push({ status_filter: e.target.value }));
  document.getElementById("new-product").addEventListener("click", () => { location.hash = "#/products/new"; });
  document.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => { location.hash = `#/products/${b.dataset.edit}`; }));
  document.querySelectorAll("[data-delete]").forEach((b) =>
    b.addEventListener("click", () => confirmDelete(b.dataset.delete)));
  document.querySelectorAll("[data-page]").forEach((b) =>
    b.addEventListener("click", () => push({ page: b.dataset.page })));
}

function adminPager(data, params, base) {
  return `<div class="pager">
    <button class="btn btn-ghost btn-sm" data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>Previous</button>
    <span>${data.page} / ${data.pages}</span>
    <button class="btn btn-ghost btn-sm" data-page="${data.page + 1}" ${data.page >= data.pages ? "disabled" : ""}>Next</button>
  </div>`;
}

function confirmDelete(id) {
  openModal(`
    <h2 style="font-size:1.3rem">Delete this product?</h2>
    <p class="muted">If it appears in past orders it will be hidden from the shop instead, so those orders stay readable.</p>
    <div class="row" style="justify-content:flex-end;margin-top:20px">
      <button class="btn btn-ghost" onclick="closeModal()">Keep it</button>
      <button class="btn btn-danger" id="confirm-delete">Delete product</button>
    </div>`);
  document.getElementById("confirm-delete").addEventListener("click", async () => {
    try {
      await API.deleteProduct(id);
      closeModal();
      toast("Product deleted");
      route();
    } catch (error) { toast(error.message, "bad"); }
  });
}

/* Products open on their own page rather than in a drawer — there is enough
   in this form that a cramped panel got in the way.
     #/products/new   a blank one
     #/products/12    an existing one
   Saving returns to the list. */
async function pageProductEdit(productId) {
  const isNew = productId === "new";
  let product = null;

  if (!admin.categories.length) {
    try { admin.categories = await API.adminCategories(); } catch { admin.categories = []; }
  }
  if (!isNew) {
    try {
      product = await API.adminProduct(productId);
    } catch (error) {
      main().innerHTML = `<div class="empty"><h3>That product is not here</h3>
        <p class="muted">${esc(error.message)}</p>
        <a class="btn btn-accent" href="#/products">Back to products</a></div>`;
      return;
    }
  }

  const p = product || {
    name: "", sku: "", short_description: "", description: "", price: 0, compare_at_price: null,
    stock: 0, image_url: "", gallery: [], category_id: null, is_active: true, is_featured: false,
  };

  main().innerHTML = `
    ${pageHead(
      product ? product.name : "Add a product",
      product ? "Editing a product" : "New product",
      `<a class="btn btn-ghost btn-sm" href="#/products">Back to products</a>` +
      (product ? `<a class="btn btn-ghost btn-sm" href="/#/p/${esc(product.slug)}" target="_blank">View in shop ↗</a>` : ""),
    )}
    <div class="edit-page">
      <form id="product-form">
        <div class="fieldset">
          <h3>The basics</h3>
          <p class="hint">Name and price are all that is required. The web address is generated from the name.</p>
          <div class="stack">
            <label class="field"><span>Name</span><input name="name" required value="${esc(p.name)}"></label>
            <label class="field"><span>One-line summary</span>
              <input name="short_description" maxlength="300" value="${esc(p.short_description)}">
              <div class="hint-inline">Shown under the name in the product grid.</div></label>
            <label class="field"><span>Full description</span><textarea name="description">${esc(p.description)}</textarea></label>
            <div class="grid-2">
              <label class="field"><span>Collection</span>
                <select name="category_id">
                  <option value="">No collection</option>
                  ${admin.categories.map((c) => `<option value="${c.id}" ${p.category_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
                </select></label>
              <label class="field"><span>Item code</span><input name="sku" value="${esc(p.sku)}"></label>
            </div>
          </div>
        </div>

        <div class="fieldset">
          <h3>Price and stock</h3>
          <p class="hint">Stock drops automatically when an order is placed and returns if it is cancelled.</p>
          <div class="grid-3">
            <label class="field"><span>Price</span><input type="number" name="price" step="0.01" min="0" required value="${p.price}"></label>
            <label class="field"><span>Was (optional)</span><input type="number" name="compare_at_price" step="0.01" min="0" value="${p.compare_at_price ?? ""}">
              <div class="hint-inline">Shown struck through.</div></label>
            <label class="field"><span>Stock</span><input type="number" name="stock" min="0" required value="${p.stock}"></label>
          </div>
        </div>

        <div class="fieldset">
          <h3>Photos</h3>
          <p class="hint">Upload a file or paste a link. The first photo is the one shown in the grid.</p>
          <div class="stack">
            <div class="field">
              <label class="label" for="image_url">Main photo</label>
              <div class="upload-row">
                <input name="image_url" id="image_url" class="grow" placeholder="/media/… or https://…" value="${esc(p.image_url)}">
                <label class="btn btn-ghost btn-sm" style="margin:0">Upload
                  <input type="file" accept="image/*" id="upload-main" hidden></label>
              </div>
            </div>
            <label class="field"><span>More photos</span>
              <textarea name="gallery" placeholder="One link per line">${esc((p.gallery || []).join("\n"))}</textarea></label>
            <div id="preview" class="row" style="gap:10px;flex-wrap:wrap"></div>
          </div>
        </div>

        <div class="fieldset">
          <h3>Visibility</h3>
          <div class="stack">
            <label class="check"><input type="checkbox" name="is_active" ${p.is_active ? "checked" : ""}>
              <span><strong>Live in the shop</strong><br><span class="muted">Uncheck to work on it privately.</span></span></label>
            <label class="check"><input type="checkbox" name="is_featured" ${p.is_featured ? "checked" : ""}>
              <span><strong>Feature on the home page</strong><br><span class="muted">Featured products fill the shelf on the front page.</span></span></label>
          </div>
        </div>
        <div class="form-error hidden" id="product-error"></div>

        <div class="edit-actions">
          <button class="btn btn-accent" id="save-product" type="button">${product ? "Save changes" : "Add product"}</button>
          <a class="btn btn-ghost" href="#/products">Cancel</a>
          ${product ? `<button class="btn btn-quiet" id="delete-product" type="button" style="margin-left:auto">Delete</button>` : ""}
        </div>
      </form>
    </div>`;

  const refreshPreview = () => {
    const urls = [document.getElementById("image_url").value,
      ...main().querySelector("[name=gallery]").value.split("\n")].map((u) => u.trim()).filter(Boolean);
    document.getElementById("preview").innerHTML = urls
      .map((u) => `<div class="cell-thumb" style="width:56px;height:56px"><img src="${esc(u)}" alt=""></div>`).join("");
  };
  main().querySelector("[name=gallery]").addEventListener("input", refreshPreview);
  document.getElementById("image_url").addEventListener("input", refreshPreview);
  refreshPreview();

  document.getElementById("upload-main").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const { url } = await API.upload(file);
      document.getElementById("image_url").value = url;
      refreshPreview();
      toast("Photo uploaded");
    } catch (error) { toast(error.message, "bad"); }
  });

  const deleteButton = document.getElementById("delete-product");
  if (deleteButton) {
    deleteButton.addEventListener("click", async () => {
      if (!confirm(`Delete “${product.name}”? This cannot be undone.`)) return;
      try {
        await API.deleteProduct(product.id);
        toast("Product deleted");
        location.hash = "#/products";
      } catch (error) { toast(error.message, "bad"); }
    });
  }

  document.getElementById("save-product").addEventListener("click", async () => {
    const form = document.getElementById("product-form");
    if (!form.reportValidity()) return;
    const raw = Object.fromEntries(new FormData(form));
    const body = {
      name: raw.name,
      sku: raw.sku,
      short_description: raw.short_description,
      description: raw.description,
      price: parseFloat(raw.price || 0),
      compare_at_price: raw.compare_at_price === "" ? null : parseFloat(raw.compare_at_price),
      stock: parseInt(raw.stock || 0, 10),
      image_url: raw.image_url,
      gallery: (raw.gallery || "").split("\n").map((s) => s.trim()).filter(Boolean),
      category_id: raw.category_id ? parseInt(raw.category_id, 10) : null,
      is_active: form.is_active.checked,
      is_featured: form.is_featured.checked,
    };
    try {
      if (product) await API.updateProduct(product.id, body);
      else await API.createProduct(body);
      toast(product ? "Changes saved" : "Product added");
      location.hash = "#/products";   // straight back to the list, with it in place
    } catch (error) {
      const node = document.getElementById("product-error");
      node.textContent = error.message;
      node.classList.remove("hidden");
    }
  });
}

function closeDrawer() {
  document.querySelectorAll(".drawer, .drawer-backdrop").forEach((n) => n.remove());
}

/* ------------------------------------------------------- collections */
async function pageCategories() {
  const categories = await API.adminCategories();
  admin.categories = categories;

  main().innerHTML = `
    ${pageHead("Collections", "Group products so people can find them", `<button class="btn btn-accent btn-sm" id="new-cat">New collection</button>`)}
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Name</th><th>Description</th><th class="right">Products</th><th class="right">Order</th><th></th></tr></thead>
        <tbody>
          ${categories.length ? categories.map((c) => `
            <tr>
              <td><div style="font-weight:700">${esc(c.name)}</div><div class="cell-sub">/${esc(c.slug)}</div></td>
              <td class="muted">${esc(c.description || "—")}</td>
              <td class="right num">${c.product_count}</td>
              <td class="right num">${c.sort_order}</td>
              <td class="right">
                <button class="btn btn-quiet" data-edit="${c.id}">Edit</button>
                <button class="btn btn-quiet" data-del="${c.id}" style="color:var(--bad)">Delete</button>
              </td>
            </tr>`).join("")
            : `<tr><td colspan="5"><div class="empty" style="border:0"><h3>No collections yet</h3>
                <p class="muted">Collections are optional, but they make a bigger catalogue browsable.</p></div></td></tr>`}
        </tbody>
      </table>
    </div>`;

  document.getElementById("new-cat").addEventListener("click", () => categoryModal(null));
  document.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => categoryModal(categories.find((c) => c.id === +b.dataset.edit))));
  document.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      openModal(`<h2 style="font-size:1.25rem">Delete this collection?</h2>
        <p class="muted">Its products stay in the shop, without a collection.</p>
        <div class="row" style="justify-content:flex-end;margin-top:20px">
          <button class="btn btn-ghost" onclick="closeModal()">Keep it</button>
          <button class="btn btn-danger" id="yes">Delete</button></div>`);
      document.getElementById("yes").addEventListener("click", async () => {
        await API.deleteCategory(b.dataset.del);
        closeModal(); toast("Collection deleted"); route();
      });
    }));
}

function categoryModal(category) {
  const c = category || { name: "", description: "", sort_order: 0, is_active: true };
  openModal(`
    <h2 style="font-size:1.3rem;margin-bottom:16px">${category ? "Edit collection" : "New collection"}</h2>
    <form id="cat-form" class="stack">
      <label class="field"><span>Name</span><input name="name" required value="${esc(c.name)}"></label>
      <label class="field"><span>Description</span><textarea name="description" style="min-height:80px">${esc(c.description)}</textarea></label>
      <label class="field"><span>Position in menus</span><input type="number" name="sort_order" value="${c.sort_order}"></label>
      <label class="check"><input type="checkbox" name="is_active" ${c.is_active ? "checked" : ""}><span>Show in the shop</span></label>
      <div class="form-error hidden" id="cat-error"></div>
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-accent" type="submit">${category ? "Save" : "Create"}</button>
      </div>
    </form>`);

  document.getElementById("cat-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.target));
    const body = {
      name: raw.name,
      description: raw.description,
      sort_order: parseInt(raw.sort_order || 0, 10),
      is_active: event.target.is_active.checked,
    };
    try {
      if (category) await API.updateCategory(category.id, body);
      else await API.createCategory(body);
      closeModal(); toast("Collection saved"); route();
    } catch (error) {
      const node = document.getElementById("cat-error");
      node.textContent = error.message; node.classList.remove("hidden");
    }
  });
}

/* ------------------------------------------------------------ orders */
async function pageOrders(params) {
  const data = await API.adminOrders({
    q: params.q || "", order_status: params.order_status || "",
    page: params.page || 1, page_size: 20,
  });

  main().innerHTML = `
    ${pageHead("Orders", `${data.total} placed so far`)}
    <div class="toolbar">
      <input class="search" id="q" type="search" placeholder="Order number, name or email" value="${esc(params.q || "")}">
      <select id="order_status" style="max-width:180px">
        <option value="">Any status</option>
        ${["pending", "paid", "shipped", "delivered", "cancelled"].map((s) =>
          `<option value="${s}" ${params.order_status === s ? "selected" : ""}>${s}</option>`).join("")}
      </select>
    </div>

    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Order</th><th>Customer</th><th>Placed</th><th class="right">Total</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${data.items.length ? data.items.map((o) => `
            <tr>
              <td class="num" style="font-weight:600">${esc(o.order_number)}</td>
              <td>${esc(o.customer_name)}<div class="cell-sub">${esc(o.customer_email)}</div></td>
              <td>${formatDate(o.created_at)}</td>
              <td class="right num">${money(o.total)}</td>
              <td>${statusBadge(o.status)}</td>
              <td class="right"><button class="btn btn-quiet" data-open="${o.id}">Open</button></td>
            </tr>`).join("")
            : `<tr><td colspan="6"><div class="empty" style="border:0"><h3>No orders match</h3></div></td></tr>`}
        </tbody>
      </table>
    </div>
    ${data.pages > 1 ? adminPager(data, params, "#/orders") : ""}`;

  const push = (changes) => {
    const search = new URLSearchParams({ ...params, ...changes, page: changes.page || 1 });
    [...search.entries()].forEach(([k, v]) => { if (!v) search.delete(k); });
    location.hash = `#/orders?${search}`;
  };
  let timer;
  document.getElementById("q").addEventListener("input", (e) => {
    clearTimeout(timer); timer = setTimeout(() => push({ q: e.target.value }), 350);
  });
  document.getElementById("order_status").addEventListener("change", (e) => push({ order_status: e.target.value }));
  document.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", () => orderDrawer(b.dataset.open)));
  document.querySelectorAll("[data-page]").forEach((b) =>
    b.addEventListener("click", () => push({ page: b.dataset.page })));

  if (params.open) orderDrawer(params.open);
}

async function orderDrawer(orderId) {
  const order = await API.adminOrder(orderId);

  const backdrop = document.createElement("div");
  backdrop.className = "drawer-backdrop";
  backdrop.addEventListener("click", closeDrawer);

  const drawer = document.createElement("aside");
  drawer.className = "drawer";
  drawer.innerHTML = `
    <div class="drawer-head">
      <div><div class="eyebrow">${formatDate(order.created_at)}</div>
        <h2 class="num" style="font-size:1.2rem">${esc(order.order_number)}</h2></div>
      <button class="btn btn-quiet" id="close-drawer">Close</button>
    </div>
    <div class="drawer-body">
      <div class="fieldset">
        <h3>Status</h3>
        <p class="hint">Cancelling puts the reserved stock back on the shelf.</p>
        <div class="row">
          <select id="status" class="grow">
            ${["pending", "paid", "shipped", "delivered", "cancelled"].map((s) =>
              `<option value="${s}" ${order.status === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
          <button class="btn btn-ghost btn-sm" id="save-status">Update</button>
        </div>
      </div>

      <div class="fieldset">
        <h3>Items</h3>
        ${order.items.map((item) => `
          <div class="order-row">
            <div class="cell-main">
              ${imageTile(item.image_url, item.product_name, "cell-thumb")}
              <div>${esc(item.product_name)}<div class="cell-sub">${money(item.unit_price)} × ${item.quantity}</div></div>
            </div>
            <span class="price">${money(item.line_total)}</span>
          </div>`).join("")}
        <hr class="receipt-rule">
        <div class="order-row"><span class="muted">Subtotal</span><span class="num">${money(order.subtotal)}</span></div>
        <div class="order-row"><span class="muted">Delivery</span><span class="num">${money(order.shipping_fee)}</span></div>
        ${order.tax ? `<div class="order-row"><span class="muted">Tax</span><span class="num">${money(order.tax)}</span></div>` : ""}
        <div class="order-row"><strong>Total</strong><strong class="num">${money(order.total)}</strong></div>
      </div>

      <div class="fieldset">
        <h3>Deliver to</h3>
        <p style="margin:0">
          ${esc(order.customer_name)}<br>${esc(order.customer_email)}<br>${esc(order.phone || "")}<br>
          ${esc(order.address_line)}<br>${esc(order.city)} ${esc(order.postal_code)}<br>${esc(order.country)}
        </p>
        <div class="cell-sub" style="margin-top:12px">Paying by ${esc(order.payment_method.replace("_", " "))}</div>
        ${order.note ? `<hr class="receipt-rule"><div class="label">Customer note</div><p style="margin:0">${esc(order.note)}</p>` : ""}
      </div>
    </div>`;

  document.body.append(backdrop, drawer);
  document.getElementById("close-drawer").addEventListener("click", closeDrawer);
  document.getElementById("save-status").addEventListener("click", async () => {
    try {
      await API.setOrderStatus(order.id, document.getElementById("status").value);
      closeDrawer(); toast("Order updated"); route();
    } catch (error) { toast(error.message, "bad"); }
  });
}

/* --------------------------------------------------------- customers */
async function pageCustomers(params) {
  const data = await API.adminUsers({
    q: params.q || "", role: params.role || "", page: params.page || 1, page_size: 20,
  });

  main().innerHTML = `
    ${pageHead("Customers", `${data.total} account${data.total === 1 ? "" : "s"}`,
      `<button class="btn btn-accent btn-sm" id="new-user">Add a person</button>`)}
    <div class="toolbar">
      <input class="search" id="q" type="search" placeholder="Search name or email" value="${esc(params.q || "")}">
      <select id="role" style="max-width:180px">
        <option value="">Everyone</option>
        <option value="customer" ${params.role === "customer" ? "selected" : ""}>Customers</option>
        <option value="admin" ${params.role === "admin" ? "selected" : ""}>Admins</option>
      </select>
    </div>

    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Person</th><th>Role</th><th>Joined</th><th>Access</th><th></th></tr></thead>
        <tbody>
          ${data.items.map((u) => `
            <tr>
              <td><div style="font-weight:700">${esc(u.full_name || "—")}</div><div class="cell-sub">${esc(u.email)}</div></td>
              <td>${u.role === "admin" ? `<span class="badge badge-delivered">admin</span>` : `<span class="badge">customer</span>`}</td>
              <td>${formatDate(u.created_at)}</td>
              <td>${u.is_active ? `<span class="badge badge-live">Active</span>` : `<span class="badge badge-cancelled">Disabled</span>`}</td>
              <td class="right">
                <button class="btn btn-quiet" data-edit="${u.id}">Edit</button>
                <button class="btn btn-quiet" data-del="${u.id}" style="color:var(--bad)">Delete</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${data.pages > 1 ? adminPager(data, params, "#/customers") : ""}`;

  const push = (changes) => {
    const search = new URLSearchParams({ ...params, ...changes, page: changes.page || 1 });
    [...search.entries()].forEach(([k, v]) => { if (!v) search.delete(k); });
    location.hash = `#/customers?${search}`;
  };
  let timer;
  document.getElementById("q").addEventListener("input", (e) => {
    clearTimeout(timer); timer = setTimeout(() => push({ q: e.target.value }), 350);
  });
  document.getElementById("role").addEventListener("change", (e) => push({ role: e.target.value }));
  document.getElementById("new-user").addEventListener("click", () => userModal(null));
  document.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => userModal(data.items.find((u) => u.id === +b.dataset.edit))));
  document.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      openModal(`<h2 style="font-size:1.25rem">Delete this account?</h2>
        <p class="muted">Their past orders stay in your records, without a linked account.</p>
        <div class="row" style="justify-content:flex-end;margin-top:20px">
          <button class="btn btn-ghost" onclick="closeModal()">Keep it</button>
          <button class="btn btn-danger" id="yes">Delete account</button></div>`);
      document.getElementById("yes").addEventListener("click", async () => {
        try { await API.deleteUser(b.dataset.del); closeModal(); toast("Account deleted"); route(); }
        catch (error) { toast(error.message, "bad"); }
      });
    }));
  document.querySelectorAll("[data-page]").forEach((b) =>
    b.addEventListener("click", () => push({ page: b.dataset.page })));
}

function userModal(user) {
  openModal(`
    <h2 style="font-size:1.3rem;margin-bottom:16px">${user ? "Edit person" : "Add a person"}</h2>
    <form id="user-form" class="stack">
      ${user ? `<div class="panel" style="padding:12px 14px"><div class="cell-sub">${esc(user.email)}</div></div>`
        : `<label class="field"><span>Email</span><input type="email" name="email" required></label>`}
      <label class="field"><span>Full name</span><input name="full_name" value="${esc(user ? user.full_name : "")}"></label>
      <label class="field"><span>Role</span>
        <select name="role">
          <option value="customer" ${user && user.role === "customer" ? "selected" : ""}>Customer — can shop and see their own orders</option>
          <option value="admin" ${user && user.role === "admin" ? "selected" : ""}>Admin — full access to this panel</option>
        </select></label>
      <label class="field"><span>${user ? "New password (leave blank to keep)" : "Password"}</span>
        <input type="password" name="password" ${user ? "" : "required"} minlength="8"></label>
      ${user ? `<label class="check"><input type="checkbox" name="is_active" ${user.is_active ? "checked" : ""}>
        <span>Account is active</span></label>` : ""}
      <div class="form-error hidden" id="user-error"></div>
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-accent" type="submit">${user ? "Save" : "Create account"}</button>
      </div>
    </form>`);

  document.getElementById("user-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.target));
    const node = document.getElementById("user-error");
    try {
      if (user) {
        const body = { full_name: raw.full_name, role: raw.role, is_active: event.target.is_active.checked };
        if (raw.password) body.password = raw.password;
        await API.updateUser(user.id, body);
      } else {
        await API.createUser({ email: raw.email, password: raw.password, full_name: raw.full_name, role: raw.role });
      }
      closeModal(); toast("Account saved"); route();
    } catch (error) {
      node.textContent = error.message; node.classList.remove("hidden");
    }
  });
}

/* -------------------------------------------------------- appearance */
const SETTING_GROUPS = [
  {
    title: "Identity", hint: "The name and mark people see in the header, footer and browser tab.",
    fields: [
      ["site_name", "Shop name", "text"],
      ["tagline", "Tagline", "text"],
      ["logo_text", "Logo initials", "text"],
      ["logo_image", "Logo image link", "image"],
      ["contact_email", "Contact email", "text"],
      ["contact_phone", "Contact phone", "text"],
      ["shop_url", "Public web address", "text"],
    ],
  },
  {
    title: "Shop colours", hint: "These style the storefront only. The dashboard has its own set, under Dashboard style.",
    fields: [
      ["color_ink", "Text and buttons", "color"],
      ["color_accent", "Accent", "color"],
      ["color_paper", "Background", "color"],
      ["corner_radius", "Corner roundness (px)", "number"],
    ],
  },
  {
    title: "Shop type", hint: "Headings and body text for the storefront. Reload the shop tab after saving to see the change.",
    fields: [
      ["font_store_display", "Headings", "font"],
      ["font_store_body", "Body text", "font"],
    ],
  },
  {
    title: "Home page", hint: "The words on the front page.",
    fields: [
      ["announcement", "Announcement bar", "text"],
      ["hero_title", "Headline", "textarea"],
      ["hero_subtitle", "Sub-headline", "textarea"],
      ["hero_cta", "Button label", "text"],
      ["hero_image", "Hero image link", "image"],
      ["about_title", "About heading", "text"],
      ["about_text", "About paragraph", "textarea"],
      ["footer_text", "Footer line", "text"],
    ],
  },
  {
    title: "Selling rules", hint: "These drive the totals customers are charged, so the server uses them too.",
    fields: [
      ["currency_symbol", "Currency symbol", "text"],
      ["currency_code", "Currency code", "text"],
      ["shipping_flat_rate", "Delivery charge", "number"],
      ["free_shipping_threshold", "Free delivery over", "number"],
      ["tax_percent", "Tax %", "number"],
      ["low_stock_threshold", "Warn when stock reaches", "number"],
      ["payment_methods", "Payment methods (comma separated)", "text"],
      ["allow_registration", "Allow new sign-ups", "toggle"],
    ],
  },
];

/* Admin → Dashboard style. Only this panel. Kept apart from the shop so your
   brand colours do not have to be the ones you stare at all day. */
const ADMIN_STYLE_GROUPS = [
  {
    title: "Dashboard colours", hint: "Applied to this panel as soon as you save. The storefront is untouched.",
    fields: [
      ["admin_color_ink", "Text and buttons", "color"],
      ["admin_color_accent", "Accent", "color"],
      ["admin_color_paper", "Background", "color"],
      ["admin_corner_radius", "Corner roundness (px)", "number"],
    ],
  },
  {
    title: "Dashboard type", hint: "Inter is the default because it was drawn for dense screen interfaces and holds up in a table of numbers.",
    fields: [
      ["font_admin_display", "Headings", "font"],
      ["font_admin_body", "Body text", "font"],
    ],
  },
];

async function pageDashboardStyle() {
  const values = await API.adminSettings();
  admin.settings = values;

  main().innerHTML = `
    ${pageHead("Dashboard style", "How this panel looks",
      `<button class="btn btn-ghost btn-sm" id="reset-admin-style">Match the shop</button>`)}

    <p class="hint" style="max-width:70ch;margin-bottom:18px">
      These settings apply to the dashboard only. Nothing here changes what a
      customer sees — that is under Storefront.
    </p>

    <form id="admin-style-form">
      ${ADMIN_STYLE_GROUPS.map((group) => `
        <div class="fieldset">
          <h3>${esc(group.title)}</h3>
          <p class="hint">${esc(group.hint)}</p>
          <div class="grid-2">
            ${group.fields.map(([key, label, type]) => settingField(key, label, type, values[key] ?? "")).join("")}
          </div>
        </div>`).join("")}
      <div class="row" style="margin-top:18px;position:sticky;bottom:16px">
        <button class="btn btn-accent" type="submit">Save dashboard style</button>
      </div>
    </form>`;

  wireStylePreview(values, "admin");

  document.getElementById("reset-admin-style").addEventListener("click", async () => {
    if (!confirm("Copy the shop's colours and fonts over the dashboard's?")) return;
    try {
      const saved = await API.saveSettings({
        admin_color_ink: values.color_ink,
        admin_color_accent: values.color_accent,
        admin_color_paper: values.color_paper,
        admin_corner_radius: values.corner_radius,
        font_admin_display: values.font_store_display,
        font_admin_body: values.font_store_body,
      });
      admin.settings = saved;
      applyTheme(saved, "admin");
      toast("Dashboard now matches the shop");
      pageDashboardStyle();
    } catch (error) { toast(error.message, "bad"); }
  });

  document.getElementById("admin-style-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.target));
    try {
      const saved = await API.saveSettings(raw);
      admin.settings = saved;
      Site.values = saved;
      applyTheme(saved, "admin");
      renderShell();
      markNav();
      toast("Dashboard style saved");
      route();
    } catch (error) { toast(error.message, "bad"); }
  });
}

/** Colour and font previews, shared by both style pages. `scope` decides
 *  whether a change is previewed on this page or only inside its own field —
 *  shop settings must not repaint the dashboard. */
function wireStylePreview(values, scope) {
  main().querySelectorAll("input[type=color]").forEach((input) =>
    input.addEventListener("input", () => {
      if (scope === "admin") applyTheme({ ...values, [input.name]: input.value }, "admin");
    }));

  main().querySelectorAll(".font-select").forEach((select) =>
    select.addEventListener("change", () => {
      select.style.fontFamily = fontStack(select.value);
      loadGoogleFonts([select.value]);
      if (scope === "admin") {
        applyFonts({ ...values, [select.name]: select.value }, "admin");
      }
    }));
}

async function pageAppearance() {
  const values = await API.adminSettings();
  admin.settings = values;

  main().innerHTML = `
    ${pageHead("Storefront", "Everything the customer sees", `<a class="btn btn-ghost btn-sm" href="/" target="_blank">Open the shop</a>`)}
    <form id="settings-form">
      ${SETTING_GROUPS.map((group) => `
        <div class="fieldset">
          <h3>${esc(group.title)}</h3>
          <p class="hint">${esc(group.hint)}</p>
          <div class="grid-2">
            ${group.fields.map(([key, label, type]) => settingField(key, label, type, values[key] ?? "")).join("")}
          </div>
        </div>`).join("")}
      <div class="row" style="margin-top:18px;position:sticky;bottom:16px">
        <button class="btn btn-accent" type="submit">Save storefront</button>
        <span class="muted" style="font-size:.86rem">Changes go live the moment you save.</span>
      </div>
    </form>`;

  // Shop colours and fonts preview inside their own fields only — they must
  // not repaint the dashboard, which has its own settings.
  wireStylePreview(values, "store");

  main().querySelectorAll("[data-upload-for]").forEach((input) =>
    input.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const { url } = await API.upload(file);
        main().querySelector(`[name="${input.dataset.uploadFor}"]`).value = url;
        toast("Image uploaded");
      } catch (error) { toast(error.message, "bad"); }
    }));

  document.getElementById("settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.target));
    // Checkboxes are absent from FormData when unchecked, so read them directly.
    SETTING_GROUPS.flatMap((g) => g.fields).forEach(([key, , type]) => {
      if (type === "toggle") raw[key] = event.target[key].checked ? "true" : "false";
    });
    try {
      const saved = await API.saveSettings(raw);
      admin.settings = saved;
      Site.values = saved;
      applyTheme(saved, "admin");   // dashboard keeps its own look
      renderShell();
      markNav();
      toast("Storefront saved · reload the shop tab to see it");
      route();
    } catch (error) { toast(error.message, "bad"); }
  });
}

function settingField(key, label, type, value) {
  const common = `name="${key}" id="set-${key}"`;
  if (type === "textarea")
    return `<label class="field" style="grid-column:1/-1"><span>${esc(label)}</span>
      <textarea ${common} style="min-height:80px">${esc(value)}</textarea></label>`;
  if (type === "color")
    return `<label class="field"><span>${esc(label)}</span>
      <div class="swatch-row"><input type="color" ${common} value="${esc(value || "#000000")}">
      <span class="num muted">${esc(value)}</span></div></label>`;
  if (type === "number")
    return `<label class="field"><span>${esc(label)}</span><input type="number" step="any" ${common} value="${esc(value)}"></label>`;
  if (type === "toggle")
    return `<label class="check" style="align-items:center"><input type="checkbox" ${common} ${String(value) === "true" ? "checked" : ""}>
      <span>${esc(label)}</span></label>`;
  if (type === "font")
    return `<label class="field"><span>${esc(label)}</span>
      <select ${common} class="font-select" style="font-family:${esc(fontStack(value))}">
        ${FONT_CHOICES.map((f) => `<option value="${esc(f)}"${f === value ? " selected" : ""}>${esc(f)}</option>`).join("")}
        ${FONT_CHOICES.includes(value) || !value ? "" : `<option value="${esc(value)}" selected>${esc(value)} (custom)</option>`}
      </select></label>`;
  if (type === "image")
    return `<div class="field"><label class="label" for="set-${key}">${esc(label)}</label>
      <div class="upload-row"><input class="grow" ${common} value="${esc(value)}" placeholder="/media/… or https://…">
      <label class="btn btn-ghost btn-sm" style="margin:0">Upload
        <input type="file" accept="image/*" data-upload-for="${key}" hidden></label></div></div>`;
  return `<label class="field"><span>${esc(label)}</span><input type="text" ${common} value="${esc(value)}"></label>`;
}

/* ------------------------------------------------------------- login */
function renderLogin(message = "") {
  root().innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;padding:24px">
      <div class="panel" style="width:min(100%,400px)">
        <div class="eyebrow">Staff only</div>
        <h1 style="font-size:1.6rem;margin:8px 0 18px">Admin sign in</h1>
        <form id="login" class="stack">
          <label class="field"><span>Email</span><input type="email" name="email" required autocomplete="email"></label>
          <label class="field"><span>Password</span><input type="password" name="password" required autocomplete="current-password"></label>
          <div class="form-error ${message ? "" : "hidden"}" id="login-error">${esc(message)}</div>
          <button class="btn btn-accent btn-block" type="submit">Sign in</button>
        </form>
        <p class="muted" style="font-size:.84rem;margin:16px 0 0">
          The first admin is created from ADMIN_EMAIL and ADMIN_PASSWORD in your .env file.</p>
      </div>
    </div>`;

  document.getElementById("login").addEventListener("submit", async (event) => {
    event.preventDefault();
    const node = document.getElementById("login-error");
    node.classList.add("hidden");
    try {
      const result = await API.login(Object.fromEntries(new FormData(event.target)));
      if (result.user.role !== "admin") throw new Error("That account is not an admin.");
      Auth.token = result.access_token;
      boot();
    } catch (error) {
      node.textContent = error.message;
      node.classList.remove("hidden");
    }
  });
}

/* -------------------------------------------------------------- boot */
async function boot() {
  try {
    admin.settings = await API.settings();
    Site.values = admin.settings;
    applyTheme(admin.settings);
    document.title = `Admin · ${admin.settings.site_name || "Shop"}`;
  } catch {
    root().innerHTML = `<div class="loading">Cannot reach the server. Start it with
      <code>uvicorn app.main:app --reload</code> and reload.</div>`;
    return;
  }

  if (!Auth.token) return renderLogin();
  try {
    admin.user = await API.me();
  } catch {
    Auth.clear();
    return renderLogin();
  }
  if (admin.user.role !== "admin") {
    Auth.clear();
    return renderLogin("That account is not an admin.");
  }

  admin.categories = await API.adminCategories();
  renderShell();
  window.addEventListener("hashchange", route);
  await route();
}

boot();

/* ---------------------------------------------------------- payments */
/* Admin → Payments. One card per provider. Secrets are write-only: the
   server sends a mask, and an empty box means "keep what is saved". */

const GATEWAY_HELP = {
  stripe: {
    publishable: "Publishable key (pk_…)",
    secret: "Secret key (sk_…)",
    where: "Stripe dashboard → Developers → API keys",
    docs: "https://dashboard.stripe.com/test/apikeys",
  },
  razorpay: {
    publishable: "Key ID (rzp_…)",
    secret: "Key secret",
    where: "Razorpay dashboard → Account & Settings → API Keys",
    docs: "https://dashboard.razorpay.com/app/website-app-settings/api-keys",
  },
  bank_transfer: { where: "No keys needed. Put your account details in the note below." },
  cod: { where: "No keys needed. You collect the money on delivery." },
};

async function pagePayments() {
  const gateways = await API.adminGateways();

  main().innerHTML = `
    ${pageHead("Payments", "How customers pay you",
      `<a class="btn btn-ghost btn-sm" href="#/orders">See orders</a>`)}

    <p class="hint" style="max-width:70ch;margin-bottom:18px">
      Secrets are encrypted before they are written to the database and are never sent back to
      this page — you will only ever see the last four characters. Leave a secret box empty to
      keep the key that is already saved.
    </p>

    <div class="grid-2">
      ${gateways.map(gatewayCard).join("")}
    </div>`;

  main().querySelectorAll("[data-save-gateway]").forEach((button) =>
    button.addEventListener("click", () => saveGateway(button.dataset.saveGateway)));

  main().querySelectorAll("[data-forget-gateway]").forEach((button) =>
    button.addEventListener("click", async () => {
      const provider = button.dataset.forgetGateway;
      if (!confirm(`Forget the saved ${provider} keys? The gateway will be switched off.`)) return;
      try {
        await API.clearGatewayKeys(provider);
        toast("Keys forgotten");
        pagePayments();
      } catch (error) { toast(error.message, "bad"); }
    }));

  main().querySelectorAll("[data-copy]").forEach((button) =>
    button.addEventListener("click", () => {
      navigator.clipboard.writeText(button.dataset.copy);
      toast("Copied");
    }));
}

function gatewayCard(gateway) {
  const help = GATEWAY_HELP[gateway.provider] || {};
  const id = (suffix) => `gw-${gateway.provider}-${suffix}`;

  return `
  <div class="fieldset">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div>
        <h3 style="margin:0">${esc(gateway.label || gateway.provider)}</h3>
        <p class="hint" style="margin:4px 0 0">${esc(help.where || "")}</p>
      </div>
      <span class="badge ${gateway.is_enabled ? "badge-live" : "badge-hidden"}">${gateway.is_enabled ? "On" : "Off"}</span>
    </div>

    <label class="field" style="margin-top:14px"><span>Name shown at checkout</span>
      <input type="text" id="${id("label")}" value="${esc(gateway.label)}"></label>

    ${gateway.needs_keys ? `
      <label class="field"><span>${esc(help.publishable)}</span>
        <input type="text" id="${id("pub")}" value="${esc(gateway.publishable_key)}"
               placeholder="Safe to expose — the browser sees this one"></label>

      <label class="field"><span>${esc(help.secret)}</span>
        <input type="password" id="${id("secret")}" autocomplete="new-password"
               placeholder="${gateway.has_secret ? esc(gateway.secret_key_masked) + " — leave blank to keep" : "Not set"}"></label>

      <label class="field"><span>Webhook signing secret</span>
        <input type="password" id="${id("hook")}" autocomplete="new-password"
               placeholder="${gateway.webhook_secret_masked ? esc(gateway.webhook_secret_masked) + " — leave blank to keep" : "Not set"}"></label>

      <div class="field">
        <span class="label">Webhook address</span>
        <div class="upload-row">
          <input class="grow num" readonly value="${esc(gateway.webhook_url)}">
          <button class="btn btn-ghost btn-sm" data-copy="${esc(gateway.webhook_url)}">Copy</button>
        </div>
        <p class="hint">Paste this into the ${esc(gateway.provider === "stripe" ? "Stripe" : "Razorpay")} dashboard so it can tell you the moment a payment lands.</p>
      </div>
    ` : ""}

    <label class="field"><span>Note shown to the customer</span>
      <textarea id="${id("note")}" style="min-height:60px">${esc(gateway.instructions)}</textarea></label>

    <div class="row" style="gap:16px;margin-top:6px">
      <label class="check"><input type="checkbox" id="${id("on")}" ${gateway.is_enabled ? "checked" : ""}>
        <span>Offer at checkout</span></label>
      ${gateway.needs_keys ? `<label class="check"><input type="checkbox" id="${id("test")}" ${gateway.test_mode ? "checked" : ""}>
        <span>Test mode</span></label>` : ""}
    </div>

    <div class="row" style="margin-top:14px">
      <button class="btn btn-accent btn-sm" data-save-gateway="${gateway.provider}">Save</button>
      ${gateway.needs_keys && gateway.has_secret
        ? `<button class="btn btn-ghost btn-sm" data-forget-gateway="${gateway.provider}">Forget keys</button>` : ""}
      ${help.docs ? `<a class="btn btn-ghost btn-sm" href="${help.docs}" target="_blank" rel="noopener">Find my keys ↗</a>` : ""}
    </div>
  </div>`;
}

async function saveGateway(provider) {
  const field = (suffix) => document.getElementById(`gw-${provider}-${suffix}`);
  const body = {
    label: field("label").value.trim(),
    is_enabled: field("on").checked,
    test_mode: field("test") ? field("test").checked : true,
    publishable_key: field("pub") ? field("pub").value.trim() : "",
    secret_key: field("secret") && field("secret").value.trim() ? field("secret").value.trim() : null,
    webhook_secret: field("hook") && field("hook").value.trim() ? field("hook").value.trim() : null,
    instructions: field("note").value,
  };
  try {
    await API.saveGateway(provider, body);
    toast(`${body.label || provider} saved`);
    pagePayments();
  } catch (error) { toast(error.message, "bad"); }
}

/* --------------------------------------------------------- API keys */
/* Admin → API keys. Credentials for Postman, scripts and partner systems. */

const SCOPES = [
  ["catalog:read", "Read products and collections"],
  ["catalog:write", "Add products and change stock"],
  ["orders:read", "Read orders"],
  ["orders:write", "Move orders between statuses"],
];

async function pageApiKeys() {
  const keys = await API.adminApiKeys();
  const base = location.origin;

  main().innerHTML = `
    ${pageHead("API keys", "Let other systems talk to your shop",
      `<button class="btn btn-accent btn-sm" id="new-key">Create a credential</button>`)}

    <div class="fieldset">
      ${keys.length ? `
      <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th>Name</th><th>Client ID</th><th>Client secret</th><th>Can do</th>
          <th>Status</th><th>Last used</th><th></th>
        </tr></thead>
        <tbody>
          ${keys.map((key) => `
            <tr>
              <td><strong>${esc(key.name)}</strong></td>
              <td class="num" style="font-size:.82rem">${esc(key.key_id)}</td>
              <td class="num muted" style="font-size:.82rem">••••${esc(key.secret_hint)}</td>
              <td>${key.scopes.map((s) => `<span class="badge">${esc(s)}</span>`).join(" ")}</td>
              <td><span class="badge ${key.is_active ? "badge-live" : "badge-cancelled"}">${key.is_active ? "Active" : "Revoked"}</span></td>
              <td class="muted" style="font-size:.85rem">${key.last_used_at ? formatDate(key.last_used_at) : "never"}</td>
              <td class="right">
                ${key.is_active ? `<button class="btn btn-ghost btn-sm" data-revoke="${key.id}">Revoke</button>` : ""}
                <button class="btn btn-ghost btn-sm" data-delete-key="${key.id}">Delete</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table></div>` : `
      <div class="empty">
        <h3>No credentials yet</h3>
        <p class="muted">Create one to call this shop's API from Postman, a script, or another system.</p>
      </div>`}
    </div>

    <div class="fieldset">
      <h3>Opening the API reference</h3>
      <p class="hint">The reference at <code class="num">/docs</code> is private. Opening it asks for a
        sign-in — that is your browser, not the shop:</p>
      <table class="data" style="max-width:520px;margin-bottom:14px">
        <tbody>
          <tr><td style="width:130px"><strong>Username</strong></td><td class="cell-sub">your Client ID (<code class="num">sk_id_…</code>)</td></tr>
          <tr><td><strong>Password</strong></td><td class="cell-sub">your Client secret (<code class="num">sk_secret_…</code>)</td></tr>
        </tbody>
      </table>
      <p class="hint">Once you are in, <strong>Try it out</strong> works straight away — the reference is
        handed the same credential, so there is no second step.</p>
      <p style="margin-top:12px"><a class="btn btn-accent btn-sm" href="/docs" target="_blank" rel="noopener">Open the API reference ↗</a></p>
    </div>

    <div class="fieldset">
      <h3>Using a credential from code</h3>
      <p class="hint">One header on every request. In Postman that goes in the Headers tab.</p>
      <pre class="code-block">X-API-Key: sk_id_yourclientid.sk_secret_yoursecret</pre>
      <p class="hint" style="margin-top:12px">The secret on its own works too, if that is all you kept.</p>
      <p class="hint">Base address <code class="num">${esc(base)}/api/integration</code></p>
      <p class="hint">First call to try — it tells you whether the header is right:</p>
      <pre class="code-block">curl ${esc(base)}/api/integration/whoami \\
  -H "X-API-Key: sk_id_yourclientid.sk_secret_yoursecret"</pre>
    </div>`;

  document.getElementById("new-key").addEventListener("click", apiKeyModal);

  main().querySelectorAll("[data-revoke]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (!confirm("Revoke this credential? Anything using it stops working immediately.")) return;
      try {
        await API.revokeApiKey(button.dataset.revoke);
        toast("Credential revoked");
        pageApiKeys();
      } catch (error) { toast(error.message, "bad"); }
    }));

  main().querySelectorAll("[data-delete-key]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (!confirm("Delete this credential for good?")) return;
      try {
        await API.deleteApiKey(button.dataset.deleteKey);
        toast("Credential deleted");
        pageApiKeys();
      } catch (error) { toast(error.message, "bad"); }
    }));
}

function apiKeyModal() {
  openModal(`
    <h2>Create a credential</h2>
    <p class="hint">Give it only the access it needs. You can revoke it at any time.</p>
    <label class="field"><span>What is it for?</span>
      <input type="text" id="key-name" placeholder="Postman, warehouse sync, …"></label>
    <div class="field">
      <span class="label">What may it do?</span>
      ${SCOPES.map(([scope, label], index) => `
        <label class="check" style="margin-top:6px">
          <input type="checkbox" class="key-scope" value="${scope}" ${index === 0 ? "checked" : ""}>
          <span>${esc(label)} <code class="num" style="font-size:.78rem">${esc(scope)}</code></span>
        </label>`).join("")}
    </div>
    <div class="row" style="margin-top:18px">
      <button class="btn btn-accent" id="key-create">Create</button>
      <button class="btn btn-ghost" data-close>Cancel</button>
    </div>`);

  document.getElementById("key-create").addEventListener("click", async () => {
    const name = document.getElementById("key-name").value.trim();
    if (!name) return toast("Give it a name so you know what to revoke later", "bad");
    const scopes = [...document.querySelectorAll(".key-scope")].filter((c) => c.checked).map((c) => c.value);
    if (!scopes.length) return toast("Pick at least one thing it may do", "bad");

    try {
      const created = await API.createApiKey({ name, scopes });
      showSecretOnce(created);
    } catch (error) { toast(error.message, "bad"); }
  });
}

function showSecretOnce(created) {
  const header = `${created.header_name}: ${created.header_value}`;
  openModal(`
    <h2>Credential created</h2>
    <p class="hint" style="background:#FFF6E0;border-left:3px solid var(--accent);padding:10px 14px;border-radius:6px;color:var(--ink)">
      Copy the secret now. Only a hash is stored, so this is the one and only time it can be shown.</p>

    <p class="label" style="margin-top:16px">Key ID</p>
    <pre class="code-block">${esc(created.key.key_id)}</pre>

    <p class="label">Secret</p>
    <pre class="code-block">${esc(created.secret)}</pre>

    <p class="label">The header to send</p>
    <pre class="code-block">${esc(header)}</pre>

    <div class="row" style="margin-top:18px">
      <button class="btn btn-accent" id="copy-header">Copy the header</button>
      <button class="btn btn-ghost" id="key-done">Done</button>
    </div>`);

  document.getElementById("copy-header").addEventListener("click", () => {
    navigator.clipboard.writeText(header);
    toast("Header copied");
  });
  document.getElementById("key-done").addEventListener("click", () => {
    closeModal();
    pageApiKeys();
  });
}

/* --------------------------------------------------------- languages */
/* Admin → Languages. A list of packs, and an editor for one pack.
   #/languages       the list
   #/languages/3     the editor for language 3                        */

async function pageLanguages(languageId) {
  if (languageId) return pageLanguageEditor(languageId);

  const languages = await API.adminLanguages();
  const enabled = languages.filter((l) => l.is_enabled).length;

  main().innerHTML = `
    ${pageHead("Languages", "What the shop can be read in",
      `<button class="btn btn-accent btn-sm" id="new-lang">Add a language</button>`)}

    <p class="hint" style="max-width:72ch;margin-bottom:18px">
      Switch a language on and a picker appears in the shop header. Anything a
      translator has not filled in falls back to English, so a half-finished
      pack never shows a customer a blank label.
      ${enabled < 2 ? " With only one language on, the picker stays hidden." : ""}
    </p>

    <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th>Language</th><th>Code</th><th>Reads</th><th>Strings</th>
          <th>Shown in the shop</th><th></th>
        </tr></thead>
        <tbody>
          ${languages.map((l) => `
            <tr>
              <td><strong>${esc(l.native_name || l.name)}</strong>
                  <div class="cell-sub">${esc(l.name)}</div></td>
              <td class="num">${esc(l.code)}</td>
              <td>${l.direction === "rtl" ? "right to left" : "left to right"}</td>
              <td><a href="#/languages/${l.id}">Edit strings</a></td>
              <td>
                ${l.is_default
                  ? `<span class="badge badge-delivered">Default</span>`
                  : `<label class="check"><input type="checkbox" data-toggle-lang="${l.id}" ${l.is_enabled ? "checked" : ""}><span>${l.is_enabled ? "On" : "Off"}</span></label>`}
              </td>
              <td class="right">
                ${l.is_default ? "" : `
                  <button class="btn btn-ghost btn-sm" data-make-default="${l.id}">Make default</button>
                  <button class="btn btn-ghost btn-sm" data-del-lang="${l.id}">Remove</button>`}
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  document.getElementById("new-lang").addEventListener("click", languageModal);

  main().querySelectorAll("[data-toggle-lang]").forEach((box) =>
    box.addEventListener("change", async () => {
      try {
        await API.updateLanguage(box.dataset.toggleLang, { is_enabled: box.checked });
        toast(box.checked ? "Language switched on" : "Language switched off");
        pageLanguages();
      } catch (error) { toast(error.message, "bad"); pageLanguages(); }
    }));

  main().querySelectorAll("[data-make-default]").forEach((button) =>
    button.addEventListener("click", async () => {
      try {
        await API.updateLanguage(button.dataset.makeDefault, { is_default: true });
        toast("Default language changed");
        pageLanguages();
      } catch (error) { toast(error.message, "bad"); }
    }));

  main().querySelectorAll("[data-del-lang]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (!confirm("Remove this language? Its translations are deleted too.")) return;
      try {
        await API.deleteLanguage(button.dataset.delLang);
        toast("Language removed");
        pageLanguages();
      } catch (error) { toast(error.message, "bad"); }
    }));
}

function languageModal() {
  openModal(`
    <h2>Add a language</h2>
    <p class="hint">Use the two-letter code where there is one — <code class="num">pt</code>,
      <code class="num">ta</code>, <code class="num">de</code>.</p>
    <div class="grid-2">
      <label class="field"><span>Code</span><input id="lang-code" class="num" placeholder="pt" maxlength="12"></label>
      <label class="field"><span>Name in English</span><input id="lang-name" placeholder="Portuguese"></label>
    </div>
    <label class="field"><span>Name in that language</span>
      <input id="lang-native" placeholder="Português">
      <span class="help">This is what shoppers see in the picker.</span></label>
    <label class="field"><span>Reading direction</span>
      <select id="lang-dir"><option value="ltr">Left to right</option><option value="rtl">Right to left</option></select></label>
    <label class="check"><input type="checkbox" id="lang-on"><span>Show in the shop straight away</span></label>
    <div class="row" style="margin-top:18px">
      <button class="btn btn-accent" id="lang-save">Add</button>
      <button class="btn btn-ghost" data-close>Cancel</button>
    </div>`);

  document.getElementById("lang-save").addEventListener("click", async () => {
    const code = document.getElementById("lang-code").value.trim().toLowerCase();
    const name = document.getElementById("lang-name").value.trim();
    if (!code || !name) return toast("A code and a name are both needed", "bad");
    try {
      await API.createLanguage({
        code, name,
        native_name: document.getElementById("lang-native").value.trim() || name,
        direction: document.getElementById("lang-dir").value,
        is_enabled: document.getElementById("lang-on").checked,
      });
      closeModal();
      toast("Language added");
      pageLanguages();
    } catch (error) { toast(error.message, "bad"); }
  });
}

async function pageLanguageEditor(languageId) {
  const pack = await API.languagePackAdmin(languageId);
  const language = pack.language;
  const done = Math.round((pack.translated / pack.total) * 100);

  main().innerHTML = `
    ${pageHead(language.native_name || language.name, `Strings · ${pack.translated} of ${pack.total} translated (${done}%)`,
      `<a class="btn btn-ghost btn-sm" href="#/languages">All languages</a>`)}

    <p class="hint" style="max-width:72ch;margin-bottom:18px">
      The grey text is the English original. Leave a box empty and that string
      stays English — useful for words you would not translate anyway, like a
      brand name.
    </p>

    <form id="pack-form">
      ${Object.entries(pack.catalogue).map(([group, keys]) => `
        <div class="fieldset">
          <h3>${esc(group)}</h3>
          <div class="grid-2">
            ${Object.entries(keys).map(([key, english]) => `
              <label class="field">
                <span>${esc(english)}</span>
                <input name="${esc(key)}" value="${esc(pack.translations[key] || "")}"
                       placeholder="${esc(english)}" dir="${language.direction}">
                <span class="help num" style="font-size:.7rem">${esc(key)}</span>
              </label>`).join("")}
          </div>
        </div>`).join("")}
      <div class="row" style="margin-top:18px;position:sticky;bottom:16px">
        <button class="btn btn-accent" type="submit">Save ${esc(language.name)}</button>
        <span class="muted" style="font-size:.86rem">Live in the shop the moment you save.</span>
      </div>
    </form>`;

  document.getElementById("pack-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    try {
      const saved = await API.saveLanguagePack(languageId, values);
      toast(`Saved · ${saved.translated} of ${saved.total} translated`);
      pageLanguageEditor(languageId);
    } catch (error) { toast(error.message, "bad"); }
  });
}

/* -------------------------------------------------------- promo codes */
/* Admin → Promo codes. The maths always runs on the server; this page only
   decides what the rules are.                                            */

const PROMO_KINDS = {
  percent: "Percentage off",
  fixed: "Fixed amount off",
  free_shipping: "Free delivery",
};

async function pagePromos() {
  const promos = await API.adminPromos();
  const symbol = admin.settings.currency_symbol || "₹";

  const worth = (p) => {
    if (p.kind === "free_shipping") return "Free delivery";
    if (p.kind === "percent") {
      return `${p.value}% off` + (p.max_discount ? ` · max ${symbol}${p.max_discount}` : "");
    }
    return `${symbol}${p.value} off`;
  };

  const window_ = (p) => {
    const from = p.starts_at ? formatDate(p.starts_at) : "";
    const to = p.ends_at ? formatDate(p.ends_at) : "";
    if (from && to) return `${from} – ${to}`;
    if (to) return `until ${to}`;
    if (from) return `from ${from}`;
    return "no end date";
  };

  main().innerHTML = `
    ${pageHead("Promo codes", "Discounts customers type in at checkout",
      `<button class="btn btn-accent btn-sm" id="new-promo">Create a code</button>`)}

    <div class="table-wrap">
      ${promos.length ? `
      <table class="data">
        <thead><tr>
          <th>Code</th><th>Worth</th><th>Conditions</th><th>Used</th>
          <th>Runs</th><th>Status</th><th></th>
        </tr></thead>
        <tbody>
          ${promos.map((p) => `
            <tr>
              <td><strong class="num">${esc(p.code)}</strong>
                  ${p.description ? `<div class="cell-sub">${esc(p.description)}</div>` : ""}</td>
              <td>${esc(worth(p))}</td>
              <td class="cell-sub">
                ${p.min_order_total ? `spend ${symbol}${p.min_order_total}+` : "any order"}
                ${p.per_customer_limit ? ` · ${p.per_customer_limit} per customer` : ""}
              </td>
              <td class="num">${p.used_count}${p.usage_limit ? ` / ${p.usage_limit}` : ""}</td>
              <td class="cell-sub">${esc(window_(p))}</td>
              <td><span class="badge ${p.is_active ? "badge-live" : "badge-hidden"}">${p.is_active ? "Live" : "Off"}</span></td>
              <td class="right">
                <button class="btn btn-ghost btn-sm" data-edit-promo="${p.id}">Edit</button>
                <button class="btn btn-ghost btn-sm" data-del-promo="${p.id}">Delete</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>` : `
      <div class="empty">
        <h3>No codes yet</h3>
        <p class="muted">Create one and customers can type it in at checkout.</p>
      </div>`}
    </div>`;

  document.getElementById("new-promo").addEventListener("click", () => { location.hash = "#/promos/new"; });
  main().querySelectorAll("[data-edit-promo]").forEach((button) =>
    button.addEventListener("click", () => { location.hash = `#/promos/${button.dataset.editPromo}`; }));
  main().querySelectorAll("[data-del-promo]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (!confirm("Delete this code? Orders that already used it are not affected.")) return;
      try {
        await API.deletePromo(button.dataset.delPromo);
        toast("Code deleted");
        pagePromos();
      } catch (error) { toast(error.message, "bad"); }
    }));
}

/* Promo codes get their own page too, for the same reason products did:
     #/promos/new   a blank one
     #/promos/4     an existing one */
async function pagePromoEdit(promoId) {
  const isNew = promoId === "new";
  let promo = null;

  if (!isNew) {
    const all = await API.adminPromos();
    promo = all.find((row) => row.id === +promoId) || null;
    if (!promo) {
      main().innerHTML = `<div class="empty"><h3>That code is not here</h3>
        <a class="btn btn-accent" href="#/promos">Back to promo codes</a></div>`;
      return;
    }
  }

  const v = promo || {
    code: "", description: "", kind: "percent", value: 10, min_order_total: 0,
    max_discount: 0, usage_limit: 0, per_customer_limit: 0,
    starts_at: null, ends_at: null, is_active: true,
  };
  const asDate = (iso) => (iso ? String(iso).slice(0, 10) : "");

  main().innerHTML = `
    ${pageHead(
      promo ? promo.code : "Create a code",
      promo ? "Editing a promo code" : "New promo code",
      `<a class="btn btn-ghost btn-sm" href="#/promos">Back to promo codes</a>`,
    )}
    <div class="edit-page">
    <div class="fieldset">
    <div class="grid-2">
      <label class="field"><span>The code</span>
        <input id="pc-code" class="num" value="${esc(v.code)}" placeholder="WELCOME10" style="text-transform:uppercase">
        <span class="help">Case does not matter — it is stored upper case.</span></label>
      <label class="field"><span>What it does</span>
        <select id="pc-kind">
          ${Object.entries(PROMO_KINDS).map(([k, label]) =>
            `<option value="${k}"${v.kind === k ? " selected" : ""}>${esc(label)}</option>`).join("")}
        </select></label>
    </div>

    <label class="field"><span>Note for your own records</span>
      <input id="pc-desc" value="${esc(v.description)}" placeholder="Diwali campaign">
      <span class="help">Shown to the customer when the code is accepted.</span></label>

    <div class="grid-2" id="pc-value-row">
      <label class="field"><span id="pc-value-label">Percentage off</span>
        <input id="pc-value" type="number" step="any" value="${v.value}"></label>
      <label class="field"><span>Most it can take off</span>
        <input id="pc-max" type="number" step="any" value="${v.max_discount}">
        <span class="help">0 means no cap. Worth setting on a percentage code.</span></label>
    </div>

    <div class="grid-2">
      <label class="field"><span>Minimum order</span>
        <input id="pc-min" type="number" step="any" value="${v.min_order_total}">
        <span class="help">0 means any order qualifies.</span></label>
      <label class="field"><span>Times it can be used in total</span>
        <input id="pc-limit" type="number" value="${v.usage_limit}">
        <span class="help">0 means unlimited.</span></label>
    </div>

    <div class="grid-2">
      <label class="field"><span>Times one customer can use it</span>
        <input id="pc-per" type="number" value="${v.per_customer_limit}">
        <span class="help">0 means unlimited. Counted by account, or by email for guests.</span></label>
      <div></div>
    </div>

    <div class="grid-2">
      <label class="field"><span>Starts</span><input id="pc-from" type="date" value="${asDate(v.starts_at)}">
        <span class="help">Leave empty to start now.</span></label>
      <label class="field"><span>Ends</span><input id="pc-to" type="date" value="${asDate(v.ends_at)}">
        <span class="help">Leave empty to run until you switch it off.</span></label>
    </div>

    <label class="check"><input type="checkbox" id="pc-active" ${v.is_active ? "checked" : ""}>
      <span>Customers can use this code now</span></label>
    </div>

    <div class="edit-actions">
      <button class="btn btn-accent" id="pc-save">${promo ? "Save changes" : "Create code"}</button>
      <a class="btn btn-ghost" href="#/promos">Cancel</a>
      ${promo ? `<button class="btn btn-quiet" id="pc-delete" style="margin-left:auto">Delete</button>` : ""}
    </div>
    </div>`;

  const deleteButton = document.getElementById("pc-delete");
  if (deleteButton) {
    deleteButton.addEventListener("click", async () => {
      if (!confirm(`Delete ${promo.code}? Orders that already used it are not affected.`)) return;
      try {
        await API.deletePromo(promo.id);
        toast("Code deleted");
        location.hash = "#/promos";
      } catch (error) { toast(error.message, "bad"); }
    });
  }

  // Free delivery has no amount to set, so those boxes get out of the way.
  const kind = document.getElementById("pc-kind");
  const syncKind = () => {
    const isShipping = kind.value === "free_shipping";
    document.getElementById("pc-value-row").style.display = isShipping ? "none" : "";
    document.getElementById("pc-value-label").textContent =
      kind.value === "percent" ? "Percentage off" : "Amount off";
  };
  kind.addEventListener("change", syncKind);
  syncKind();

  document.getElementById("pc-save").addEventListener("click", async () => {
    const value = (id) => document.getElementById(id).value;
    const body = {
      code: value("pc-code").trim().toUpperCase(),
      description: value("pc-desc").trim(),
      kind: kind.value,
      value: kind.value === "free_shipping" ? 0 : Number(value("pc-value")) || 0,
      max_discount: Number(value("pc-max")) || 0,
      min_order_total: Number(value("pc-min")) || 0,
      usage_limit: Number(value("pc-limit")) || 0,
      per_customer_limit: Number(value("pc-per")) || 0,
      starts_at: value("pc-from") ? `${value("pc-from")}T00:00:00` : null,
      ends_at: value("pc-to") ? `${value("pc-to")}T23:59:59` : null,
      is_active: document.getElementById("pc-active").checked,
    };
    if (!body.code) return toast("The code needs a word customers can type", "bad");
    try {
      if (promo) await API.updatePromo(promo.id, body);
      else await API.createPromo(body);
      toast(promo ? "Code saved" : "Code created");
      location.hash = "#/promos";
    } catch (error) { toast(error.message, "bad"); }
  });
}

/* ------------------------------------------------------ system email */
/* Admin → System email.
     #/email            SMTP settings, the template list, and the send log
     #/email/order_placed   one template, with a live preview            */

async function pageEmail(templateKey) {
  if (templateKey) return pageEmailTemplate(templateKey);

  const [config, templates, log] = await Promise.all([
    API.emailSettings(), API.emailTemplates(), API.emailLog(),
  ]);

  const check = (id, label, on, help = "") => `
    <label class="check"><input type="checkbox" id="${id}" ${on ? "checked" : ""}>
      <span>${esc(label)}${help ? `<br><span class="muted">${esc(help)}</span>` : ""}</span></label>`;

  main().innerHTML = `
    ${pageHead("System email", "Messages the shop sends on its own",
      `<button class="btn btn-ghost btn-sm" id="send-test">Send a test</button>`)}

    ${config.is_enabled ? "" : `
      <p class="hint" style="background:#FFF6E0;border-left:3px solid var(--accent);padding:12px 16px;border-radius:6px;color:var(--ink);max-width:72ch">
        Sending is switched off, so nothing is going out yet. Fill in your mail
        server below and tick <strong>Send email</strong>. Until then you can still
        write and preview the templates.
      </p>`}

    <div class="fieldset">
      <h3>Mail server</h3>
      <p class="hint">From your email provider — Gmail, Zoho, Brevo, Amazon SES and the rest all give you these.
        The password is encrypted before it is stored and never sent back to this page.</p>

      <div class="grid-2">
        <label class="field"><span>SMTP host</span>
          <input id="em-host" value="${esc(config.host)}" placeholder="smtp.zoho.in"></label>
        <label class="field"><span>Port</span>
          <input id="em-port" type="number" value="${config.port}">
          <div class="hint-inline">587 with STARTTLS, or 465 with SSL.</div></label>
      </div>

      <div class="grid-2">
        <label class="field"><span>Username</span>
          <input id="em-user" value="${esc(config.username)}" autocomplete="off"></label>
        <label class="field"><span>Password</span>
          <input id="em-pass" type="password" autocomplete="new-password"
                 placeholder="${config.has_password ? esc(config.password_masked) + " — leave blank to keep" : "Not set"}"></label>
      </div>

      <div class="grid-2">
        <label class="field"><span>Sender name</span>
          <input id="em-from-name" value="${esc(config.from_name)}" placeholder="Marigold Supply"></label>
        <label class="field"><span>Sender address</span>
          <input id="em-from" type="email" value="${esc(config.from_email)}" placeholder="orders@yourshop.com">
          <div class="hint-inline">Must be an address your provider lets you send as.</div></label>
      </div>

      <label class="field"><span>Reply-to (optional)</span>
        <input id="em-reply" value="${esc(config.reply_to)}" placeholder="hello@yourshop.com">
        <div class="hint-inline">Where a customer's reply lands, if not the sender address.</div></label>

      <div class="row" style="gap:22px;flex-wrap:wrap;margin-top:6px">
        ${check("em-tls", "STARTTLS", config.use_tls, "The usual choice, on port 587.")}
        ${check("em-ssl", "SSL", config.use_ssl, "For port 465. Pick one, not both.")}
      </div>
      <div class="row" style="gap:22px;flex-wrap:wrap;margin-top:10px">
        ${check("em-enabled", "Send email", config.is_enabled, "Off means templates are saved but nothing goes out.")}
        ${check("em-bcc", "Copy me on everything", config.bcc_owner, "Blind copies the sender address.")}
      </div>

      <div class="edit-actions"><button class="btn btn-accent" id="em-save">Save mail server</button></div>
    </div>

    <div class="fieldset">
      <h3>Templates</h3>
      <p class="hint">Each one is sent automatically when the thing in its description happens.
        Switch any of them off and that message simply is not sent.</p>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Message</th><th>Subject</th><th>Sends</th><th></th></tr></thead>
          <tbody>
            ${templates.map((t) => `
              <tr>
                <td><strong>${esc(t.name)}</strong><div class="cell-sub">${esc(t.description)}</div></td>
                <td class="cell-sub">${esc(t.subject)}</td>
                <td>${t.is_enabled
                  ? `<span class="badge badge-live">On</span>`
                  : `<span class="badge badge-hidden">Off</span>`}</td>
                <td class="right"><a class="btn btn-quiet" href="#/email/${esc(t.key)}">Edit</a></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="fieldset">
      <h3>Recent sends</h3>
      <p class="hint">The last fifty attempts. A failure here is the mail server talking, not the shop.</p>
      ${log.length ? `
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>When</th><th>Message</th><th>To</th><th>Result</th></tr></thead>
          <tbody>
            ${log.map((row) => `
              <tr>
                <td class="cell-sub">${esc(formatDate(row.created_at))}</td>
                <td>${esc(row.template_key || "—")}</td>
                <td class="cell-sub">${esc(row.to_email)}</td>
                <td><span class="badge ${row.status === "sent" ? "badge-live" : row.status === "failed" ? "badge-cancelled" : "badge-hidden"}">${esc(row.status)}</span>
                  ${row.detail ? `<div class="cell-sub">${esc(row.detail.slice(0, 90))}</div>` : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>` : `<p class="muted">Nothing sent yet.</p>`}
    </div>`;

  // STARTTLS and SSL are alternatives, so ticking one unticks the other.
  const tls = document.getElementById("em-tls");
  const ssl = document.getElementById("em-ssl");
  tls.addEventListener("change", () => { if (tls.checked) ssl.checked = false; });
  ssl.addEventListener("change", () => { if (ssl.checked) tls.checked = false; });

  document.getElementById("em-save").addEventListener("click", async () => {
    const value = (id) => document.getElementById(id).value;
    try {
      await API.saveEmailSettings({
        is_enabled: document.getElementById("em-enabled").checked,
        host: value("em-host").trim(),
        port: Number(value("em-port")) || 587,
        username: value("em-user").trim(),
        password: value("em-pass").trim() || null,
        use_tls: tls.checked,
        use_ssl: ssl.checked,
        from_name: value("em-from-name").trim(),
        from_email: value("em-from").trim(),
        reply_to: value("em-reply").trim(),
        bcc_owner: document.getElementById("em-bcc").checked,
      });
      toast("Mail server saved");
      pageEmail();
    } catch (error) { toast(error.message, "bad"); }
  });

  document.getElementById("send-test").addEventListener("click", () => testEmailModal(templates));
}

function testEmailModal(templates) {
  openModal(`
    <h2>Send a test</h2>
    <p class="hint">Goes out immediately, using your saved mail server. If it fails you get the
      real reason back, not a silent shrug.</p>
    <label class="field"><span>Send to</span><input id="test-to" type="email" placeholder="you@example.com"></label>
    <label class="field"><span>Which message</span>
      <select id="test-template">
        <option value="">A short check message</option>
        ${templates.map((t) => `<option value="${esc(t.key)}">${esc(t.name)}</option>`).join("")}
      </select>
      <div class="hint-inline">A template is filled in with a recent order, or made-up details if there are none.</div></label>
    <div class="row" style="margin-top:18px">
      <button class="btn btn-accent" id="test-send">Send it</button>
      <button class="btn btn-ghost" data-close>Cancel</button>
    </div>
    <p id="test-result" class="hint" style="margin-top:12px"></p>`);

  document.getElementById("test-send").addEventListener("click", async () => {
    const to = document.getElementById("test-to").value.trim();
    if (!to) return toast("Put an address in first", "bad");
    const result = document.getElementById("test-result");
    result.textContent = "Sending…";
    try {
      const outcome = await API.sendTestEmail({
        to, template_key: document.getElementById("test-template").value,
      });
      result.textContent = outcome.message;
      result.style.color = outcome.sent ? "var(--good)" : "var(--bad)";
      if (outcome.sent) toast("Test sent");
    } catch (error) {
      result.textContent = error.message;
      result.style.color = "var(--bad)";
    }
  });
}

async function pageEmailTemplate(key) {
  let template;
  try {
    template = await API.emailTemplate(key);
  } catch (error) {
    main().innerHTML = `<div class="empty"><h3>No such message</h3>
      <p class="muted">${esc(error.message)}</p>
      <a class="btn btn-accent" href="#/email">Back to system email</a></div>`;
    return;
  }

  main().innerHTML = `
    ${pageHead(template.name, template.description,
      `<a class="btn btn-ghost btn-sm" href="#/email">Back to system email</a>`)}

    <div class="email-split">
      <div class="fieldset">
        <label class="field"><span>Subject</span>
          <input id="tpl-subject" value="${esc(template.subject)}"></label>

        <label class="field"><span>Message</span>
          <textarea id="tpl-body" class="template-body">${esc(template.body)}</textarea></label>

        <div class="field">
          <span class="label">Things you can drop in</span>
          <div class="hint-inline">Click one to insert it where the cursor is.</div>
          <div class="var-list">
            ${template.variables.map((v) => `<button type="button" data-var="${esc(v)}">{{${esc(v)}}}</button>`).join("")}
          </div>
        </div>

        <label class="check" style="margin-top:6px">
          <input type="checkbox" id="tpl-enabled" ${template.is_enabled ? "checked" : ""}>
          <span><strong>Send this message</strong><br>
            <span class="muted">Off means the event still happens, the email just does not go.</span></span></label>

        <div class="edit-actions">
          <button class="btn btn-accent" id="tpl-save">Save message</button>
          <a class="btn btn-ghost" href="#/email">Cancel</a>
          <button class="btn btn-quiet" id="tpl-reset" style="margin-left:auto">Restore original wording</button>
        </div>
      </div>

      <div class="email-preview">
        <div class="eyebrow" style="margin-bottom:10px">Preview</div>
        <div class="subject" id="pv-subject">${esc(template.preview_subject)}</div>
        <pre id="pv-body">${esc(template.preview_body)}</pre>
        <p class="hint" style="margin-top:14px">Filled in with your most recent order, so this is
          close to what a customer receives.</p>
      </div>
    </div>`;

  const subject = document.getElementById("tpl-subject");
  const body = document.getElementById("tpl-body");

  /* The server sends the stand-in content it used for the preview, so what is
     on screen as you type matches what would actually be sent. */
  const sample = template.sample || {};

  const repaint = () => {
    document.getElementById("pv-subject").textContent = fillIn(subject.value, sample);
    document.getElementById("pv-body").textContent = fillIn(body.value, sample);
  };
  subject.addEventListener("input", repaint);
  body.addEventListener("input", repaint);

  main().querySelectorAll("[data-var]").forEach((button) =>
    button.addEventListener("click", () => {
      const field = document.activeElement === subject ? subject : body;
      const token = `{{${button.dataset.var}}}`;
      const at = field.selectionStart ?? field.value.length;
      field.value = field.value.slice(0, at) + token + field.value.slice(field.selectionEnd ?? at);
      field.focus();
      field.selectionStart = field.selectionEnd = at + token.length;
      repaint();
    }));

  document.getElementById("tpl-save").addEventListener("click", async () => {
    if (!subject.value.trim() || !body.value.trim()) {
      return toast("A message needs a subject and something to say", "bad");
    }
    try {
      await API.saveEmailTemplate(key, {
        subject: subject.value, body: body.value,
        is_enabled: document.getElementById("tpl-enabled").checked,
      });
      toast("Message saved");
      location.hash = "#/email";
    } catch (error) { toast(error.message, "bad"); }
  });

  document.getElementById("tpl-reset").addEventListener("click", async () => {
    if (!confirm("Put the original wording back? Your edits to this message are lost.")) return;
    try {
      await API.resetEmailTemplate(key);
      toast("Original wording restored");
      pageEmailTemplate(key);
    } catch (error) { toast(error.message, "bad"); }
  });
}

function fillIn(text, values) {
  return String(text || "").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, name) =>
    (name.toLowerCase() in values ? values[name.toLowerCase()] : whole));
}
