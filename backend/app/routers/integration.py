"""Endpoints for Postman, scripts and partner systems.

These use an API credential instead of a login token:

    X-API-Key: sk_id_xxxxxxxx.sk_secret_yyyyyyyy

Create one in Admin → API keys and give it only the scopes it needs:

    catalog:read   catalog:write   orders:read   orders:write

Note what is deliberately absent: no user management, no settings, no payment
credentials. An API key cannot reach /api/admin/*, so a leaked key cannot read
your customer list or your Stripe secret.
"""
import math

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_api_key, require_scope
from ..models import Order, Product
from ..schemas import OrderOut, OrderPage, ProductOut, ProductPage
from ..serializers import product_out

router = APIRouter(prefix="/api/integration", tags=["Integration (API key)"])

ORDER_STATUSES = {"pending", "paid", "shipped", "delivered", "cancelled"}


@router.get("/whoami", summary="Check that a credential works")
def whoami(key=Depends(require_api_key)):
    """The first call to make in Postman. If this returns 200, your header is
    formatted correctly and the credential is live."""
    return {
        "key_id": key.key_id,
        "name": key.name,
        "scopes": key.scope_list,
        "last_used_at": key.last_used_at,
    }


@router.get("/products", response_model=ProductPage, summary="List products")
def list_products(
    db: Session = Depends(get_db),
    key=Depends(require_scope("catalog:read")),
    q: str | None = Query(None, description="Match on product name"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    query = db.query(Product)
    if q:
        query = query.filter(Product.name.ilike(f"%{q}%"))
    total = query.count()
    rows = query.order_by(Product.id).offset((page - 1) * page_size).limit(page_size).all()
    return ProductPage(
        items=[product_out(p) for p in rows],
        total=total, page=page, page_size=page_size,
        pages=max(1, math.ceil(total / page_size)),
    )


@router.get("/products/{sku}", response_model=ProductOut, summary="Get one product by SKU")
def get_product(sku: str, db: Session = Depends(get_db), key=Depends(require_scope("catalog:read"))):
    product = db.query(Product).filter(Product.sku == sku).first()
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No product with that SKU.")
    return product_out(product)


@router.patch("/products/{sku}/stock", response_model=ProductOut, summary="Set stock by SKU")
def set_stock(
    sku: str,
    stock: int = Query(ge=0, description="The new stock count, not a delta"),
    db: Session = Depends(get_db),
    key=Depends(require_scope("catalog:write")),
):
    """Addressed by SKU rather than id, so your warehouse system never needs to
    know this shop's internal numbering."""
    product = db.query(Product).filter(Product.sku == sku).first()
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No product with that SKU.")
    product.stock = stock
    db.commit()
    db.refresh(product)
    return product_out(product)


@router.get("/orders", response_model=OrderPage, summary="List orders")
def list_orders(
    db: Session = Depends(get_db),
    key=Depends(require_scope("orders:read")),
    order_status: str | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    query = db.query(Order)
    if order_status:
        query = query.filter(Order.status == order_status)
    total = query.count()
    rows = (
        query.order_by(Order.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return OrderPage(
        items=rows, total=total, page=page, page_size=page_size,
        pages=max(1, math.ceil(total / page_size)),
    )


@router.patch("/orders/{order_number}/status", response_model=OrderOut, summary="Move an order on")
def set_order_status(
    order_number: str,
    new_status: str = Query(alias="status"),
    db: Session = Depends(get_db),
    key=Depends(require_scope("orders:write")),
):
    if new_status not in ORDER_STATUSES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Status must be one of: {', '.join(sorted(ORDER_STATUSES))}.",
        )
    order = db.query(Order).filter(Order.order_number == order_number).first()
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No order with that number.")
    order.status = new_status
    db.commit()
    db.refresh(order)
    return order
