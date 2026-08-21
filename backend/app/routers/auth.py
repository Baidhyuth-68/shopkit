"""Sign-up, sign-in and the signed-in customer's own profile."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import mailer, site_settings
from ..database import SessionLocal, get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import (
    LoginIn, PasswordChange, ProfileUpdate, RegisterIn, TokenOut, UserOut,
)
from ..security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["Auth"])


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Create a customer account and return a token, so the visitor is signed
    in immediately after registering."""
    if site_settings.get(db, "allow_registration", "true").lower() != "true":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "New accounts are closed right now.")

    email = payload.email.lower().strip()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "That email already has an account.")

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        role="customer",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    background.add_task(_welcome_email_task, user.email, user.full_name)

    return TokenOut(access_token=create_access_token(user.id, user.role), user=UserOut.model_validate(user))


def _welcome_email_task(email: str, name: str) -> None:
    """After the response, with its own session — signing up must not wait on
    a mail server, or fail because one is down."""
    db = SessionLocal()
    try:
        mailer.send_template(db, "account_created", email, {
            "customer_name": name or "there",
            "customer_email": email,
        })
    finally:
        db.close()


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower().strip()).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect.")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account is disabled.")
    return TokenOut(access_token=create_access_token(user.id, user.role), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: PasswordChange,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect.")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
