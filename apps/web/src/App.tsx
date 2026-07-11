import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/app-layout";
import { SettingsLayout } from "@/components/settings-layout";
import { ProtectedRoute } from "@/components/protected-route";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/contexts/auth-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { InboxPage } from "@/pages/inbox-page";
import { LoginPage } from "@/pages/login-page";
import { RequestDetailPage } from "@/pages/request-detail-page";
import { SettingsAgentsPage } from "@/pages/settings-agents-page";
import { SettingsChannelsPage } from "@/pages/settings-channels-page";
import { SettingsGeneralPage } from "@/pages/settings-general-page";
import { SettingsPoliciesPage } from "@/pages/settings-policies-page";

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Navigate to="/inbox" replace />} />
                <Route path="/inbox" element={<InboxPage />} />
                <Route path="/inbox/:id" element={<RequestDetailPage />} />
                <Route path="/settings" element={<SettingsLayout />}>
                  <Route
                    index
                    element={<Navigate to="/settings/general" replace />}
                  />
                  <Route path="general" element={<SettingsGeneralPage />} />
                  <Route path="agents" element={<SettingsAgentsPage />} />
                  <Route path="policies" element={<SettingsPoliciesPage />} />
                  <Route path="channels" element={<SettingsChannelsPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/inbox" replace />} />
          </Routes>
          <Toaster richColors position="top-right" />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
