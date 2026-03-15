// Vercel serverless function — creates a Stripe Checkout Session
// Stripe secret key stays server-side, never exposed to the browser

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ error: "Stripe not configured on server." });
  }

  const { priceId, userId, email } = req.body;
  if (!priceId) {
    return res.status(400).json({ error: "Missing priceId" });
  }

  try {
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        "mode": "subscription",
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": "1",
        "success_url": "https://realityestimator.com?pro=success",
        "cancel_url": "https://realityestimator.com?pro=cancelled",
        ...(email ? { "customer_email": email } : {}),
        ...(userId ? { "client_reference_id": userId } : {}),
        "allow_promotion_codes": "true",
      }).toString(),
    });

    const session = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: session.error?.message || "Stripe error" });
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: "Checkout error: " + err.message });
  }
}
