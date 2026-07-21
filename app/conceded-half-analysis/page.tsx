import { redirect } from "next/navigation";

/** Former Conceded Half page — merged into Half Goals at /highest-scoring-half. */
export default function ConcededHalfAnalysisPage() {
  redirect("/highest-scoring-half");
}
