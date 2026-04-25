import Link from 'next/link';

export const metadata = { title: 'Checkout' };

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan = 'basic' } = await searchParams;

  return (
    <main className="demo-shell checkout">
      <p className="eyebrow">Checkout</p>
      <h1>{plan === 'pro' ? 'Pro plan' : 'Basic plan'}</h1>
      <p>Review your order and confirm payment to finish setup.</p>
      <div className="payment-box">
        <span>Card ending 4242</span>
        <span>Total due today: {plan === 'pro' ? '$49.00' : '$19.00'}</span>
        <span className="payment-note">Renews monthly · cancel anytime</span>
      </div>
      <Link className="pay-button" href="/success">
        Pay now
      </Link>
      <div className="cookie-banner" data-testid="cookie-banner">
        We use cookies to improve checkout. <button>Accept</button>
      </div>
    </main>
  );
}
