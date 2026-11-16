import { HomePage } from "@/components/HomePage";

// The layout's "· Ambika Groups CRM" ending is not applied to the page beside it, so the full title is given here.
export const metadata = { title: { absolute: "Home · Ambika Groups CRM" } };

export default function Page() {
  return <HomePage />;
}
