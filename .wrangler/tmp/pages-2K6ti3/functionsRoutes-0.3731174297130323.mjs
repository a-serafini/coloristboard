import { onRequestGet as __api_status_js_onRequestGet } from "/home/aron/projects/coloristboard/functions/api/status.js"

export const routes = [
    {
      routePath: "/api/status",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_status_js_onRequestGet],
    },
  ]