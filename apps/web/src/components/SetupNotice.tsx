export function SetupNotice() {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Connect Stow to Supabase</h1>
      <p>
        This build has no Supabase settings. Copy <code>apps/web/.env.example</code> to <code>apps/web/.env</code>, set{' '}
        <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>, then restart <code>pnpm dev</code> or
        build again.
      </p>
      <p>The README's "Supabase setup" section shows where to find both values.</p>
    </main>
  );
}
