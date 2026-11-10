"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui";
import { toCsv } from "@/lib/utils";

export function ExportButton({ rows, filename, label }: { rows: Record<string, unknown>[]; filename: string; label: string }) {
  return (
    <Button
      variant="secondary"
      disabled={rows.length === 0}
      onClick={() => {
        // BOM para que Excel abra el CSV con tildes correctas
        const blob = new Blob(["﻿", toCsv(rows)], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      <Download className="h-4 w-4" />
      {label}
    </Button>
  );
}
