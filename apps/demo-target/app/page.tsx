import Link from 'next/link';

export default function PricingPage() {
  return (
    <main className="demo-shell">
      <h1>Choose a plan</h1>
      <p>Demo target app for FlowPR browser verification.</p>
      <div className="plans">
        <Link className="plan" href="/checkout?plan=basic">
          <strong>Basic</strong>
          <span>$19/mo</span>
        </Link>
        <Link className="plan featured" href="/checkout?plan=pro">
          <strong>Pro</strong>
          <span>$49/mo</span>
        </Link>
      </div>
    </main>
  );
}

