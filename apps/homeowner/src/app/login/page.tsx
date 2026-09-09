import Link from "next/link";
import { SignIn } from "@shared/SignIn";

export const metadata = { title: "Sign in" };

// The whole screen is shared now (apps/shared/src/SignIn.tsx) - this file only
// says where a homeowner lands and what the footer offers them.
export default function LoginPage() {
  return <SignIn home="/project" footer={<>New here? <Link href="/join">Join the community</Link></>} />;
}
