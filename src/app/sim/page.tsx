import { SimGameLazy } from "@/components/sim/SimGameLazy";

export const metadata = {
  title: "Apex Sim · Apex",
  description: "Drive an ND Miata on Thunderhill West at full scale, with real elevation and a ghost of a real lap.",
};

export default function SimPage() {
  return <SimGameLazy />;
}
