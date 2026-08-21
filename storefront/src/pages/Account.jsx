import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { API } from "../lib/api";
import { useShop } from "../lib/shop";
import { Loading } from "../components/Bits";

function SignIn() {
  const { signIn, t, toast, settings } = useShop();
  const [tab, setTab] = useState("in");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", password: "" });

  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = tab === "in"
        ? await API.login({ email: form.email, password: form.password })
        : await API.register(form);
      signIn(result);
      toast(`Welcome, ${(result.user.full_name || result.user.email).split(" ")[0]}`);
    } catch (problem) {
      setError(problem.message);
      setBusy(false);
    }
  };

  const registrationOpen = String(settings?.allow_registration).toLowerCase() === "true";

  return (
    <div className="wrap section" style={{ maxWidth: 440 }}>
      <div className="panel">
        <div className="tabs">
          <button className={tab === "in" ? "on" : ""} onClick={() => setTab("in")}>
            {t("auth.sign_in")}
          </button>
          {registrationOpen ? (
            <button className={tab === "up" ? "on" : ""} onClick={() => setTab("up")}>
              {t("auth.create_account")}
            </button>
          ) : null}
        </div>

        <form className="stack" onSubmit={submit}>
          {tab === "up" ? (
            <label className="field"><span>{t("checkout.name")}</span>
              <input value={form.full_name} onChange={set("full_name")} autoComplete="name" /></label>
          ) : null}
          <label className="field"><span>{t("auth.email")}</span>
            <input type="email" required value={form.email} onChange={set("email")} autoComplete="email" /></label>
          <label className="field"><span>{t("auth.password")}</span>
            <input type="password" required minLength={tab === "up" ? 8 : undefined}
              value={form.password} onChange={set("password")}
              autoComplete={tab === "up" ? "new-password" : "current-password"} />
            {tab === "up" ? <div className="hint-inline">At least 8 characters.</div> : null}</label>

          {error ? <div className="form-error">{error}</div> : null}
          <button className="btn btn-accent btn-block" type="submit" disabled={busy}>
            {tab === "in" ? t("auth.sign_in") : t("auth.create_account")}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function Account() {
  const { user, signOut, setUser, money, t, toast } = useShop();
  const [orders, setOrders] = useState(null);
  const [profile, setProfile] = useState(null);
  const [passwords, setPasswords] = useState({ current_password: "", new_password: "" });

  useEffect(() => {
    if (!user) return;
    setProfile({
      full_name: user.full_name || "", phone: user.phone || "",
      address_line: user.address_line || "", city: user.city || "",
      postal_code: user.postal_code || "", country: user.country || "",
    });
    API.myOrders({ page_size: 20 }).then((data) => setOrders(data.items)).catch(() => setOrders([]));
  }, [user]);

  if (!user) return <SignIn />;
  if (!profile) return <Loading />;

  const set = (field) => (event) => setProfile({ ...profile, [field]: event.target.value });

  const saveProfile = async (event) => {
    event.preventDefault();
    try {
      setUser(await API.updateProfile(profile));
      toast("Details saved");
    } catch (problem) {
      toast(problem.message, "bad");
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    try {
      await API.changePassword(passwords);
      setPasswords({ current_password: "", new_password: "" });
      toast("Password changed");
    } catch (problem) {
      toast(problem.message, "bad");
    }
  };

  return (
    <div className="wrap section">
      <div className="section-head">
        <div>
          <div className="eyebrow">{user.email}</div>
          <h1>{user.full_name || t("nav.profile")}</h1>
        </div>
        <button className="btn btn-quiet" onClick={signOut}>{t("auth.sign_out")}</button>
      </div>

      <div className="cart-layout">
        <div>
          <h2 style={{ fontSize: "1.2rem", marginBottom: 12 }}>{t("account.my_orders")}</h2>
          {orders === null ? (
            <Loading />
          ) : orders.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Order</th><th>Placed</th><th>Status</th><th className="right">Total</th></tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <Link className="num" to={`/order/${order.order_number}`}>{order.order_number}</Link>
                      </td>
                      <td className="cell-sub">{new Date(order.created_at).toLocaleDateString()}</td>
                      <td><span className={`badge badge-${order.status}`}>{order.status}</span></td>
                      <td className="right num">{money(order.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <h3>{t("account.no_orders")}</h3>
              <Link className="btn btn-accent" to="/shop">{t("action.continue_shopping")}</Link>
            </div>
          )}
        </div>

        <div>
          <div className="panel">
            <h3 style={{ fontSize: "1rem", marginBottom: 12 }}>{t("account.profile")}</h3>
            <form className="stack" onSubmit={saveProfile}>
              <label className="field"><span>{t("checkout.name")}</span>
                <input value={profile.full_name} onChange={set("full_name")} /></label>
              <label className="field"><span>{t("checkout.phone")}</span>
                <input value={profile.phone} onChange={set("phone")} /></label>
              <label className="field"><span>{t("checkout.address")}</span>
                <input value={profile.address_line} onChange={set("address_line")} /></label>
              <div className="grid-2">
                <label className="field"><span>{t("checkout.city")}</span>
                  <input value={profile.city} onChange={set("city")} /></label>
                <label className="field"><span>{t("checkout.postal_code")}</span>
                  <input value={profile.postal_code} onChange={set("postal_code")} /></label>
              </div>
              <label className="field"><span>{t("checkout.country")}</span>
                <input value={profile.country} onChange={set("country")} /></label>
              <button className="btn btn-accent" type="submit">{t("action.save")}</button>
            </form>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: "1rem", marginBottom: 12 }}>{t("auth.password")}</h3>
            <form className="stack" onSubmit={changePassword}>
              <label className="field"><span>Current password</span>
                <input type="password" required value={passwords.current_password}
                  onChange={(e) => setPasswords({ ...passwords, current_password: e.target.value })} /></label>
              <label className="field"><span>New password</span>
                <input type="password" required minLength={8} value={passwords.new_password}
                  onChange={(e) => setPasswords({ ...passwords, new_password: e.target.value })} /></label>
              <button className="btn btn-ghost" type="submit">Change password</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
