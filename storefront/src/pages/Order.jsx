import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { API } from "../lib/api";
import { useShop } from "../lib/shop";
import { Empty, Loading, Receipt } from "../components/Bits";

export default function Order() {
  const { number } = useParams();
  const { state } = useLocation();
  const { t, settings } = useShop();

  /* Checkout hands the finished order straight over. That matters for guests:
     fetching it back needs a login, so without this a guest would place an
     order and then be told it could not be found. */
  const [order, setOrder] = useState(state?.order?.order_number === number ? state.order : null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (order) return;
    API.myOrder(number).then(setOrder).catch(() => setMissing(true));
  }, [number, order]);

  if (missing) {
    return (
      <Empty title="We cannot find that order">
        <p className="muted">Sign in with the account it was placed on, and try again.</p>
        <Link className="btn btn-accent" to="/account">{t("auth.sign_in")}</Link>
      </Empty>
    );
  }
  if (!order) return <Loading />;

  // The receipt takes the same shape whether it comes from a cart preview or
  // a placed order, so one component serves both.
  const asCart = {
    items: order.items.map((item) => ({
      product_id: item.product_id ?? item.product_name,
      name: item.product_name,
      quantity: item.quantity,
      line_total: item.line_total,
    })),
    subtotal: order.subtotal,
    discount: order.discount,
    promo_code: order.promo_code,
    shipping_fee: order.shipping_fee,
    tax: order.tax,
    total: order.total,
  };

  return (
    <div className="wrap section" style={{ maxWidth: 720 }}>
      <div className="empty" style={{ paddingBottom: 8 }}>
        <div className="eyebrow">{t("order.thanks")}</div>
        <h1 className="num">{order.order_number}</h1>
        <p className="muted">
          {t("order.status")}: <span className={`badge badge-${order.status}`}>{order.status}</span>
        </p>
        <p className="muted">
          A confirmation is on its way to {order.customer_email}.
        </p>
      </div>

      <Receipt cart={asCart} title={t("checkout.summary")} />

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Delivering to</div>
        <p className="muted" style={{ margin: 0 }}>
          {[order.customer_name, order.address_line, order.city, order.postal_code, order.country]
            .filter(Boolean)
            .map((line, index) => <span key={index}>{line}<br /></span>)}
        </p>
      </div>

      <div className="row" style={{ marginTop: 18, justifyContent: "center" }}>
        <Link className="btn btn-ghost" to="/account">{t("account.my_orders")}</Link>
        <Link className="btn btn-accent" to="/shop">{t("action.continue_shopping")}</Link>
      </div>
      <p className="muted center" style={{ fontSize: ".82rem", marginTop: 14 }}>
        Questions? {settings?.contact_email}
      </p>
    </div>
  );
}
