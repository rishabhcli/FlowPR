import Link from 'next/link';

export const metadata = { title: 'Pricing' };

export default function PricingPage() {
  return (
    <main className="demo-shell">
      <p className="eyebrow">Pricing</p>
      <h1>Choose a plan</h1>
      <p>Cancel anytime. No credit card required to start.</p>
      <div className="plans">
        <Link className="plan" href="/checkout?plan=basic">
          <strong>Basic</strong>
          <span>$19/mo</span>
          <small>For solo work and side projects.</small>
        </Link>
        <Link className="plan featured" href="/checkout?plan=pro">
          <strong>Pro</strong>
          <span>$49/mo</span>
          <small>For teams that ship every week.</small>
        </Link>
      </div>
    </main>
  );
}

