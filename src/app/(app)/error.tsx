"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card>
      <EmptyState
        icon={<TriangleAlert className="h-5 w-5" />}
        title="No pudimos cargar esta sección"
        description={`Puede ser un problema temporal de conexión. Inténtalo de nuevo.${error.digest ? ` (ref. ${error.digest})` : ""}`}
        action={<Button onClick={reset}>Reintentar</Button>}
      />
    </Card>
  );
}
