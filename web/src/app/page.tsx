/**
 * Vigente Protocol — root route.
 *
 * Redirects to /landing (the Phase D refresh that lives there). The previous
 * Payku/RUT homepage is preserved in legacy-page-content.tsx.bak next to this
 * file and in git history for reference; nothing is lost.
 */
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/landing");
}
