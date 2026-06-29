export function MissingConfig() {
  return (
    <main className="grid min-h-full place-items-center p-6">
      <section className="w-[min(540px,calc(100vw-48px))] rounded-lg border border-t-[3px] border-edge-transparent border-t-red-500 bg-background-secondary p-7 shadow-[0_24px_80px_rgb(0_0_0/24%)]">
        <h1 className="mb-2 font-display text-2xl font-semibold">Agent Demo</h1>
        <p className="leading-[1.55] text-content-secondary">
          Set <code>VITE_CONVEX_URL</code> before opening the example. Set{" "}
          <code>VITE_CONVEX_SITE_URL</code> if the HTTP action URL cannot be
          inferred from the Convex deployment URL.
        </p>
      </section>
    </main>
  );
}
