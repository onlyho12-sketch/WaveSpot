import "./demo/install" // 웹 시연판(VITE_DEMO=1)일 때만: 현장 서버를 브라우저 안에서 실행 · 다른 모듈보다 먼저
import "./index.css"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Admin } from "./routes/Admin"
import { AppShell } from "./routes/AppShell"
import { Log } from "./routes/Log"
import { Monitor } from "./routes/Monitor"
import { Roam, RoamIndex } from "./routes/Roam"
import { Setup } from "./routes/Setup"

const rootRoute = createRootRoute({ component: AppShell })
const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: Monitor }),
  createRoute({ getParentRoute: () => rootRoute, path: "/roam", component: RoamIndex }),
  createRoute({ getParentRoute: () => rootRoute, path: "/roam/$id", component: Roam }),
  createRoute({ getParentRoute: () => rootRoute, path: "/log", component: Log }),
  createRoute({ getParentRoute: () => rootRoute, path: "/setup", component: Setup }),
  createRoute({ getParentRoute: () => rootRoute, path: "/admin", component: Admin }),
])
const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const queryClient = new QueryClient()

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
