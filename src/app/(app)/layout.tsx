import { Suspense } from "react";
import { AppProvider } from "@/components/app-provider";
import { Shell } from "@/shell/shell";
import { Skeleton } from "@/components/ui";
import { canSwitchBranch, getContext } from "@/lib/auth";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const { profile, roleName, permissions, settings, branches, branch } = await getContext();
  return (
    <AppProvider value={{ profile, roleName, permissions, canSwitchBranch: canSwitchBranch(profile.role, permissions), settings, branches, branch }}>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}

function ShellSkeleton() {
  return (
    <div className="min-h-dvh lg:pl-60">
      <div className="fixed inset-y-0 left-0 hidden w-60 bg-menu lg:block" />
      <div className="h-16 border-b border-slate-200 bg-surface" />
      <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
