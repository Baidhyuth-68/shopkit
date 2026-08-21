import { Link } from "react-router-dom";
import { useShop } from "../lib/shop";

export default function About() {
  const { settings, t } = useShop();
  return (
    <div className="wrap section" style={{ maxWidth: 680 }}>
      <div className="eyebrow">{settings?.site_name}</div>
      <h1>{settings?.about_title}</h1>
      <p className="hero-sub">{settings?.about_text}</p>
      <div className="panel" style={{ marginTop: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Get in touch</div>
        <p style={{ margin: 0 }}>
          <a href={`mailto:${settings?.contact_email}`}>{settings?.contact_email}</a><br />
          <a href={`tel:${settings?.contact_phone}`}>{settings?.contact_phone}</a>
        </p>
      </div>
      <p style={{ marginTop: 24 }}>
        <Link className="btn btn-accent" to="/shop">{t("nav.shop")}</Link>
      </p>
    </div>
  );
}
