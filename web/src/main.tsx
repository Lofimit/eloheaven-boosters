import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/inter";
import "@fontsource-variable/quicksand";
import "./index.css";
import { ApiError } from "./lib/api";
import { AppLayout, RequireStaff } from "./components/Layout";
import { PageLoader, ToastProvider } from "./components/ui";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Accounts from "./pages/Accounts";
import AccountDetail from "./pages/AccountDetail";
import NotFound from "./pages/NotFound";

// Less-visited pages are split into their own chunks.
const Lend = lazy(() => import("./pages/Lend"));
const Members = lazy(() => import("./pages/Members"));
const Profile = lazy(() => import("./pages/Profile"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const Rules = lazy(() => import("./pages/Info").then((m) => ({ default: m.Rules })));
const Help = lazy(() => import("./pages/Info").then((m) => ({ default: m.Help })));
const Admin = lazy(() => import("./pages/admin/Admin"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
  mutationCache: new MutationCache({
    onError: (err) => {
      // A 401 from any mutation means the session died; refresh auth state.
      if (err instanceof ApiError && err.status === 401) queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  }),
});

const s = (el: React.ReactNode) => <Suspense fallback={<PageLoader />}>{el}</Suspense>;

const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/login", element: <Login /> },
  {
    element: <AppLayout />,
    children: [
      { path: "/dashboard", element: <Dashboard /> },
      { path: "/accounts/:pool", element: <Accounts /> },
      { path: "/account/:id", element: <AccountDetail /> },
      { path: "/lend", element: s(<Lend />) },
      { path: "/users", element: s(<Members />) },
      { path: "/u/:id", element: s(<Profile />) },
      { path: "/settings", element: s(<SettingsPage />) },
      { path: "/rules", element: s(<Rules />) },
      { path: "/help", element: s(<Help />) },
      { path: "/admin/*", element: <RequireStaff>{s(<Admin />)}</RequireStaff> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
