import { StatusPage } from "@/components/common/StatusPage";

export default function TripNotFound() {
  return (
    <StatusPage
      heading="Trip not found"
      message="This trip doesn't exist, or it belongs to another account."
    />
  );
}
