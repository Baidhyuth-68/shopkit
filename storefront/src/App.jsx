import { Link, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import { Empty, Loading } from "./components/Bits";
import { useShop } from "./lib/shop";

import About from "./pages/About";
import Account from "./pages/Account";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import Home from "./pages/Home";
import Order from "./pages/Order";
import Product from "./pages/Product";
import Shop from "./pages/Shop";

export default function App() {
  const { booted, offline, settings } = useShop();

  if (offline) {
    return (
      <div className="wrap section">
        <div className="empty">
          <h3>The shop is not responding</h3>
          <p className="muted">
            Start the server with <code>uvicorn app.main:app --reload</code> from the backend
            folder, then reload this page.
          </p>
        </div>
      </div>
    );
  }

  // Nothing renders until settings and the language pack are in, so the shop
  // never flashes English or the wrong colours before correcting itself.
  if (!booted) return <Loading />;

  if (String(settings?.maintenance_mode).toLowerCase() === "true") {
    return (
      <div className="wrap section">
        <div className="empty">
          <h3>{settings?.site_name} is closed for a moment</h3>
          <p className="muted">We are making a few changes. Please come back shortly.</p>
        </div>
      </div>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/p/:slug" element={<Product />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/order/:number" element={<Order />} />
        <Route path="/account" element={<Account />} />
        <Route path="/about" element={<About />} />
        <Route
          path="*"
          element={
            <Empty title="Page not found">
              <p className="muted">That link does not lead anywhere.</p>
              <Link className="btn btn-accent" to="/">Back to the shop</Link>
            </Empty>
          }
        />
      </Routes>
    </Layout>
  );
}
