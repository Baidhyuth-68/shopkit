import { Link, NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";

import { mediaUrl } from "../lib/api";
import { useShop } from "../lib/shop";

/** Hidden when the shop offers one language, so a single-language shop shows
 *  no pointless dropdown. */
function LanguagePicker() {
  const { languages, lang, switchLanguage } = useShop();
  if (languages.length < 2) return null;
  return (
    <label className="lang-picker">
      <span className="sr-only">Language</span>
      <select value={lang} onChange={(event) => switchLanguage(event.target.value)} aria-label="Language">
        {languages.map((language) => (
          <option key={language.code} value={language.code}>
            {language.native_name || language.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Header() {
  const { settings, user, cartCount, t } = useShop();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const search = (event) => {
    event.preventDefault();
    navigate(`/shop?q=${encodeURIComponent(query)}`);
  };

  return (
    <>
      {settings?.announcement ? <div className="announce">{settings.announcement}</div> : null}
      <header className="site-header">
        <div className="wrap">
          <Link className="brand" to="/">
            <span className="brand-mark">
              {settings?.logo_image ? <img src={mediaUrl(settings.logo_image)} alt="" /> : settings?.logo_text || "MS"}
            </span>
            <span className="brand-name">{settings?.site_name || "Shop"}</span>
          </Link>

          <nav className="site-nav">
            {/* The stylesheet marks the current page with .on, so NavLink is
                told to use that instead of its default "active". */}
            <NavLink to="/" end className={({ isActive }) => (isActive ? "on" : "")}>
              {t("nav.home", "Home")}
            </NavLink>
            <NavLink to="/shop" className={({ isActive }) => (isActive ? "on" : "")}>
              {t("nav.shop")}
            </NavLink>
            <NavLink to="/about" className={({ isActive }) => (isActive ? "on" : "")}>
              {t("nav.about")}
            </NavLink>
          </nav>

          <div className="header-actions">
            <form className="header-search" onSubmit={search}>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("nav.search")}
                aria-label={t("nav.search")}
              />
            </form>
            <LanguagePicker />
            <Link className="btn btn-ghost btn-sm" to="/account">
              {user ? t("nav.profile") : t("auth.sign_in")}
            </Link>
            <Link className="btn btn-accent btn-sm cart-btn" to="/cart">
              {t("nav.cart")}
              {cartCount > 0 ? <span className="cart-count">{cartCount}</span> : null}
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}

function Footer() {
  const { settings, categories, t } = useShop();
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div>
          <div className="brand-name" style={{ marginBottom: 8 }}>{settings?.site_name}</div>
          <p className="muted" style={{ maxWidth: "34ch" }}>{settings?.tagline}</p>
          <p className="eyebrow" style={{ marginTop: 18 }}>{settings?.footer_text}</p>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 10 }}>{t("nav.shop")}</div>
          <Link to="/shop">{t("product.all")}</Link>
          {categories.map((category) => (
            <Link key={category.id} to={`/shop?category=${category.slug}`}>{category.name}</Link>
          ))}
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Contact</div>
          <a href={`mailto:${settings?.contact_email}`}>{settings?.contact_email}</a>
          <a href={`tel:${settings?.contact_phone}`}>{settings?.contact_phone}</a>
          <Link to="/account">{t("account.my_orders")}</Link>
        </div>
      </div>
    </footer>
  );
}

function Toasts() {
  const { toasts } = useShop();
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map((item) => (
        <div key={item.id} className={`toast ${item.kind === "bad" ? "toast-bad" : ""}`}>
          {item.message}
        </div>
      ))}
    </div>
  );
}

export default function Layout({ children }) {
  return (
    <>
      <Header />
      <main id="app">{children}</main>
      <Footer />
      <Toasts />
    </>
  );
}
