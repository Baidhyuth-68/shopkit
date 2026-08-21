import { useEffect, useState } from "react";

import { API, mediaUrl } from "../lib/api";
import { useShop } from "../lib/shop";

/** Products without a photo get a typographic tile rather than a broken image. */
export function ImageTile({ url, name, className = "thumb" }) {
  const src = mediaUrl(url);
  if (src) {
    return (
      <div className={className}>
        <img src={src} alt={name} loading="lazy" />
      </div>
    );
  }
  const initials = String(name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] || "")
    .join("")
    .toUpperCase();
  const hue = [...String(name || "")].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return (
    <div className={className}>
      <div className="thumb-mono" style={{ backgroundColor: `hsl(${hue} 32% 92%)`, fontSize: "1.6rem" }}>
        {initials}
      </div>
    </div>
  );
}


/** The shop's signature element: mono type, dashed rules, a torn bottom edge.
 *  Shown on the cart, at checkout, and on a placed order. */
export function Receipt({ cart, title }) {
  const { money, settings, t } = useShop();
  return (
    <>
      <div className="receipt">
        <h3>{title || t("checkout.summary")}</h3>
        <hr className="receipt-rule" />

        {cart.items.map((line) => (
          <div className="receipt-line" key={line.product_id}>
            <span className="rl-name">
              {line.name} <span className="rl-qty">× {line.quantity}</span>
            </span>
            <span>{money(line.line_total)}</span>
          </div>
        ))}

        <hr className="receipt-rule" />
        <div className="receipt-line">
          <span>{t("cart.subtotal")}</span>
          <span>{money(cart.subtotal)}</span>
        </div>

        {cart.discount ? (
          <div className="receipt-line discount-line">
            <span>
              {t("cart.discount")}
              {cart.promo_code ? ` · ${cart.promo_code}` : ""}
            </span>
            <span>−{money(cart.discount)}</span>
          </div>
        ) : null}

        <div className="receipt-line">
          <span>{t("cart.shipping")}</span>
          <span>{cart.shipping_fee ? money(cart.shipping_fee) : t("cart.free_shipping")}</span>
        </div>

        {cart.tax ? (
          <div className="receipt-line">
            <span>{t("cart.tax")}</span>
            <span>{money(cart.tax)}</span>
          </div>
        ) : null}

        <hr className="receipt-rule" />
        <div className="receipt-total">
          <span>{t("cart.total")}</span>
          <span>{money(cart.total)}</span>
        </div>
        <div className="receipt-note">
          {settings?.site_name} · {settings?.currency_code}
        </div>
      </div>
      <div className="receipt-foot" />
    </>
  );
}

/** Applying only previews the discount. The code is checked again, and only
 *  counted against its limits, when the order is actually placed — so window
 *  shoppers cannot exhaust a "first 100 customers" promotion. */
export function PromoBox({ cart, onApplied }) {
  const { promo, setPromo, t, cart: lines } = useShop();
  const [value, setValue] = useState(promo);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setValue(promo), [promo]);

  if (cart.promo_ok) {
    return (
      <div className="promo-box applied">
        <div>
          <div className="promo-code num">{cart.promo_code}</div>
          <div className="muted" style={{ fontSize: ".84rem" }}>{cart.promo_message}</div>
        </div>
        <button
          className="btn btn-quiet btn-sm"
          onClick={() => {
            setPromo("");
            onApplied();
          }}
        >
          {t("promo.remove")}
        </button>
      </div>
    );
  }

  const apply = async () => {
    const code = value.trim();
    if (!code) return;
    setBusy(true);
    setMessage("");
    try {
      // Checked against the real cart, because a code can be valid in general
      // but not for this basket — too small, wrong customer, already used.
      const preview = await API.previewCart(lines, code);
      if (preview.promo_ok) {
        setPromo(code);
        onApplied();
      } else {
        setMessage(preview.promo_message || t("promo.invalid"));
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="promo-box">
      <label className="sr-only" htmlFor="promo-input">{t("promo.label")}</label>
      <input
        id="promo-input"
        className="num"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            apply();
          }
        }}
        placeholder={t("promo.placeholder")}
        autoCapitalize="characters"
        autoComplete="off"
      />
      <button className="btn btn-ghost btn-sm" onClick={apply} disabled={busy}>
        {t("action.apply")}
      </button>
      {message ? <p className="promo-msg">{message}</p> : null}
    </div>
  );
}

export function Loading() {
  return <div className="loading">Loading…</div>;
}

export function Empty({ title, children }) {
  return (
    <div className="wrap section">
      <div className="empty">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}
