import { Copy, Key, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface ApiKeyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiKey: string | null;
  agentName?: string;
}

export function ApiKeyModal({
  open,
  onOpenChange,
  apiKey,
  agentName,
}: ApiKeyModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    toast.success("API key copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            API key created
          </DialogTitle>
          <DialogDescription>
            {agentName
              ? `Copy this key for ${agentName} now. It will not be shown again.`
              : "Copy this key now. It will not be shown again."}
          </DialogDescription>
        </DialogHeader>

        {apiKey && (
          <div className="flex gap-2">
            <Input
              readOnly
              value={apiKey}
              className="font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
            <Button type="button" variant="outline" onClick={handleCopy}>
              <Copy className="h-4 w-4" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
