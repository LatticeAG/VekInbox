import { Building2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { formatDateTime } from "@/lib/format";

export function SettingsGeneralPage() {
  const { user, workspace, workspaces } = useAuth();

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" />
              Workspace
            </CardTitle>
            <CardDescription>Current workspace details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {workspace ? (
              <>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">{workspace.name}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Slug</span>
                  <span className="font-mono text-xs">{workspace.slug}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Role</span>
                  <span className="capitalize">{workspace.role}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">ID</span>
                  <span className="font-mono text-xs">{workspace.id}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Created</span>
                  <span>{formatDateTime(workspace.created_at)}</span>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">
                No workspace selected.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
            <CardDescription>Signed-in reviewer.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Email</span>
              <span>{user.email}</span>
            </div>
            {user.name && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Name</span>
                <span>{user.name}</span>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">User ID</span>
              <span className="font-mono text-xs">{user.id}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Workspaces</span>
              <span>{workspaces.length}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
