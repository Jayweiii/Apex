import { HomeLanding } from "@/components/HomeLanding";
import { fetchHomeComparisonsServer } from "@/lib/home-comparisons-server";

export default async function HomePage() {
  const initialComparisons = await fetchHomeComparisonsServer(6);
  return <HomeLanding initialComparisons={initialComparisons} />;
}
