"""Everything a visitor can read without signing in: products, categories,
cart pricing and the storefront settings."""
import math

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import promos, site_settings
from ..database import get_db
from ..models import Category, Product
from ..schemas import CartIn, CartLineOut, CartOut, CategoryOut, ProductOut, ProductPage
from ..serializers import category_out, product_out
from ..utils import money, price_order

router = APIRouter(prefix="/api", tags=["Storefront"])


@router.get("/settings", response_model=dict)
def read_settings(db: Session = Depends(get_db)):
    """Branding, copy and shop rules. The frontend calls this first and
    themes itself from the result."""
    return site_settings.get_all(db)


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)):
    rows = (
        db.query(Category, func.count(Product.id))
        .outerjoin(Product, (Product.category_id == Category.id) & (Product.is_active.is_(True)))
        .filter(Category.is_active.is_(True))
        .group_by(Category.id)
        .order_by(Category.sort_order, Category.name)
        .all()
    )
    return [category_out(cat, count) for cat, count in rows]


@router.get("/products", response_model=ProductPage)
def list_products(
    db: Session = Depends(get_db),
    q: str | None = Query(None, description="Search in name, description and SKU"),
    category: str | None = Query(None, description="Category slug"),
    featured: bool | None = None,
    in_stock: bool | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    sort: str = Query("newest", pattern="^(newest|price_asc|price_desc|name)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=100),
):
    query = db.query(Product).filter(Product.is_active.is_(True))

    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(Product.name.ilike(like), Product.description.ilike(like),
                Product.short_description.ilike(like), Product.sku.ilike(like))
        )
    if category:
        query = query.join(Category).filter(Category.slug == category)
    if featured is not None:
        query = query.filter(Product.is_featured.is_(featured))
    if in_stock:
        query = query.filter(Product.stock > 0)
    if min_price is not None:
        query = query.filter(Product.price >= min_price)
    if max_price is not None:
        query = query.filter(Product.price <= max_price)

    order = {
        "newest": Product.created_at.desc(),
        "price_asc": Product.price.asc(),
        "price_desc": Product.price.desc(),
        "name": Product.name.asc(),
    }[sort]

    total = query.count()
    items = query.order_by(order).offset((page - 1) * page_size).limit(page_size).all()
    return ProductPage(
        items=[product_out(p) for p in items],
        total=total,
        page=page,
        page_size=page_size,
        pages=max(1, math.ceil(total / page_size)),
    )


@router.get("/products/{slug}", response_model=ProductOut)
def get_product(slug: str, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.slug == slug, Product.is_active.is_(True)).first()
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That product is no longer listed.")
    return product_out(product)


@router.post("/cart/preview", response_model=CartOut)
def preview_cart(payload: CartIn, db: Session = Depends(get_db)):
    """The cart itself lives in the browser; totals are always calculated
    here so prices, stock and shipping rules cannot be tampered with."""
    lines: list[CartLineOut] = []
    subtotal = 0.0
    problems = False

    for line in payload.items:
        product = db.get(Product, line.product_id)
        if not product or not product.is_active:
            problems = True
            lines.append(CartLineOut(
                product_id=line.product_id, name="Unavailable item", slug="", image_url="",
                unit_price=0, quantity=line.quantity, line_total=0, stock=0,
                available=False, message="This item is no longer sold.",
            ))
            continue

        quantity = min(line.quantity, product.stock)
        available = quantity > 0
        message = ""
        if product.stock == 0:
            message, problems = "Out of stock.", True
        elif quantity < line.quantity:
            message, problems = f"Only {product.stock} left.", True

        line_total = money(product.price * quantity)
        subtotal += line_total
        lines.append(CartLineOut(
            product_id=product.id, name=product.name, slug=product.slug,
            image_url=product.image_url, unit_price=money(product.price),
            quantity=quantity, line_total=line_total, stock=product.stock,
            available=available, message=message,
        ))

    # A promo code is only a preview here. It is validated again, and only
    # counted against its usage limit, when the order is actually placed.
    discount, free_shipping, promo_ok, promo_message = 0.0, False, False, ""
    if payload.promo_code.strip():
        try:
            promo = promos.validate(db, payload.promo_code, money(subtotal))
            base = price_order(db, subtotal)
            discount, shipping_after = promos.discount_for(promo, money(subtotal), base["shipping_fee"])
            free_shipping = promo.kind == "free_shipping"
            promo_ok = True
            promo_message = promo.description or "Code applied."
        except promos.PromoError as error:
            promo_message = str(error)

    totals = price_order(db, subtotal, discount, free_shipping)
    return CartOut(
        items=lines,
        currency_symbol=site_settings.get(db, "currency_symbol", "₹"),
        has_problems=problems,
        promo_code=payload.promo_code.strip().upper() if promo_ok else "",
        promo_message=promo_message,
        promo_ok=promo_ok,
        **totals,
    )
