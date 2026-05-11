export const metadata = { title: 'Signup' };

export default function SignupPage() {
  return (
    <main className="demo-shell signup">
      <p className="eyebrow">Signup</p>
      <h1>Create your account</h1>
      <p>Start the checkout flow from a fresh workspace.</p>
      <form className="signup-form" action="/success">
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Workspace
          <input name="workspace" type="text" autoComplete="organization" required />
        </label>
        <button type="submit">Create account</button>
      </form>
    </main>
  );
}
