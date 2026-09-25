import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";

/** Where Microsoft sends an admin after they approve (or decline) the app for their organization. */
export default async function AdminConsentResult({ searchParams }: PageProps<"/auth/admin-consent">) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const approved = one(q.admin_consent)?.toLowerCase() === "true";
  const tenant = one(q.tenant);
  const error = one(q.error_description) ?? one(q.error);

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader active="home" />
      <main className="grid flex-1 place-items-center p-6">
        <div className="max-w-lg rounded-xl border border-line bg-panel p-6">
          {approved ? (
            <>
              <CheckCircle2 className="text-good" aria-hidden="true" />
              <h1 className="mt-2 text-lg font-semibold">Approved for your organization</h1>
              <p className="mt-2 text-ink-2">
                Everyone in your directory{tenant ? <> (<span className="font-mono text-[13px]">{tenant}</span>)</> : null} can now sign in to Azure Cost Canvas. Each person only sees the subscriptions their own Azure role allows.
              </p>
            </>
          ) : (
            <>
              <XCircle className="text-crit" aria-hidden="true" />
              <h1 className="mt-2 text-lg font-semibold">The app wasn&apos;t approved</h1>
              <p className="mt-2 text-ink-2">{error ?? "The approval was cancelled or didn't finish."}</p>
            </>
          )}
          <Link href="/live" className="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink">
            Go to the live view
          </Link>
        </div>
      </main>
    </div>
  );
}
