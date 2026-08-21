import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { API } from "../lib/api";
import { useShop } from "../lib/shop";
import { Loading, PromoBox, Receipt } from "../components/Bits";

export default function Checkout() {
  const shop = useShop();
  const { cart, promo, setPromo, user, money, t, clearCart, toast } = shop;
  const navigate = useNavigate();

  const [preview, setPreview] = useState(null);
  const [methods, setMethods] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    customer_name: "", customer_email: "", phone: "",
    address_line: "", city: "", postal_code: "", country: "",
    note: "", payment_method: "cod",
  });

  const refresh = useCallback(async () => {
    if (!cart.length) return;
    const data = await API.previewCart(cart, promo);
    if (promo && !data.promo_ok) setPromo("");
    setPreview(data);
  }, [cart, promo, setPromo]);

  useEffect(() => {
    if (!cart.length) navigate("/cart");
  }, [cart, navigate]);

  useEffect(() => {
    refresh();
    API.paymentMethods()
      .then((list) => {
        setMethods(list);
        if (list.length) setForm((current) => ({ ...current, payment_method: list[0].provider }));
      })
      .catch(() => setMethods([]));
  }, [refresh]);

  // Prefill from the account, so a signed-in customer types nothing twice.
  useEffect(() => {
    if (!user) return;
    setForm((current) => ({
      ...current,
      customer_name: current.customer_name || user.full_name || "",
      customer_email: current.customer_email || user.email || "",
      phone: current.phone || user.phone || "",
      address_line: current.address_line || user.address_line || "",
      city: current.city || user.city || "",
      postal_code: current.postal_code || user.postal_code || "",
      country: current.country || user.country || "",
    }));
  }, [user]);

  if (!preview) return <Loading />;

  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const order = await API.placeOrder({
        ...form,
        items: cart,
        promo_code: preview.promo_ok ? preview.promo_code : "",
      });
      clearCart();
      setPromo("");
      toast("Order placed. Check your email for the details.");
      navigate(`/order/${order.order_number}`, { state: { order } });
    } catch (problem) {
      setError(problem.message);
      setBusy(false);
    }
  };

  const label = (provider) =>
    methods.find((method) => method.provider === provider)?.label || provider;

  return (
    <div className="wrap section">
      <div className="section-head">
        <div>
          <div className="eyebrow">Step 2 of 2</div>
          <h1>{t("checkout.delivery_details")}</h1>
        </div>
        <Link className="btn btn-quiet" to="/cart">{t("nav.cart")}</Link>
      </div>

      <div className="cart-layout">
        <div className="panel">
          {!user ? (
            <p className="muted" style={{ marginTop: 0 }}>
              Checking out as a guest. <Link to="/account">{t("auth.sign_in")}</Link> if you want this
              order saved to an account.
            </p>
          ) : null}

          <form className="stack" onSubmit={submit}>
            <div className="grid-2">
              <label className="field"><span>{t("checkout.name")}</span>
                <input required value={form.customer_name} onChange={set("customer_name")} /></label>
              <label className="field"><span>{t("checkout.email")}</span>
                <input type="email" required value={form.customer_email} onChange={set("customer_email")} /></label>
            </div>
            <label className="field"><span>{t("checkout.phone")}</span>
              <input value={form.phone} onChange={set("phone")} /></label>
            <label className="field"><span>{t("checkout.address")}</span>
              <input required value={form.address_line} onChange={set("address_line")} /></label>
            <div className="grid-3">
              <label className="field"><span>{t("checkout.city")}</span>
                <input required value={form.city} onChange={set("city")} /></label>
              <label className="field"><span>{t("checkout.postal_code")}</span>
                <input value={form.postal_code} onChange={set("postal_code")} /></label>
              <label className="field"><span>{t("checkout.country")}</span>
                <input value={form.country} onChange={set("country")} /></label>
            </div>

            <label className="field"><span>{t("checkout.payment")}</span>
              <select value={form.payment_method} onChange={set("payment_method")}>
                {methods.length ? (
                  methods.map((method) => (
                    <option key={method.provider} value={method.provider}>
                      {method.label}{method.test_mode ? " (test mode)" : ""}
                    </option>
                  ))
                ) : (
                  <option value="cod">Cash on delivery</option>
                )}
              </select>
            </label>
            {methods.find((m) => m.provider === form.payment_method)?.instructions ? (
              <p className="muted" style={{ fontSize: ".86rem", marginTop: -6 }}>
                {methods.find((m) => m.provider === form.payment_method).instructions}
              </p>
            ) : null}

            <label className="field"><span>{t("checkout.note")}</span>
              <textarea value={form.note} onChange={set("note")}
                placeholder="Gate code, landmark, anything that helps" /></label>

            {error ? <div className="form-error">{error}</div> : null}

            <button className="btn btn-accent btn-block" type="submit" disabled={busy}>
              {busy ? "Placing your order…" : `${t("action.place_order")} · ${money(preview.total)}`}
            </button>
          </form>
        </div>

        <div>
          <PromoBox cart={preview} onApplied={refresh} />
          <Receipt cart={preview} title={t("checkout.summary")} />
          <p className="muted center" style={{ fontSize: ".82rem", marginTop: 12 }}>
            Paying by {label(form.payment_method)}.
          </p>
        </div>
      </div>
    </div>
  );
}
