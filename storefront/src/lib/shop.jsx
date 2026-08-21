/* =========================================================================
   One provider holding everything the shop shares: settings, language, the
   cart, the promo code, who is signed in, and toasts.

   Deliberately plain React context rather than a state library — there is not
   enough state here to justify one, and it keeps the dependency list at three.
   ========================================================================= */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { API, Auth } from "./api";
import { applyTheme } from "./theme";

const CART_KEY = "shopkit_cart";
const PROMO_KEY = "shopkit_promo";
const LANG_KEY = "shopkit_lang";

const ShopContext = createContext(null);

export function useShop() {
  const value = useContext(ShopContext);
  if (!value) throw new Error("useShop must be used inside <ShopProvider>");
  return value;
}

function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ShopProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [categories, setCategories] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [lang, setLang] = useState("en");
  const [strings, setStrings] = useState({});
  const [user, setUser] = useState(null);
  const [cart, setCart] = useState(readCart);
  const [promo, setPromoState] = useState(() => localStorage.getItem(PROMO_KEY) || "");
  const [toasts, setToasts] = useState([]);
  const [booted, setBooted] = useState(false);
  const [offline, setOffline] = useState(false);

  /* ------------------------------------------------------------ toasts */
  const toast = useCallback((message, kind = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((current) => [...current, { id, message, kind }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 3600);
  }, []);

  /* -------------------------------------------------------------- cart */
  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);

  const addToCart = useCallback((productId, quantity = 1) => {
    setCart((current) => {
      const line = current.find((item) => item.product_id === productId);
      if (line) {
        return current.map((item) =>
          item.product_id === productId
            ? { ...item, quantity: item.quantity + quantity }
            : item,
        );
      }
      return [...current, { product_id: productId, quantity }];
    });
  }, []);

  const setQuantity = useCallback((productId, quantity) => {
    setCart((current) =>
      quantity <= 0
        ? current.filter((item) => item.product_id !== productId)
        : current.map((item) =>
            item.product_id === productId ? { ...item, quantity } : item,
          ),
    );
  }, []);

  const removeFromCart = useCallback((productId) => {
    setCart((current) => current.filter((item) => item.product_id !== productId));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const cartCount = useMemo(
    () => cart.reduce((total, item) => total + item.quantity, 0),
    [cart],
  );

  /* ------------------------------------------------------------- promo
     Only the code is remembered. What it is worth is recalculated by the
     server every single time — the browser is never trusted about money. */
  const setPromo = useCallback((code) => {
    const value = (code || "").toUpperCase();
    setPromoState(value);
    if (value) localStorage.setItem(PROMO_KEY, value);
    else localStorage.removeItem(PROMO_KEY);
  }, []);

  /* ---------------------------------------------------------- language */
  const switchLanguage = useCallback(async (code) => {
    localStorage.setItem(LANG_KEY, code);
    setLang(code);
    try {
      setStrings(await API.languagePack(code));
    } catch {
      setStrings({});
    }
    const chosen = languages.find((l) => l.code === code);
    document.documentElement.lang = code;
    document.documentElement.dir = chosen ? chosen.direction : "ltr";
  }, [languages]);

  /* Translate. Every string on the shop goes through this. The pack already
     has English laid underneath on the server, so it can never come back
     blank — a half-finished translation shows English, not a gap. */
  const t = useCallback(
    (key, fallback) => strings[key] ?? fallback ?? key,
    [strings],
  );

  /* -------------------------------------------------------------- money */
  const money = useCallback(
    (value) => {
      const symbol = settings?.currency_symbol ?? "₹";
      return (
        symbol +
        Number(value || 0).toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        })
      );
    },
    [settings],
  );

  /* --------------------------------------------------------------- auth */
  const signIn = useCallback((result) => {
    Auth.token = result.access_token;
    setUser(result.user);
  }, []);

  const signOut = useCallback(() => {
    Auth.clear();
    setUser(null);
  }, []);

  /* --------------------------------------------------------------- boot */
  useEffect(() => {
    (async () => {
      let shopSettings;
      try {
        shopSettings = await API.settings();
      } catch {
        setOffline(true);
        setBooted(true);
        return;
      }
      setSettings(shopSettings);
      applyTheme(shopSettings);

      let available = [];
      try {
        available = await API.languages();
      } catch {
        available = [];
      }
      setLanguages(available);

      const codes = available.map((l) => l.code);
      const saved = localStorage.getItem(LANG_KEY);
      const preferred = shopSettings.default_language || "en";
      const code =
        saved && codes.includes(saved) ? saved : codes.includes(preferred) ? preferred : codes[0];

      if (code) {
        setLang(code);
        const chosen = available.find((l) => l.code === code);
        document.documentElement.lang = code;
        document.documentElement.dir = chosen ? chosen.direction : "ltr";
        try {
          setStrings(await API.languagePack(code));
        } catch {
          setStrings({});
        }
      }

      if (Auth.token) {
        try {
          setUser(await API.me());
        } catch {
          Auth.clear();
        }
      }

      try {
        setCategories(await API.categories());
      } catch {
        setCategories([]);
      }

      setBooted(true);
    })();
  }, []);

  const value = {
    settings, categories, languages, lang, switchLanguage, t, money,
    user, signIn, signOut, setUser,
    cart, cartCount, addToCart, setQuantity, removeFromCart, clearCart,
    promo, setPromo,
    toast, toasts, booted, offline,
  };

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}
