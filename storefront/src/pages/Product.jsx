import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { API, mediaUrl } from "../lib/api";
import { useShop } from "../lib/shop";
import { Empty, ImageTile, Loading } from "../components/Bits";

export default function Product() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { money, t, addToCart, toast } = useShop();
  const [product, setProduct] = useState(null);
  const [missing, setMissing] = useState(false);
  const [shown, setShown] = useState("");
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    setProduct(null);
    setMissing(false);
    setQuantity(1);
    API.product(slug)
      .then((found) => {
        setProduct(found);
        setShown(found.image_url || (found.gallery || [])[0] || "");
      })
      .catch(() => setMissing(true));
  }, [slug]);

  if (missing) {
    return (
      <Empty title="We cannot find that">
        <p className="muted">It may have sold out and been taken down.</p>
        <Link className="btn btn-accent" to="/shop">{t("product.all")}</Link>
      </Empty>
    );
  }
  if (!product) return <Loading />;

  const gallery = [product.image_url, ...(product.gallery || [])].filter(Boolean);
  const soldOut = product.stock <= 0;
  const reduced = product.compare_at_price && product.compare_at_price > product.price;

  const add = () => {
    addToCart(product.id, quantity);
    toast(`${product.name} added to your cart`);
  };

  return (
    <div className="wrap section detail">
      <div>
        <div className="gallery-main" id="gallery-main">
          <ImageTile url={shown} name={product.name} className="thumb" />
        </div>
        {gallery.length > 1 ? (
          <div className="gallery-strip">
            {gallery.map((url) => (
              <button
                key={url}
                className={url === shown ? "on" : ""}
                onClick={() => setShown(url)}
                aria-label="Show this photo"
              >
                <img src={mediaUrl(url)} alt="" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="buy-panel">
        <div className="eyebrow">{product.category ? product.category.name : t("nav.shop")}</div>
        <h1>{product.name}</h1>
        <p className="hero-sub">{product.short_description}</p>

        <div className="detail-price">
          {money(product.price)}
          {reduced ? (
            <span className="muted" style={{ textDecoration: "line-through", marginLeft: 10 }}>
              {money(product.compare_at_price)}
            </span>
          ) : null}
        </div>

        <p className={soldOut ? "line-warn" : "muted"}>
          {soldOut
            ? t("product.out_of_stock")
            : product.stock <= 5
              ? `${t("product.low_stock")} — ${product.stock} left`
              : t("product.in_stock")}
        </p>

        {!soldOut ? (
          <div className="row" style={{ marginTop: 18, gap: 12 }}>
            <div className="qty">
              <button onClick={() => setQuantity((n) => Math.max(1, n - 1))} aria-label="Fewer">−</button>
              <span>{quantity}</span>
              <button
                onClick={() => setQuantity((n) => Math.min(product.stock, n + 1))}
                aria-label="More"
              >
                +
              </button>
            </div>
            <button className="btn btn-accent" onClick={add}>{t("action.add_to_cart")}</button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                add();
                navigate("/cart");
              }}
            >
              {t("action.buy_now")}
            </button>
          </div>
        ) : null}

        {product.description ? (
          <div style={{ marginTop: 26 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>{t("product.description")}</div>
            {product.description.split("\n").filter(Boolean).map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
        ) : null}

        {product.sku ? (
          <p className="muted num" style={{ fontSize: ".8rem", marginTop: 18 }}>{product.sku}</p>
        ) : null}
      </div>
    </div>
  );
}
