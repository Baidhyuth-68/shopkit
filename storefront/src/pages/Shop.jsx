import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { API } from "../lib/api";
import { useShop } from "../lib/shop";
import { Loading } from "../components/Bits";
import { ProductCard } from "./Home";

export default function Shop() {
  const { categories, t } = useShop();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);

  const category = params.get("category") || "";
  const q = params.get("q") || "";
  const sort = params.get("sort") || "newest";
  const page = Number(params.get("page") || 1);

  useEffect(() => {
    setData(null);
    API.products({ category, q, sort, page, page_size: 12 })
      .then(setData)
      .catch(() => setData({ items: [], total: 0, pages: 1, page: 1 }));
  }, [category, q, sort, page]);

  const update = (changes) => {
    const next = Object.fromEntries(params);
    Object.entries(changes).forEach(([key, value]) => {
      if (value) next[key] = value;
      else delete next[key];
    });
    delete next.page;         // any filter change starts again at page one
    setParams(next);
  };

  return (
    <div className="wrap section shop-layout">
      <aside className="filters">
        <div className="filter-group">
          <div className="eyebrow">Collections</div>
          <div className="filter-list">
            <button className={`chip ${category ? "" : "on"}`} onClick={() => update({ category: "" })}>
              {t("product.all")}
            </button>
            {categories.map((item) => (
              <button
                key={item.id}
                className={`chip ${category === item.slug ? "on" : ""}`}
                onClick={() => update({ category: item.slug })}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <label className="field">
            <span>{t("product.sort")}</span>
            <select value={sort} onChange={(event) => update({ sort: event.target.value })}>
              <option value="newest">Newest</option>
              <option value="price_asc">Price, low to high</option>
              <option value="price_desc">Price, high to low</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
      </aside>

      <div>
        <div className="section-head">
          <div>
            <div className="eyebrow">{q ? `Searching “${q}”` : "Everything we make"}</div>
            <h2>{data ? `${data.total} item${data.total === 1 ? "" : "s"}` : "…"}</h2>
          </div>
          {q ? <Link className="btn btn-quiet" to="/shop">Clear search</Link> : null}
        </div>

        {data === null ? (
          <Loading />
        ) : data.items.length ? (
          <>
            <div className="product-grid">
              {data.items.map((product) => <ProductCard key={product.id} product={product} />)}
            </div>
            {data.pages > 1 ? (
              <div className="pager">
                {Array.from({ length: data.pages }, (_, index) => index + 1).map((number) => (
                  <button
                    key={number}
                    className={`chip ${number === data.page ? "on" : ""}`}
                    onClick={() => setParams({ ...Object.fromEntries(params), page: number })}
                  >
                    {number}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty">
            <h3>{t("product.no_results")}</h3>
            <p className="muted">Try a different word, or browse everything.</p>
            <Link className="btn btn-accent" to="/shop">{t("product.all")}</Link>
          </div>
        )}
      </div>
    </div>
  );
}
