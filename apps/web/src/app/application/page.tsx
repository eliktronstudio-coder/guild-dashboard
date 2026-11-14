import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
export default async function Page() {
  const { membership } = await getAccess();
  redirect(membership?.status === "active" ? "/dashboard" : "/onboarding");
}
