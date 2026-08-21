import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { API } from "../lib/api";
import { useShop } from "../lib/shop";
import { Empty, ImageTile, Loading, PromoBox, Receipt } from "../components/Bits";

export default function Cart() {
  const shop = useShop();
  const { cart, promo, setPromo, money, t, setQuantity, removeFromCart } = shop;
  const [preview, setPreview] = useState(null);

  const refresh = useCallback(async () => {
    if (!cart.length) {
      setPreview(null);
      return;
    }
    const data = await API.previewCart(cart, promo);
    // A code can expire or be spent while someone browses. Drop it quietly
    // rather than showing a discount that will not survive checkout.
    if (promo && !data.promo_ok) setPromo("");
    setPreview(data);
  }, [cart, promo, setPromo]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!cart.length) {
    return (
      <Empty title={t("cart.empty")}>
        <p className="muted">Everything we have made is one page away.</p>
        <Link className="btn btn-accent" to="/shop">{t("action.continue_shopping")}</Link>
      </Empty>
    );
  }
  if (!preview) return <Loading />;

  return (
    <div className="wrap section">
      <div className="section-head">
        <div>
          <div className="eyebrow">
            {shop.cartCount} item{shop.cartCount === 1 ? "" : "s"}
          </div>
          <h1>{t("cart.title")}</h1>
        </div>
        <Link className="btn btn-quiet" to="/shop">{t("action.continue_shopping")}</Link>
      </div>

      <div className="cart-layout">
        <div>
          {preview.items.map((line) => (
            <div className="cart-line" key={line.product_id}>
              <ImageTile url={line.image_url} name={line.name} />
              <div>
                <Link className="p-card-name" style={{ textDecoration: "none" }} to={`/p/${line.slug}`}>
                  {line.name}
                </Link>
                <div className="muted num" style={{ fontSize: ".86rem", marginTop: 2 }}>
                  {money(line.unit_price)} each
                </div>
                {line.message ? <div className="line-warn">{line.message}</div> : null}
                <div className="row" style={{ marginTop: 10 }}>
                  <div className="qty">
                    <button onClick={() => setQuantity(line.product_id, line.quantity - 1)} aria-label="Fewer">−</button>
                    <span>{line.quantity}</span>
                    <button onClick={() => setQuantity(line.product_id, line.quantity + 1)} aria-label="More">+</button>
                  </div>
                  <button className="btn btn-quiet" onClick={() => removeFromCart(line.product_id)}>
                    {t("action.remove")}
                  </button>
                </div>
              </div>
              <div className="price">{money(line.line_total)}</div>
            </div>
          ))}
        </div>

        <div>
          <PromoBox cart={preview} onApplied={refresh} />
          <Receipt cart={preview} />
          <div style={{ marginTop: 18 }}>
            {preview.has_problems ? (
              <>
                <button className="btn btn-accent btn-block" disabled>{t("action.checkout")}</button>
                <p className="line-warn center" style={{ marginTop: 10 }}>
                  Adjust the flagged lines to continue.
                </p>
              </>
            ) : (
              <Link className="btn btn-accent btn-block" to="/checkout">{t("action.checkout")}</Link>
            )}
            {preview.free_shipping_threshold > 0 && preview.subtotal < preview.free_shipping_threshold ? (
              <p className="muted center" style={{ fontSize: ".86rem", marginTop: 10 }}>
                Add {money(preview.free_shipping_threshold - preview.subtotal)} more for free delivery.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
