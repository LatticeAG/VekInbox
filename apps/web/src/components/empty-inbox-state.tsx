import { Copy, Inbox } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SDK_QUICKSTART } from "@/lib/format";

export function EmptyInboxState() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(SDK_QUICKSTART);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="border-dashed">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Inbox className="h-6 w-6 text-muted-foreground" />
        </div>
        <CardTitle>No approval requests yet</CardTitle>
        <CardDescription>
          When agents submit requests via the SDK, they will appear here for
          review.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative rounded-lg border bg-muted/30">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              SDK quickstart
            </span>
            <Button variant="ghost" size="sm" onClick={handleCopy}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground/90">
            {SDK_QUICKSTART}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
