import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { API } from "../lib/api";
import { useShop } from "../lib/shop";
import { ImageTile, Loading } from "../components/Bits";

export function ProductCard({ product }) {
  const { money, t } = useShop();
  const reduced = product.compare_at_price && product.compare_at_price > product.price;
  return (
    <Link className="card-link p-card" to={`/p/${product.slug}`}>
      <div style={{ position: "relative" }}>
        <ImageTile url={product.image_url} name={product.name} />
        <div className="tag-row">
          {reduced ? <span className="tag tag-accent">Reduced</span> : null}
          {product.stock <= 0 ? <span className="tag tag-out">{t("product.out_of_stock")}</span> : null}
        </div>
      </div>
      <div className="p-card-body">
        <div>
          <div className="p-card-name">{product.name}</div>
          <div className="p-card-note">{product.short_description}</div>
        </div>
        <div className="price">{money(product.price)}</div>
      </div>
    </Link>
  );
}

export default function Home() {
  const { settings, categories, t, money } = useShop();
  const [featured, setFeatured] = useState(null);

  useEffect(() => {
    API.products({ featured: true, page_size: 4 })
      .then((data) => setFeatured(data.items))
      .catch(() => setFeatured([]));
  }, []);

  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <div className="eyebrow">{settings?.tagline}</div>
            <h1>{settings?.hero_title}</h1>
            <p className="hero-sub">{settings?.hero_subtitle}</p>
            <Link className="btn btn-accent" to="/shop">{settings?.hero_cta || t("nav.shop")}</Link>
            <div className="hero-marks">
              <div className="hero-mark">
                <strong>{featured ? featured.length : "—"}</strong><span>featured</span>
              </div>
              <div className="hero-mark">
                <strong>{categories.length}</strong><span>collections</span>
              </div>
              {Number(settings?.free_shipping_threshold) > 0 ? (
                <div className="hero-mark">
                  <strong>{money(settings.free_shipping_threshold)}</strong>
                  <span>free delivery over</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="hero-figure">
            <ImageTile url={settings?.hero_image} name={settings?.site_name} />
          </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <div>
            <div className="eyebrow">Picked out</div>
            <h2>This month’s shelf</h2>
          </div>
          <Link className="btn btn-quiet" to="/shop">See everything</Link>
        </div>
        {featured === null ? (
          <Loading />
        ) : featured.length ? (
          <div className="product-grid">
            {featured.map((product) => <ProductCard key={product.id} product={product} />)}
          </div>
        ) : (
          <p className="muted">Nothing featured yet.</p>
        )}
      </section>

      <section className="wrap section">
        <div className="panel about-band">
          <div>
            <div className="eyebrow">About the shop</div>
            <h2 style={{ marginTop: 14 }}>{settings?.about_title}</h2>
          </div>
          <div>
            <p style={{ margin: 0, color: "var(--ink-soft)", lineHeight: 1.75 }}>
              {settings?.about_text}
            </p>
            <p style={{ margin: "20px 0 0" }}>
              <Link className="btn btn-ghost btn-sm" to="/about">Read more</Link>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
