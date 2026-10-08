import { StatusPage } from "@/components/common/StatusPage";

export default function NotFound() {
  return (
    <StatusPage
      heading="Page not found"
      message="The page you're looking for doesn't exist or has moved."
    />
  );
}
