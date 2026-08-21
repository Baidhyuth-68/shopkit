"""Checkout and the customer's own order history."""
import math

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db
from ..deps import get_current_user, get_current_user_optional
from ..models import Order, OrderItem, Product, User
from ..schemas import OrderIn, OrderOut, OrderPage
from .. import mailer, promos
from ..utils import money, new_order_number, price_order

router = APIRouter(prefix="/api/orders", tags=["Orders"])


@router.post("", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def place_order(
    payload: OrderIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    """Guests can check out too — sending a token just links the order to the
    account so it shows up under 'My orders'."""
    order = Order(
        order_number=new_order_number(),
        user_id=user.id if user else None,
        status="pending",
        payment_method=payload.payment_method,
        customer_name=payload.customer_name,
        customer_email=payload.customer_email.lower(),
        phone=payload.phone,
        address_line=payload.address_line,
        city=payload.city,
        postal_code=payload.postal_code,
        country=payload.country,
        note=payload.note,
    )

    subtotal = 0.0
    for line in payload.items:
        product = db.get(Product, line.product_id)
        if not product or not product.is_active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f"Item {line.product_id} is no longer sold. Remove it and try again.")
        if product.stock < line.quantity:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                f"Only {product.stock} of “{product.name}” left. Update the quantity and try again.")

        line_total = money(product.price * line.quantity)
        subtotal += line_total
        order.items.append(OrderItem(
            product_id=product.id,
            product_name=product.name,
            unit_price=money(product.price),
            quantity=line.quantity,
            line_total=line_total,
            image_url=product.image_url,
        ))
        product.stock -= line.quantity   # reserved as soon as the order is placed

    # The code is re-checked here against the real subtotal. Whatever discount
    # the browser thought it was getting is ignored.
    promo, discount, free_shipping = None, 0.0, False
    if payload.promo_code.strip():
        try:
            promo = promos.validate(
                db, payload.promo_code, money(subtotal),
                user_id=user.id if user else None,
                email=payload.customer_email,
            )
        except promos.PromoError as error:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error))
        base = price_order(db, subtotal)
        discount, _ = promos.discount_for(promo, money(subtotal), base["shipping_fee"])
        free_shipping = promo.kind == "free_shipping"

    totals = price_order(db, subtotal, discount, free_shipping)
    order.subtotal = totals["subtotal"]
    order.discount = totals["discount"]
    order.promo_code = promo.code if promo else ""
    order.shipping_fee = totals["shipping_fee"]
    order.tax = totals["tax"]
    order.total = totals["total"]

    db.add(order)
    db.flush()
    if promo:
        saved = totals["discount"] if not free_shipping else base["shipping_fee"]
        promos.redeem(
            db, promo, order_id=order.id,
            user_id=user.id if user else None,
            email=payload.customer_email, amount=saved,
        )
    db.commit()
    db.refresh(order)

    # Sent after the response, so a slow mail server never delays a checkout.
    background.add_task(_order_email_task, "order_placed", order.id)

    # >>> Payment gateway hook: charge here, then set order.status = "paid".
    #     See docs/CODE_MAP.md -> "Taking real payments".
    return order


def _order_email_task(template_key: str, order_id: int) -> None:
    """Runs after the request, so it needs a session of its own."""
    db = SessionLocal()
    try:
        order = db.get(Order, order_id)
        if order:
            mailer.send_order_email(db, template_key, order)
    finally:
        db.close()


@router.get("", response_model=OrderPage)
def my_orders(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
):
    query = db.query(Order).filter(Order.user_id == user.id)
    total = query.count()
    items = (query.order_by(Order.created_at.desc())
             .offset((page - 1) * page_size).limit(page_size).all())
    return OrderPage(items=items, total=total, page=page, page_size=page_size,
                     pages=max(1, math.ceil(total / page_size)))


@router.get("/{order_number}", response_model=OrderOut)
def get_my_order(
    order_number: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    order = db.query(Order).filter(Order.order_number == order_number).first()
    if not order or (order.user_id != user.id and user.role != "admin"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found.")
    return order
