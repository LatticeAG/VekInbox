import { Inbox, Moon, Settings, Sun } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "@/contexts/theme-context";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppLayout() {
  const { user, workspace, workspaces, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  if (workspaces.length === 0) {
    return <OnboardingWizard />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4 sm:gap-8">
            <Link to="/inbox" className="flex shrink-0 items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Inbox className="h-4 w-4" />
              </div>
              <div className="hidden flex-col sm:flex">
                <span className="text-sm font-semibold tracking-tight">
                  VekInbox
                </span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Reviewer
                </span>
              </div>
            </Link>

            <nav className="hidden items-center gap-1 md:flex">
              {navItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <WorkspaceSwitcher />

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>

            {user && (
              <div className="hidden items-center gap-3 lg:flex">
                <div className="text-right">
                  <p className="text-sm font-medium leading-none">
                    {user.name ?? user.email}
                  </p>
                  {workspace && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {workspace.name}
                    </p>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => logout()}>
                  Sign out
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
