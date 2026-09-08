import { defineRailway, project, service } from "railway/iac";

// Last resort for a per-service CaC repo. Prefer one .railway file for the
// project and drop this if you later combine services into that file.
export const partial = "backend";

export default defineRailway(() => {
  const backend = service("backend", {
    start: "uv run alembic upgrade head && uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    // dockerfilePath from CaC: "Dockerfile"
    // builder from CaC: "dockerfile"
  });
  return project("travel_planner", {
    resources: [backend],
  });
});
